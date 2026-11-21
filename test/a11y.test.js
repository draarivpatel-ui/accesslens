import assert from 'node:assert/strict';
import test from 'node:test';
import { auditHTML, capsDiagnostic, contrastRatio, hexRGB, luminance, RULES } from '../src/a11y.js';
import { decodeEntities, extractHTML, tokenizeHTML } from '../src/tokenize.js';
import { auditCases } from '../scripts/evaluation-corpus.mjs';

const html = body => `<!doctype html><html lang="en"><head><title>Studio test</title></head><body>${body}</body></html>`;
const issues = body => auditHTML(html(body)).map(issue => issue.id);
const extract = source => extractHTML(tokenizeHTML(source));

test('the audit exposes 12 check IDs including two ergonomics rules', () => {
  assert.equal(Object.keys(RULES).length, 12);
  assert.equal(Object.values(RULES).filter(r => r[2] === 'ergonomic').length, 2);
});
for (const {id, source, labels} of auditCases) test(`frozen accessibility case ${id}`, () => {
  assert.deepEqual(auditHTML(source).map(i => [i.id, source.slice(i.start, i.end)]).sort(), labels.map(x => x.slice(0, 2)).sort());
});

for (const [body, expected] of [
  ['<h1>Home</h1><h2>Room</h2><h3>Desk</h3><h1>Other</h1>', []],
  ['<h1>See</h1><h2></h2><h2>Next</h2>', ['empty-heading']],
  ['<h4>Starts late</h4>', ['heading-order']],
  ['<h1><img alt="Club"></h1>', []],
  ['<h1 aria-label="Calendar"></h1>', []],
  ['<img alt=""><img role="presentation"><img aria-label="Leaf">', []],
  ['<img ALT="silhouette" src="/l">', []],
  ['<a id="section">Here</a>', []],
  ['<a href="/test">Read more.</a>', ['link-purpose']],
  ['<a href="/test" aria-label="Open test schedule">Here</a>', []],
  ['<a href="/test"><span><img alt="Room plan"></span></a>', []],
  ['<input type="hidden"><input type="submit"><input type="reset">', []],
  ['<input type="image" src="save.png">', ['button-name']],
  ['<input type="image" src="save.png" alt="Save work">', []],
  ['<input type="button" value="">', ['button-name']],
  ['<label for="n"> </label><input id="n">', ['input-label']],
  ['<label for="m">Name<input id="n"></label>', ['input-label']],
  ['<label for="n">Name</label><input id="n">', []],
  ['<span id="n">Name</span><input aria-labelledby="absent n">', []],
  ['<input aria-labelledby="absent">', ['input-label']],
  ['<span id="n"></span><span id="n">Duplicate</span><input aria-labelledby="n">', ['input-label']],
  ['<button><span>Save</span></button>', []],
  ['<button aria-label=" "></button>', ['button-name']],
  ['<iframe title="Calendar">Fallback</iframe>', []],
  ['<iframe title="">Fallback</iframe>', ['frame-title']],
  ['<select></select><textarea></textarea>', ['input-label','input-label']],
  ['<label>Note <textarea></textarea></label>', []],
  ['<div style="display:none"><button></button><img></div>', []],
  ['<h1>Club</h1><h3 hidden>Draft</h3><h2>Time</h2>', []]
]) test(`specific audit behavior ${body}`, () => assert.deepEqual(issues(body), expected));

for (const [first, second, expected] of [
  ['#000','#fff',21], ['#fff','#000',21], ['#fff','#fff',1], ['#112233','#123',1],
  ['#777','#fff',4.478089453577214], ['#767676','#fff',4.542224959605253],
  ['#000000','#ff0000',5.252], ['#000000','#00ff00',15.304], ['#000000','#0000ff',2.444],
  ['#abc','#AABBCC',1], ['black','#fff',null], ['#0000','#fff',null], ['#00000000','#fff',null], ['#xyz','#fff',null]
]) test(`contrast ratio ${first} against ${second}`, () => {
  const actual = contrastRatio(first, second);
  if (expected === null) assert.equal(actual, expected);
  else assert.ok(Math.abs(actual - expected) < 1e-10);
});
test('hex RGB expands shorthand', () => assert.deepEqual(hexRGB('#0fA'), [0, 1, 170 / 255]));
test('sRGB uses the nonlinear breakpoint', () => {
  const color = [10/255, 11/255, 0];
  const expected = .2126 * (10/255/12.92) + .7152 * ((11/255 + .055)/1.055) ** 2.4;
  assert.ok(Math.abs(luminance(color) - expected) < 1e-14);
});
for (const [style, phrase, expected] of [
  ['color:#777;background:#fff;font-size:23.99px','Text',['contrast']],
  ['color:#777;background:#fff;font-size:24px','Text',[]],
  ['color:#777;background:#fff;font-size:18.7px;font-weight:700','Text',[]],
  ['color:#777;background:#fff;font-size:18.6px;font-weight:700','Text',['contrast']],
  ['color:#777;background:#fff;font-size:14pt;font-weight:bold','Text',[]], // Exact point-to-pixel cutoff.
  ['color:#777;background:#fff;font-size:14pt;font-weight:bolder','Text',['contrast']],
  ['color:#aaa;background-color:#fff;background-image:linear-gradient(#fff,#aaa)','Text',[]],
  ['color:#aaa;background:#fff;opacity:0.9','Text',[]],
  ['color:#aaa;background:#fff;color:#000','Text',[]],
  ['color:#aaa!important;background:#fff;color:#000','Text',['contrast']],
  ['color:#aaa','Text',[]], ['background:#fff','Text',[]], ['font-size:8pt','Text',['tiny-text']],
  ['font-size:9pt','Text',[]], ['font-size:.8rem','Text',[]],
  ['background:#fff;color:#aaa','<strong>Text</strong>',['contrast']],
  ['background:#fff;color:#aaa','<strong style="color:#111">Text</strong>',[]],
  ['background-image:linear-gradient(#fff,#aaa);color:#aaa','<strong style="background-color:#fff">Text</strong>',['contrast']]
]) test(`inline style evidence ${style} ${phrase}`, () => assert.deepEqual(issues(`<p style="${style}">${phrase}</p>`), expected));

test('caps heuristic preserves source offsets', () => {
  const check = capsDiagnostic('BRING SOMETHING TO CLASS TODAY', 5, 36);
  assert.deepEqual([check.id,check.start,check.end], ['caps-block',5,36]);
});
test('short capitals do not trigger caps threshold', () => assert.equal(capsDiagnostic('AP LAB MEETS'),null));
test('mixed case is not an all-caps block', () => assert.equal(capsDiagnostic('BRING the Lab folder to class.'),null));
test('valid document languages are accepted', () => assert.deepEqual(auditHTML(html('<h1>Page</h1>').replace('lang="en"', 'lang="en-GB"')), []));
test('invalid language syntax flags the exact anchor', () => {
  const source = html('<h1>Page</h1>').replace('lang="en"', 'lang="bad_tag"');
  const [issue] = auditHTML(source);
  assert.deepEqual([issue.id, source.slice(issue.start, issue.end)], ['language','<html lang="bad_tag">']);
});
test('fragment asks for language when treated as an exported document', () => {
  const [issue] = auditHTML('<p>Text</p>');
  assert.deepEqual([issue.id, issue.start, issue.end], ['language',0,0]);
});

for (const [source, expected] of [
  ['<p>Paper &amp; pencil.</p>', 'Paper & pencil.'],
  ['<p>A &lt;b&gt; B</p>', 'A <b> B'],
  ['<p>One &nbsp; two.</p>', 'One two.'],
  ['<p>One</p><p>Two</p>', 'One\nTwo'],
  ['<p>One<br>Two</p>', 'One\nTwo'],
  ['<p>School<span>work</span></p>', 'Schoolwork'],
  ['<p>D<span>ata</span> file.</p>', 'Data file.'],
  ['<p>before<!-- ignore -->after</p>', 'beforeafter'],
  ['<p>A<img alt="map">B</p>', 'A map B'],
  ['<p><img alt=""></p>', ''],
  ['<div hidden><p>Do not show</p></div><p>Show</p>', 'Show'],
  ['<p style="display: none">Hidden</p><p>Show</p>', 'Show'],
  ['<head><title>Title</title></head><body>Body</body>', 'Body'],
  ['<style>p {display:none}</style><p>Text</p>', 'Text'],
  ['<script>console.log("inert")</script><p>Visible</p>', 'Visible'],
  ['<script>inert</scripture>also inert</script><p>Visible</p>', 'Visible'],
  ['<template><button>Hidden</button></template>Text', 'Text'],
  ['<iframe>Ignored fallback</iframe><p>Text</p>', 'Text'],
  ['<span title=">">OK</span>', 'OK'],
  ['<img ALT=Name alt="Other">', 'Name'],
  ['<p>3 < 4 and 5 > 4.</p>', '3 < 4 and 5 > 4.'],
  ['<p>Unknown &madeup; entity.</p>', 'Unknown &madeup; entity.'],
  ['<p>Symbol &#128270;</p>', 'Symbol \uD83D\uDD0E'],
  ['<li>One<li>Two', 'One\nTwo'],
  ['<p>One<p>Two', 'One\nTwo']
]) test(`inert extraction ${source}`, () => assert.equal(extract(source).text, expected));

test('entity map points each supplementary character code unit back to its source', () => {
  const source = '<p>x&#x1f50e;y</p>';
  const {text, starts, ends} = extract(source);
  assert.equal(text.length, 4);
  assert.equal(starts.length, text.length);
  for (let i = 1; i < 3; i++) assert.equal(source.slice(starts[i], ends[i]), '&#x1f50e;');
});
test('bad numeric entities use a replacement character', () => assert.equal(decodeEntities('&#0; &#xD800; &#x110000;'), '\ufffd \ufffd \ufffd'));
test('parser does not treat prototype-like attributes as inherited keys', () => assert.equal(tokenizeHTML('<p constructor="text">X</p>').elements[0].attrs.constructor, 'text'));
test('parser reports depth termination instead of recursing', () => {
  const result = tokenizeHTML('<div>'.repeat(10000));
  assert.equal(result.limited, true);
  assert.ok(result.elements.length < 100);
});

test('abrupt comment closers do not swallow the rest of the document', () => {
  assert.equal(extract('<p>one</p><!--><p>two</p>').text, 'one\ntwo');
  assert.equal(extract('<p>one</p><!---><p>two</p>').text, 'one\ntwo');
  assert.equal(extract('<p>aaa</p><!-- c --!><p>bbb</p>').text, 'aaa\nbbb');
  assert.equal(extract('<p>a</p><!-- unclosed').text, 'a');
});

test('plaintext content is extracted as raw text', () => {
  assert.equal(extract('<p>before</p><plaintext>AFTER <i>RAW</i> TEXT').text, 'before\nAFTER <i>RAW</i> TEXT');
});

test('a very long tag still parses instead of leaking markup as text', () => {
  const source = '<div title="' + 'A'.repeat(5000) + '">MARKER</div>';
  assert.equal(extract(source).text, 'MARKER');
});

test('preformatted whitespace is preserved', () => {
  assert.equal(extract('<pre>line1\n   line2\n\tline3</pre>').text, 'line1\n   line2\n\tline3');
});

test('textarea default value and xmp raw text are extracted', () => {
  assert.equal(extract('<textarea>DEFAULT VALUE</textarea>').text, 'DEFAULT VALUE');
  assert.equal(extract('<xmp>RAW <b>TEXT</b></xmp>').text, 'RAW <b>TEXT</b>');
});

test('a stray closing br is treated as a line break', () => {
  assert.equal(extract('<p>a</br>b</p>').text, 'a\nb');
});

test('a nested anchor closes the outer anchor', () => {
  const parsed = tokenizeHTML('<div><a href="/1">one<a href="/2">two</a></a></div>');
  const links = parsed.elements.filter(e => e.tag === 'a');
  assert.equal(links.length, 2);
  assert.equal(links[0].label.trim(), 'one');
  assert.equal(links[1].label.trim(), 'two');
  assert.notEqual(links[1].parent?.tag, 'a');
});

test('aria-hidden content is invisible to the audit but still extracted', () => {
  assert.ok(issues('<h1>A</h1><h2><span aria-hidden="true">Secret</span></h2>').includes('empty-heading'));
  assert.equal(extract('<p><span aria-hidden="true">Secret</span> text</p>').text, 'Secret text');
});

test('extra named entities decode including inside style attributes', () => {
  assert.equal(decodeEntities('&LT;b&GT; a&colon;b'), '<b> a:b');
  assert.equal(extract('<div style="display&colon;none">x</div>').text, '');
});

test('a transparent background shorthand does not disable contrast checks', () => {
  assert.ok(issues('<div style="background:#fff"><p style="color:#aaa;background:transparent">sample text for the audit here</p></div>').includes('contrast'));
});

test('the font shorthand feeds size and weight into contrast and tiny-text', () => {
  assert.equal(issues('<p style="font:24px serif;color:#797979;background:#fff">large sample</p>').filter(i => i === 'contrast').length, 0);
  assert.ok(issues('<p style="font:8pt serif;color:#111;background:#fff">tiny sample</p>').includes('tiny-text'));
});

test('all-caps text nested in inline elements is still flagged', () => {
  assert.ok(issues('<p><span>THIS IS A LONG ALL CAPS SENTENCE FOR TESTING</span></p>').includes('caps-block'));
});

test('accessible names resolve through img alt, hidden references and svg titles', () => {
  assert.equal(issues('<span id="i"><img alt="Save icon"></span><button aria-labelledby="i"></button>').filter(i => i === 'button-name').length, 0);
  assert.equal(issues('<div hidden id="x">Secret name</div><button aria-labelledby="x"></button>').filter(i => i === 'button-name').length, 0);
  assert.equal(issues('<button><svg><title>Save</title></svg></button>').filter(i => i === 'button-name').length, 0);
});

test('a title attribute satisfies the empty-heading check like sibling name rules', () => {
  assert.equal(issues('<h1>Top</h1><h2 title="Named section"></h2>').filter(i => i === 'empty-heading').length, 0);
});

test('area hrefs are audited for link purpose and objects for titles', () => {
  assert.ok(issues('<map name="m"><area href="/x"></map>').includes('link-purpose'));
  assert.equal(issues('<map name="m"><area href="/x" alt="Campus map"></map>').filter(i => i === 'link-purpose').length, 0);
  assert.ok(issues('<object data="/o"></object>').includes('frame-title'));
  assert.ok(issues('<embed src="/e">').includes('frame-title'));
  assert.equal(issues('<object data="/o" title="Chart"></object>').filter(i => i === 'frame-title').length, 0);
});

test('ancestor labels from image alt text honor the shared length cap', () => {
  const parsed = tokenizeHTML(`<a href="/x"><img alt="${'A'.repeat(3900)}"></a>`);
  assert.equal(parsed.elements.find(e => e.tag === 'a').label.length <= 2048, true);
});
