import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES } from '../src/a11y.js';
import { presets } from '../src/presets.js';
import { inspectDocument } from '../src/remediate.js';
import { AUDIENCES, BARRIERS, EFFORT, FIXES, FORMATS, WHO, buildFixCards, cognitiveView, documentTitle,
  formatPack, keyboardPath, packSummary, screenReaderScript } from '../src/handoff.js';
import { COGNITIVE_LOAD_WORDS, compareReports, sentenceHistogram } from '../src/wcag-audit.js';

const report = id => { const p = presets.find(x => x.id === id); return inspectDocument(p.source, p.mode); };
const html = body => inspectDocument(`<!doctype html><html lang="en"><head><title>T</title></head><body>${body}</body></html>`, 'html');
const DASH = new RegExp('[\\u2013\\u2014]');

for (const id of Object.keys(RULES)) {
  test(`every audit rule has a Fix Card: ${id}`, () => {
    const fix = FIXES[id];
    assert.ok(fix, id);
    assert.ok(fix.title && fix.why && fix.steps.length && fix.sc);
    assert.ok(fix.who.length && fix.who.every(k => WHO[k]));
    assert.ok(EFFORT[fix.effort]);
  });
}

for (const [id, fix] of Object.entries(FIXES)) {
  test(`Fix Card copy is plain and dash free: ${id}`, () => {
    for (const text of [fix.title, fix.why, fix.sc, ...fix.steps]) {
      assert.ok(!DASH.test(text), text);
      assert.ok(text.length < 240);
    }
    assert.match(fix.sc, /^(\d\.\d\.\d+ .+\((A|AA|AAA)\)|Reading heuristic.*|Plain language guideline.*)$/);
  });
}

const CASES = [
  ['language', '<!doctype html><html><head><title>T</title></head><body><p>Hi there.</p></body></html>'],
  ['page-title', '<!doctype html><html lang="en"><head></head><body><p>Hi there.</p></body></html>'],
  ['heading-order', null, '<h1>A</h1><h3>B</h3>'],
  ['empty-heading', null, '<h1>A</h1><h2></h2>'],
  ['image-alt', null, '<img src="a.png">'],
  ['link-purpose', null, '<a href="/x">Click here</a>'],
  ['input-label', null, '<input type="text">'],
  ['button-name', null, '<button></button>'],
  ['frame-title', null, '<iframe src="/m"></iframe>'],
  ['contrast', null, '<p style="color:#aaa;background:#fff">Pale words here.</p>'],
  ['tiny-text', null, '<p style="font-size:9px">Tiny words here.</p>'],
  ['caps-block', null, '<p>THIS WHOLE PARAGRAPH IS WRITTEN IN CAPITAL LETTERS FOR NO REASON.</p>']
];
for (const [id, full, body] of CASES) {
  test(`a page with only ${id} yields a ${id} card`, () => {
    const r = full ? inspectDocument(full, 'html') : html(body);
    const cards = buildFixCards(r);
    const card = cards.find(c => c.id === id);
    assert.ok(card, `${id} in ${cards.map(c => c.id)}`);
    assert.ok(card.count >= 1);
    assert.ok(card.lines.every(n => Number.isInteger(n) && n >= 1));
  });
}

test('text findings yield long-sentence, jargon and passive cards', () => {
  const ids = buildFixCards(report('biology')).map(c => c.id);
  for (const id of ['long-sentence', 'jargon', 'passive']) assert.ok(ids.includes(id), id);
});

test('a hard document yields a reading-level card', () => {
  const text = 'Notwithstanding considerable institutional complexity, the administrative apparatus necessitates comprehensive documentation regarding organizational responsibilities. Consequently, departmental representatives must systematically communicate preliminary determinations.';
  assert.ok(buildFixCards(inspectDocument(text, 'text')).some(c => c.id === 'reading-level'));
});

test('a clean plain document yields no cards', () => {
  assert.deepEqual(buildFixCards(inspectDocument('The bus comes at nine. Bring your card. Sit near the front.', 'text')), []);
});

test('buildFixCards handles a missing report', () => assert.deepEqual(buildFixCards(null), []));

test('club example cards are ordered high, medium, low', () => {
  const cards = buildFixCards(report('club'));
  const rank = { high: 0, medium: 1, low: 2 };
  for (let i = 1; i < cards.length; i++) assert.ok(rank[cards[i - 1].priority] <= rank[cards[i].priority]);
  assert.equal(cards[0].priority, 'high');
  assert.equal(cards.length, 13);
});

test('priority follows the WCAG level in the criterion', () => {
  for (const c of buildFixCards(report('club'))) {
    if (c.level === 'A') assert.equal(c.priority, 'high');
    else if (c.level === 'AA') assert.equal(c.priority, 'medium');
    else assert.equal(c.priority, 'low');
  }
});

test('line numbers point at the offending source line', () => {
  const r = report('club');
  const lines = r.source.split('\n');
  const img = buildFixCards(r).find(c => c.id === 'image-alt');
  assert.match(lines[img.lines[0] - 1], /<img/);
  const link = buildFixCards(r).find(c => c.id === 'link-purpose');
  assert.match(lines[link.lines[0] - 1], /Click here/);
});

test('jargon terms skip all-caps blocks and keep their case', () => {
  const card = buildFixCards(report('club')).find(c => c.id === 'jargon');
  assert.deepEqual(card.terms, ['RSVP']);
  const aid = buildFixCards(report('aid')).find(c => c.id === 'jargon');
  assert.ok(aid.terms.includes('FAFSA'));
});

test('an acronym explained in parentheses is not flagged', () => {
  const r = inspectDocument('Fill out the FAFSA (federal student aid form) today. It is free.', 'text');
  assert.ok(!buildFixCards(r).some(c => c.id === 'jargon'));
});

test('packSummary counts priorities, quick fixes and groups', () => {
  const cards = buildFixCards(report('club'));
  const s = packSummary(cards);
  assert.equal(s.total, cards.length);
  assert.equal(s.high + s.medium + s.low, s.total);
  assert.equal(s.quick, cards.filter(c => c.effort === 'quick').length);
  assert.ok(s.people.length >= 3);
});

test('documentTitle prefers the title, then a heading, then the first line', () => {
  assert.equal(documentTitle(report('club')), 'Design club build night');
  assert.equal(documentTitle(inspectDocument('<!doctype html><html><head><title>Food bank hours</title></head><body><h1>X</h1></body></html>', 'html')), 'Food bank hours');
  assert.equal(documentTitle(report('biology')), 'AP Biology | Membrane transport lab');
});

for (const format of Object.keys(FORMATS)) {
  for (const audience of Object.keys(AUDIENCES)) {
    test(`formatPack ${format} for ${audience} lists every card and has no long dashes`, () => {
      const cards = buildFixCards(report('club'));
      const text = formatPack(cards, { format, audience, title: 'Build night' });
      for (const c of cards) assert.ok(text.includes(c.title), c.title);
      assert.ok(!DASH.test(text));
      assert.ok(text.includes('Build night'));
      if (format === 'email') assert.ok(text.startsWith('Subject: ') && text.includes(AUDIENCES[audience].greeting));
      if (format === 'github') assert.ok(text.startsWith('## ') && (text.match(/- \[ \]/g) || []).length >= cards.length);
      if (format === 'checklist') assert.ok((text.match(/\[ \]/g) || []).length >= cards.length);
    });
  }
}

test('formatPack email grammar for one quick fix', () => {
  const cards = buildFixCards(html('<img src="a.png">'));
  const text = formatPack(cards, { format: 'email', title: 'X' });
  assert.match(text, /found 1 thing to fix, and one takes only a few minutes:/);
});

test('formatPack handles an empty pack in every format', () => {
  for (const format of Object.keys(FORMATS)) assert.match(formatPack([], { format, title: 'X' }), /No (accessibility )?findings/);
});

test('formatPack strips line breaks from the title', () => {
  const text = formatPack(buildFixCards(report('club')), { format: 'github', title: 'A\nB' });
  assert.ok(text.startsWith('## Accessibility fixes for A B'));
});

test('keyboardPath lists focusable controls in source order with problems', () => {
  const stops = keyboardPath(report('club'));
  assert.deepEqual(stops.map(s => s.role), ['Link', 'Edit text', 'Button', 'Frame']);
  assert.deepEqual(stops.map(s => s.stop), [1, 2, 3, 4]);
  assert.ok(stops.every(s => s.problem));
  assert.equal(stops[0].name, 'Click here');
});

test('keyboardPath skips hidden, negative tabindex and hidden inputs', () => {
  const stops = keyboardPath(html('<a href="/a">Home</a><a href="/b" tabindex="-1">Skip</a><input type="hidden"><div hidden><button>X</button></div><button>Send RSVP</button>'));
  assert.deepEqual(stops.map(s => s.name), ['Home', 'Send RSVP']);
  assert.ok(stops.every(s => !s.problem));
});

const NAMED_CONTROLS = [
  ['associated label', '<label for="email">Email address</label><input id="email" type="email">', 'Edit text', 'Email address'],
  ['enclosing label', '<label>Phone number <input type="tel"></label>', 'Edit text', 'Phone number'],
  ['multiple referenced labels', '<span id="send">Send</span><span id="message">message</span><button aria-labelledby="send message"></button>', 'Button', 'Send message'],
  ['hidden referenced text', '<span id="send" hidden>Send message</span><button aria-labelledby="send"></button>', 'Button', 'Send message'],
  ['referenced image alternative', '<span id="send"><img src="send.svg" alt="Send message"></span><button aria-labelledby="send"></button>', 'Button', 'Send message'],
  ['referenced label before aria-label', '<span id="send">Send message</span><button aria-labelledby="send" aria-label="Other"></button>', 'Button', 'Send message'],
];
for (const [kind, source, role, name] of NAMED_CONTROLS) {
  test('handoff resolves ' + kind + ' consistently with the audit', () => {
    const r = html(source);
    assert.ok(!r.issues.some(issue => ['input-label', 'button-name'].includes(issue.id)));
    assert.deepEqual(keyboardPath(r).map(step => step.name), [name]);
    const line = screenReaderScript(r).find(line => line.text === role + ', "' + name + '"');
    assert.ok(line, 'screen reader must announce the valid name');
    assert.equal(line.problem, null);
    assert.ok(!screenReaderScript(r).some(line => line.problem === 'No accessible name' || line.text.endsWith(', unlabeled')));
  });
}

test('keyboardPath excludes disabled native controls', () => {
  const r = html('<button disabled>Unavailable</button><input disabled aria-label="Unavailable field">' +
    '<select disabled aria-label="Unavailable choices"><option>A</option></select>' +
    '<textarea disabled aria-label="Unavailable notes"></textarea><button>Available</button>');
  assert.deepEqual(keyboardPath(r).map(step => step.name), ['Available']);
});

test('keyboardPath exempts only the first legend of a disabled fieldset', () => {
  const r = html('<fieldset disabled><legend>Contact <input aria-label="Legend field"></legend>' +
    '<button>Disabled child</button><legend>Later <input aria-label="Later legend field"></legend></fieldset>' +
    '<button>Available</button>');
  assert.deepEqual(keyboardPath(r).map(step => step.name), ['Legend field', 'Available']);
});

test('keyboardPath checks every disabled fieldset ancestor and keeps noncontrols focusable', () => {
  const r = html('<fieldset disabled><legend>Outer <button>Outer legend</button>' +
    '<fieldset disabled><legend>Inner <button>Both legends</button></legend><button>Inner blocked</button></fieldset>' +
    '</legend><button>Outer blocked</button><a href="/link" disabled>Link</a></fieldset>');
  assert.deepEqual(keyboardPath(r).map(step => step.name), ['Outer legend', 'Both legends', 'Link']);
});

test('keyboardPath orders positive tabindex before natural and zero order with stable ties', () => {
  const r = html('<button>Natural</button><button tabindex="2">Second</button><button tabindex="1">First</button>' +
    '<button tabindex="1">First tie</button><div tabindex="2" aria-label="Second tie"></div>' +
    '<button tabindex="0">Zero</button><a href="/">Home</a><button tabindex="-1">Skip</button>');
  const path = keyboardPath(r);
  assert.deepEqual(path.map(step => step.name), ['First', 'First tie', 'Second', 'Second tie', 'Natural', 'Zero', 'Home']);
  assert.deepEqual(path.map(step => step.stop), [1, 2, 3, 4, 5, 6, 7]);
});

for (const count of [24, 25, 26]) {
  for (const separator of [' ', '; ']) {
    test(count + ' words with ' + JSON.stringify(separator) + ' get the same cognitive-load verdict in analysis, histogram, badge and Fix Cards', () => {
      const text = Array(12).fill('word').join(' ') + separator + Array(count - 12).fill('word').join(' ') + '.';
      const r = inspectDocument(text, 'text');
      const overLimit = count > 25;
      assert.equal(r.stats.long.length, Number(overLimit));
      assert.equal(sentenceHistogram(text).overLimit, Number(overLimit));
      assert.equal(compareReports(r).badges.find(badge => badge.id === 'load').before, !overLimit);
      assert.equal(buildFixCards(r).some(card => card.id === 'long-sentence'), overLimit);
      assert.equal(cognitiveView(r.blocks).reduce((sum, block) => sum + block.faded, 0), Math.max(0, count - 25));
    });
  }
}

test('keyboardPath is empty for plain text', () => assert.deepEqual(keyboardPath(report('biology')), []));

test('screenReaderScript flags the club page problems', () => {
  const lines = screenReaderScript(report('club'));
  const said = lines.map(l => l.text);
  assert.equal(said[0], 'Page, untitled');
  assert.ok(said.includes('Image, "layout-example.png"'));
  assert.ok(said.includes('Heading level 6, empty'));
  assert.ok(said.includes('Click here for the signup page.'));
  assert.ok(lines.filter(l => l.problem).length >= 10);
});

test('screenReaderScript announces a visible disabled button that keyboardPath skips', () => {
  const r = html('<button disabled>Unavailable</button><button>Available</button>');
  assert.deepEqual(keyboardPath(r).map(step => step.name), ['Available']);
  assert.deepEqual(screenReaderScript(r), [
    { text: 'Page, "T"', problem: null },
    { text: 'Button, "Unavailable", disabled', problem: null },
    { text: 'Button, "Available"', problem: null }
  ]);
});

for (const [source, role, name] of [
  ['<input disabled aria-label="Unavailable field">', 'Edit text', 'Unavailable field'],
  ['<input type="button" disabled value="Unavailable action">', 'Button', 'Unavailable action'],
  ['<input type="submit" disabled value="Unavailable submit">', 'Button', 'Unavailable submit'],
  ['<input type="reset" disabled value="Unavailable reset">', 'Button', 'Unavailable reset'],
  ['<input type="image" disabled alt="Unavailable image">', 'Button', 'Unavailable image'],
  ['<select disabled aria-label="Unavailable choices"><option>A</option></select>', 'List box', 'Unavailable choices'],
  ['<textarea disabled aria-label="Unavailable notes"></textarea>', 'Edit text', 'Unavailable notes']
]) {
  test(`screenReaderScript announces the disabled state of ${name}`, () => {
    const r = html(source);
    assert.deepEqual(keyboardPath(r), []);
    assert.deepEqual(screenReaderScript(r), [
      { text: 'Page, "T"', problem: null },
      { text: `${role}, "${name}", disabled`, problem: null }
    ]);
  });
}

test('screenReaderScript announces inherited disabled state with the first legend exemption', () => {
  const r = html('<fieldset disabled><legend>Contact <input aria-label="Legend field"></legend>' +
    '<button>Disabled child</button><legend>Later <input aria-label="Later legend field"></legend></fieldset>' +
    '<button>Available</button>');
  assert.deepEqual(keyboardPath(r).map(step => step.name), ['Legend field', 'Available']);
  assert.deepEqual(screenReaderScript(r).map(line => line.text), [
    'Page, "T"', 'Edit text, "Legend field"', 'Button, "Disabled child", disabled',
    'Edit text, "Later legend field", disabled', 'Button, "Available"'
  ]);
});

test('screenReaderScript keeps source order independently of tabindex and disabled keyboard eligibility', () => {
  const r = html('<button tabindex="2">Second</button><button tabindex="-1" disabled>Unavailable</button>' +
    '<button tabindex="1">First</button><a href="/" tabindex="-1">Home</a>');
  assert.deepEqual(keyboardPath(r).map(step => step.name), ['First', 'Second']);
  assert.deepEqual(screenReaderScript(r).map(line => line.text), [
    'Page, "T"', 'Button, "Second"', 'Button, "Unavailable", disabled', 'Button, "First"', 'Link, "Home"'
  ]);
});

test('screenReaderScript still excludes hidden disabled controls', () => {
  const r = html('<button disabled hidden>Hidden button</button><div hidden><button disabled>Hidden child</button></div>' +
    '<button disabled aria-hidden="true">ARIA hidden</button><button disabled style="display:none">CSS hidden</button>' +
    '<input disabled type="hidden" aria-label="Hidden input"><select disabled hidden aria-label="Hidden choices"></select>' +
    '<textarea disabled style="visibility:hidden" aria-label="Hidden notes"></textarea><button>Available</button>');
  assert.deepEqual(keyboardPath(r).map(step => step.name), ['Available']);
  assert.deepEqual(screenReaderScript(r), [
    { text: 'Page, "T"', problem: null },
    { text: 'Button, "Available"', problem: null }
  ]);
});

test('screenReaderScript reads alt text and skips decorative images', () => {
  const said = screenReaderScript(html('<img src="a.png" alt="Students at laptops"><img src="b.png" alt="">')).map(l => l.text);
  assert.ok(said.includes('Image, "Students at laptops"'));
  assert.ok(!said.some(t => t.includes('b.png')));
});

test('screenReaderScript decodes entities in paragraph text', () => {
  const said = screenReaderScript(html('<p>Snacks &amp; drinks</p>')).map(l => l.text);
  assert.ok(said.includes('Snacks & drinks'));
});

test('screenReaderScript reads plain text blocks', () => {
  const lines = screenReaderScript(report('biology'));
  assert.equal(lines.length, report('biology').blocks.length);
  assert.ok(lines.every(l => !l.problem));
});

test('cognitiveView preserves the text and fades words past the limit', () => {
  const words = Array.from({ length: COGNITIVE_LOAD_WORDS + 5 }, (_, i) => `word${i}`).join(' ') + '.';
  const [block] = cognitiveView([{ kind: 'paragraph', text: words }]);
  assert.equal(block.tokens.map(t => t.text).join(''), words);
  assert.equal(block.faded, 5);
});

test('cognitiveView marks uncommon words hard and keeps common ones plain', () => {
  const [block] = cognitiveView([{ kind: 'paragraph', text: 'Ascertain the mass of the bag.' }]);
  const hard = block.tokens.filter(t => t.cls.includes('hard')).map(t => t.text);
  assert.ok(hard.includes('Ascertain'));
  assert.ok(!hard.includes('the'));
});

test('cognitiveView round-trips every preset block', () => {
  for (const p of presets) {
    const r = inspectDocument(p.source, p.mode);
    cognitiveView(r.blocks).forEach((b, i) => assert.equal(b.tokens.map(t => t.text).join(''), r.blocks[i].text));
  }
});

test('four barriers with unique ids', () => {
  assert.equal(BARRIERS.length, 4);
  assert.equal(new Set(BARRIERS.map(b => b.id)).size, 4);
});
