import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { ankiTSV, auditCSV, canonicalJSON, csv, evaluationBundle, fingerprint, readingHTML, reviewCSV, studyHTML } from '../src/exports.js';
import { presets } from '../src/presets.js';
import { sentences, words } from '../src/nlp.js';
import { buildReadingCopy, inspectDocument, MAX_SOURCE, renderBlocks } from '../src/remediate.js';
import { shortcutAction } from '../src/shortcuts.js';
import { sm2 } from '../src/study.js';

for (const preset of presets) test(`full preset pipeline ${preset.id}`, async () => {
  const before = inspectDocument(preset.source, preset.mode);
  const copy = buildReadingCopy(before);
  assert.ok(before.stats.words > 20);
  assert.ok(before.stats.converged);
  assert.ok(before.cards.length > 0);
  assert.ok(copy.report.stats.words > 20);
  assert.match(copy.html, /<!doctype html>/);
  assert.equal(copy.report.source, copy.html);
  assert.equal(before.source, preset.source);
  const result = JSON.parse(await evaluationBundle(before, copy.report));
  assert.equal(result.payload.before.source, preset.source);
  assert.equal(result.payload.after.source, copy.html);
  assert.equal(result.fingerprint, createHash('sha256').update(canonicalJSON(result.payload)).digest('hex'));
});

test('club example repairs the structural and inline audit flags without claiming conformance', () => {
  const club = presets.find(x => x.id === 'club');
  const before = inspectDocument(club.source, club.mode);
  const copy = buildReadingCopy(before);
  assert.equal(before.issues.length, 13);
  assert.equal(copy.report.issues.length, 0);
  assert.ok(copy.report.stats.fk + 3 < before.stats.fk);
  assert.ok(copy.notes.some(n => n.includes('not a replacement')));
  assert.deepEqual(copy.blocks.filter(b => b.kind === 'heading').map(b => b.level), [1,2,3]);
});
test('safe reading copy retains the meaning of a negative command', () => {
  const copy = buildReadingCopy(inspectDocument('Do not send financial records by email.'));
  assert.deepEqual(copy.actions, ['Do not send financial records by email.']);
  assert.ok(copy.html.includes('Do not send financial records by email.'));
});
for (const count of [24, 25, 26]) {
  for (const mode of ['text', 'html']) {
    test(`reading copy respects the ${count} word semicolon boundary in ${mode} mode`, () => {
      const left = Array(12).fill('word').join(' ');
      const right = Array(count - 12).fill('word').join(' ');
      const text = `${left}; ${right}.`;
      const source = mode === 'html' ? `<html lang="en"><body><p>${text}</p></body></html>` : text;
      const before = inspectDocument(source, mode);
      const copy = buildReadingCopy(before);
      const expected = count > 25 ? `${left}. Word${right.slice(4)}.` : text;
      assert.equal(before.stats.words, count);
      assert.equal(before.stats.sentences, 1);
      assert.deepEqual(copy.blocks.filter(block => block.kind === 'paragraph').map(block => block.text), [expected]);
      assert.ok(copy.html.includes(`<p>${expected}</p>`));
      assert.deepEqual(copy.report.blocks.filter(block => block.kind === 'paragraph').map(block => block.text), [expected]);
      assert.equal(sentences(expected).length, count > 25 ? 2 : 1);
      assert.deepEqual(words(expected).map(word => word.text.toLowerCase()), words(text).map(word => word.text));
    });
  }
}
test('simple vocabulary substitutions and first-use expansion are applied without duplicate expansion', () => {
  const copy = buildReadingCopy(inspectDocument('Commence the FAFSA exercise. Use the FAFSA example.'));
  assert.equal(copy.blocks[1].text, 'Start the FAFSA (Free Application for Federal Student Aid) exercise. Use the FAFSA example.');
});
test('known acronym is not expanded if an expansion is already next to it', () => {
  const copy = buildReadingCopy(inspectDocument('Use Portable Document Format (PDF).'));
  assert.match(copy.html, /Portable Document Format \(PDF\)/);
  assert.doesNotMatch(copy.html, /\(PDF \(/);
});
test('technical jargon stays in the copy for study rather than being silently replaced', () => {
  const copy = buildReadingCopy(inspectDocument('Compare osmosis between the model cells.'));
  assert.match(copy.html, /Compare osmosis/);
});
test('declared non-English language skips English substitutions', () => {
  const copy = buildReadingCopy(inspectDocument('<html lang=fr><head><title>Titre</title></head><p>Commence le test.</p></html>', 'html'));
  assert.match(copy.html, /<html lang="fr">/);
  assert.match(copy.html, /Commence le test/);
});
test('source offsets for HTML terms identify encoded original text', () => {
  const source = '<p>File the F&#65;FSA this week.</p>';
  const report = inspectDocument(source, 'html');
  const [term] = report.stats.terms;
  assert.equal(report.text.slice(term.start, term.end), 'FAFSA');
  assert.equal(source.slice(term.sourceStart, term.sourceEnd), 'F&#65;FSA');
  const concept = report.cards.find(card => card.kind === 'concept');
  assert.equal(source.slice(concept.sourceStart, concept.sourceEnd), 'F&#65;FSA');
});
test('source offsets for ranked sentences may contain inert intervening tags', () => {
  const source = '<p>Bring <em>a clean</em> ruler to class.</p>';
  const report = inspectDocument(source, 'html');
  const [top] = report.stats.ranked;
  assert.equal(top.text, 'Bring a clean ruler to class.');
  assert.equal(source.slice(top.sourceStart, top.sourceEnd), 'Bring <em>a clean</em> ruler to class.');
});
test('cards use normalized plain text and source citation', () => {
  const source = '\uD83D\uDD0E Look for the GPA on your form.';
  const report = inspectDocument(source);
  assert.equal(report.cards[0].back, 'GPA');
  assert.match(report.cards[0].front, /\[\.\.\.\]/);
  assert.equal(source.slice(report.cards[1].sourceStart, report.cards[1].sourceEnd), 'GPA');
});
test('source cap rejects oversize text explicitly', () => assert.throws(() => inspectDocument('x'.repeat(MAX_SOURCE + 1)), RangeError));
test('generated export beyond input cap is still audited in full', () => {
  const copy = buildReadingCopy(inspectDocument('&'.repeat(14000)));
  assert.ok(copy.html.length > MAX_SOURCE);
  assert.match(copy.report.text, /&{14000}/);
  assert.equal(copy.report.issues.length, 0);
});
test('unsupported document modes are errors', () => assert.throws(() => inspectDocument('text','pdf'), RangeError));
test('invalid source values are rejected', () => assert.throws(() => inspectDocument(null), TypeError));
test('empty source has no fabricated study cards', () => assert.deepEqual(inspectDocument('').cards, []));
test('ordered paragraphs and bullet runs form valid generated HTML', () => {
  assert.equal(renderBlocks([{kind:'bullet',text:'First'},{kind:'bullet',text:'Second'},{kind:'paragraph',text:'End'}]),
    '<ul>\n<li>First</li>\n<li>Second</li>\n</ul>\n<p>End</p>\n');
});

for (const [source, mode, unexpected] of [
  ['<script>console.log("inert")</script><p>Visible</p>', 'html', '<script>'],
  ['<img src="image.png" alt="Map" onerror="void 0">', 'html', 'onerror='],
  ['<a href="javascript:void(0)">Open the example</a>', 'html', 'href='],
  ['<p>&lt;script&gt;Plain text&lt;/script&gt;</p>', 'html', '<script>'],
  ['<p onclick="void 0">Visible text</p>', 'html', 'onclick='],
  ['<svg><text>SVG</text></svg><p>Notes</p>', 'html', '<svg>'],
  ['<iframe src="/elsewhere">Fallback</iframe>', 'html', '<iframe'],
  ['<script>Plain angle brackets</script>', 'text', '<script>'],
  ['<form action="/submit"><input placeholder="Name"></form>', 'html', '<input'],
  ['<p><a href="https://example.invalid">External destination</a></p>', 'html', 'https://example.invalid'],
  ['<img alt="&lt;script&gt;">', 'html', '<script>']
]) test(`reader generates inert HTML instead of copying source markup: ${source}`, () => {
  const output = buildReadingCopy(inspectDocument(source, mode)).html;
  assert.ok(!output.includes(unexpected), output);
  assert.match(output, /default-src 'none'/);
});

for (const [formula, expected] of [
  ['=1+2', "'=1+2"], ['+300', "'+300"], ['-1', "'-1"], ['@A1', "'@A1"], ['  =4', "'  =4"],
  ['\tA1', "'\tA1"], [' \rA1', "' \rA1"], ['\nnormal', "'\nnormal"], ['\ufeff=4', "'\ufeff=4"],
  ['\u0000@x', "'\u0000@x"], ['\uff1d1', "'\uff1d1"], ['\uff0b3', "'\uff0b3"], ['\u22123', "'\u22123"],
  ['School notice', 'School notice'], ['x=2', 'x=2'], [-1, '-1']
]) test(`formula-safe CSV ${JSON.stringify(formula)}`, () => assert.equal(csv([[formula]]), `"${expected}"\r\n`));
test('CSV quotes delimiters and embedded newlines', () => assert.equal(csv([['a,b','He said "yes"','some\ntext',null]]), '"a,b","He said ""yes""","some\ntext",""\r\n'));
test('audit export records both stages with unit labels', () => {
  const before = inspectDocument('<h3>Heading</h3>', 'html');
  const csvFile = auditCSV(before, buildReadingCopy(before).report);
  assert.match(csvFile, /"Start \(inclusive\)","End \(exclusive\)"/);
  assert.match(csvFile, /"Before","heading-order"/);
  assert.match(csvFile, /"After","Issue count","limited audit","","","","0"/);
});
test('Anki header directs text import, not HTML interpretation', () => {
  assert.equal(ankiTSV([{front:'First\tline\nnext',back:'<b>Text</b>\r',sourceStart:1,sourceEnd:4}]),
    '#separator:Tab\n#html:false\n#columns:Front\tBack\nFirst line next\t<b>Text</b>  | Source [1, 4)\n');
});
test('review CSV treats a user-derived prompt as text', () => {
  const report = reviewCSV([{front:'=12',back:'x',sourceStart:0,sourceEnd:3}], {0:{repetitions:1,interval:1,ease:2.6,due:'2026-11-22'}});
  assert.match(report, /"'\=12","x","0","3","1","1","2.6","2026-11-22"/);
});

for (const [value, expected] of [
  [null,'null'], [undefined,undefined], [{z:0,a:[2,1]},'{"a":[2,1],"z":0}'],
  [{2:2,10:10},'{"10":10,"2":2}'], [[NaN,Infinity,-0],'[null,null,0]'],
  [[undefined, ,Symbol('skip')],'[null,null,null]'], [{a:undefined,b:2},'{"b":2}'],
  [{x:{toJSON:() => undefined}},'{}'], [[{toJSON:() => undefined}],'[null]'],
  [{toJSON:() => undefined},undefined], [{a:{toJSON:(k) => k}},'{"a":"a"}'],
  [{d:new Date('2000-01-01T00:00:00Z')},'{"d":"2000-01-01T00:00:00.000Z"}'],
  [JSON.parse('{"__proto__":5}'),'{"__proto__":5}']
]) test(`canonical JSON ${String(expected)}`, () => assert.equal(canonicalJSON(value), expected));
test('canonical repeated references are not circular', () => {
  const item = {a:1};
  assert.equal(canonicalJSON([item,item]), '[{"a":1},{"a":1}]');
});
test('canonical cycles fail explicitly', () => { const object = {}; object.own = object; assert.throws(() => canonicalJSON(object), TypeError); });
test('canonical BigInt fails like native JSON', () => assert.throws(() => canonicalJSON(1n), TypeError));
test('fingerprint known SHA-256 vector', async () => assert.equal(await fingerprint('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'));
test('reading export is the audited artifact', () => {
  const copy = buildReadingCopy(inspectDocument('Open the book.'));
  assert.equal(readingHTML(copy), copy.report.source);
});
test('study sheet escapes source markup and has print styles', () => {
  const source = inspectDocument('Ask <b>why</b> the note changed.');
  const html = studyHTML(buildReadingCopy(source), source);
  assert.match(html, /@media print/);
  assert.match(html, /AccessLens Study Sheet/);
  assert.doesNotMatch(html, /<b>why<\/b>/);
});

const now = new Date('2026-12-31T23:59:59Z');
test('SM-2 first successful review schedules the next UTC day', () => assert.deepEqual(sm2(null, 5, now),
  {repetitions:1,interval:1,ease:2.6,due:'2027-01-01'}));
test('SM-2 second successful interval is six days', () => assert.equal(sm2(sm2(null,5,now),5,now).interval,6));
test('SM-2 later interval uses the updated ease', () => assert.equal(sm2({repetitions:2,interval:6,ease:2.5},5,now).interval,16));
test('SM-2 malformed prior state falls back to defaults', () => {
  assert.deepEqual(sm2({repetitions: 'two', interval: NaN, ease: undefined}, 5, now), {repetitions: 1, interval: 1, ease: 2.6, due: '2027-01-01'});
  assert.deepEqual(sm2({repetitions: 5}, 5, now), {repetitions: 6, interval: 1, ease: 2.6, due: '2027-01-01'});
});
test('SM-2 a lapse resets repetitions and interval', () => assert.deepEqual(sm2({repetitions:4,interval:12,ease:1.3},0,now),
  {repetitions:0,interval:1,ease:1.3,due:'2027-01-01'}));
for (const grade of [-1, 6, 2.5, '5', NaN]) test(`SM-2 rejects invalid grade ${String(grade)}`, () => assert.throws(() => sm2(null, grade, now),RangeError));

for (const [key, enabled, state, expected] of [
  ['r',false,{},null], ['r',true,{},'analyze'], ['e',true,{},'editor'], ['R',true,{},null], ['x',true,{},null],
  ['constructor',true,{},null], ['r',true,{repeat:true},null], ['r',true,{defaultPrevented:true},null],
  ['r',true,{isComposing:true},null], ['r',true,{ctrlKey:true},null], ['r',true,{metaKey:true},null],
  ['r',true,{altKey:true},null], ['r',true,{shiftKey:true},null], ['r',true,{target:{isContentEditable:true}},null],
  ['e',true,{target:{closest:() => ({})}},null], ['e',true,{target:{closest:() => null}},'editor']
]) test(`shortcut gate ${JSON.stringify([key,enabled,state])}`, () => assert.equal(shortcutAction({key,...state},enabled),expected));
test('shortcut guard covers editable and native controls', () => {
  shortcutAction({key:'e',target:{closest: selector => {
    for (const x of ['textarea','select','input','button','summary','contenteditable','role="textbox"']) assert.ok(selector.includes(x));
    return null;
  }}}, true);
});

test('shipped text files satisfy wording and motion checks', async () => {
  const root = new URL('../', import.meta.url);
  const files = ['index.html','styles.css','README.md','PRODUCT.md','DESIGN.md','package.json','.impeccable/design.json','docs/evaluation.json'];
  for (const folder of ['src', 'scripts', 'test']) {
    for (const name of await readdir(new URL(`${folder}/`, root))) files.push(`${folder}/${name}`);
  }
  for (const name of files) {
    const source = await readFile(new URL(name, root),'utf8');
    assert.doesNotMatch(source, /[\u2013\u2014]/, name);
    assert.doesNotMatch(source, /\b(?:\x41\x49|artificial\x20intelligence|\x43hatGPT|\x43laude)\b/i, name);
    assert.doesNotMatch(source, /scroll-behavior\s*:\s*smooth/i, name);
  }
});
test('UI uses a restrictive CSP before script and stylesheet references', async () => {
  const source = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(source, /connect-src 'none'/);
  assert.match(source, /require-trusted-types-for 'script'/);
  assert.ok(source.indexOf('Content-Security-Policy') < source.indexOf('<script'));
  assert.doesNotMatch(source, /(?:href|src)="https?:\/\//);
});

test('anki TSV rows can never become directives', () => {
  const out = ankiTSV([{front: '#deck:evil', back: '#tags:spam', sourceStart: 0, sourceEnd: 5}]);
  const lines = out.trimEnd().split('\n');
  assert.equal(lines.length, 4);
  assert.match(lines[3], /^ #deck:evil\t #tags:spam/);
});

test('anki fields strip all control and separator characters', () => {
  const out = ankiTSV([{front: 'a\u000bb\u000cc\u2029d', back: 'ok', sourceStart: 0, sourceEnd: 1}]);
  assert.ok(out.includes('a b c d\tok'));
});

test('anki source citations are sanitized like the fields', () => {
  const out = ankiTSV([{front: 'a', back: 'b', sourceStart: '0\tINJECT', sourceEnd: '2\nev#il'}]);
  assert.ok(out.includes('Source [0 INJECT, 2 ev#il)'));
});

test('CSV formula guard catches invisible format prefixes', () => {
  const out = reviewCSV([{front: '\u200b=cmd', back: 'x', sourceStart: 0, sourceEnd: 1}], null);
  assert.ok(out.includes(`"'${'\u200b'}=cmd"`), out);
  const nb = reviewCSV([{front: '\u00a0\u0009=x', back: 'x', sourceStart: 0, sourceEnd: 1}], null);
  assert.ok(nb.includes(`"'${'\u00a0'}${'\u0009'}=x"`), nb);
});

test('canonical JSON mirrors BigInt and Symbol wrapper behavior', () => {
  assert.throws(() => canonicalJSON(Object(10n)), TypeError);
  assert.equal(canonicalJSON({a: Object(Symbol('x')), b: 2}), '{"b":2}');
  assert.equal(canonicalJSON({a: Object(3), b: Object('s'), c: Object(true)}), '{"a":3,"b":"s","c":true}');
});

test('shortcut guard covers ARIA text-entry and menu roles', () => {
  for (const role of ['searchbox', 'gridcell', 'option', 'menuitem', 'treeitem']) {
    const event = { key: 'r', target: { isContentEditable: false, closest: sel => sel.includes(role) ? {} : null } };
    assert.equal(shortcutAction(event, true), null, role);
  }
});
