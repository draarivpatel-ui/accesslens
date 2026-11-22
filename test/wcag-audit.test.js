import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { contrastRatio } from '../src/a11y.js';
import {
  canonicalJSON, certificateCSV, certificateDoc, certificateJSON, certificateMarkdown, csv, verifyCertificate
} from '../src/exports.js';
import { presets } from '../src/presets.js';
import { buildReadingCopy, inspectDocument, PAPER_CSS } from '../src/remediate.js';
import { readability } from '../src/nlp.js';
import { runSelfTests, selfTests } from '../src/selftest.js';
import { sha256bytes, sha256hex } from '../src/sha256.js';
import {
  COGNITIVE_LOAD_WORDS, COPY_THEME, DYSLEXIA_SPACING, HISTOGRAM_BINS, READING_LEVEL_MAX_GRADE,
  SPACING_MIN, compareReports, encodeLensHash, fogFromStats, gunningFog, histogramGeometry,
  histogramSVG, jargonShare, longWordShare, parseLensHash, readingLevelPass, readingLevelSummary,
  semanticSummary, semanticTree, sentenceHistogram, textSpacingAudit, wcagContrast
} from '../src/wcag-audit.js';

const near = (a, b, epsilon = 1e-9) => assert.ok(Math.abs(a - b) <= epsilon, `${a} is not near ${b}`);
const ISSUED = '2026-01-02T03:04:05.000Z';
const club = presets.find(p => p.id === 'club');
const clubBefore = () => inspectDocument(club.source, club.mode);
const clubAfter = () => buildReadingCopy(clubBefore()).report;

// Pure-JS SHA-256 against FIPS 180-4 known-answer vectors.
for (const [message, expected] of [
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['a', 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ['message digest', 'f7846f55cf23e14eebeab5b4e1550cad5b509e3348fbc4efa3a1413d393cb650'],
  ['abcdefghijklmnopqrstuvwxyz', '71c480df93d6ae2f1efad1447c66c9525e316218cf51fc8d9ed832f2daf18b73'],
  ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  ['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 'db4bfcbd4da0cd85a60c3c37d3fbd8805c77f15fc6b1fdfe614ee0a7c8fdb4c0'],
  ['1234567890'.repeat(8), 'f371bc4a311f2b009eef952dd83ca80e2b60026c8e935592d0f9c308453c813e'],
  ['The quick brown fox jumps over the lazy dog', 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592'],
  ['The quick brown fox jumps over the lazy dog.', 'ef537f25c895bfa782526529a9b63d97aa631564d5d789c2b765448c8635fb6c'],
  ['a'.repeat(1000000), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0']
]) test(`sha256 known answer ${JSON.stringify(message.slice(0, 24))}`, () => assert.equal(sha256hex(message), expected));

for (const message of ['caf\u00e9 \uD83D\uDD0E', 'line one\nline two', 'x'.repeat(9999), '\u0000byte', '{"a":1,"b":2}', '  ', '0'.repeat(64)]) {
  test(`sha256 matches the runtime digest for ${JSON.stringify(message.slice(0, 20))}`, () => {
    assert.equal(sha256hex(message), createHash('sha256').update(message, 'utf8').digest('hex'));
  });
}
test('sha256bytes returns 32 bytes and agrees with the hex form', () => {
  const bytes = sha256bytes(new TextEncoder().encode('abc'));
  assert.equal(bytes.length, 32);
  assert.equal([...bytes].map(b => b.toString(16).padStart(2, '0')).join(''), sha256hex('abc'));
});
test('sha256 accepts raw bytes', () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 255]);
  assert.equal(sha256hex(bytes), createHash('sha256').update(bytes).digest('hex'));
});
test('sha256 hex output is 64 lowercase digits', () => {
  assert.match(sha256hex('anything'), /^[0-9a-f]{64}$/);
  assert.equal(sha256hex('anything'), sha256hex('anything'));
});
test('sha256 hashing honors UTF-8, not UTF-16', () => {
  assert.equal(sha256hex('\u00e9'), createHash('sha256').update('é', 'utf8').digest('hex'));
});

// WCAG contrast badges on exact sRGB relative luminance.
test('contrast badge null on unparseable colors', () => {
  assert.equal(wcagContrast('black', '#fff'), null);
  assert.equal(wcagContrast('#12345', '#fff'), null);
});
test('black on white is 21 to 1 and passes every level', () => {
  const check = wcagContrast('#000', '#fff');
  assert.equal(check.ratio, 21);
  assert.equal(check.aa, true);
  assert.equal(check.aaa, true);
});
test('contrast badge is symmetric', () => {
  assert.equal(wcagContrast('#fff', '#000').ratio, wcagContrast('#000', '#fff').ratio);
});
test('threshold constants match WCAG published values', () => {
  const normal = wcagContrast('#000', '#fff');
  const large = wcagContrast('#000', '#fff', { largeText: true });
  assert.equal(normal.aaMin, 4.5);
  assert.equal(normal.aaaMin, 7);
  assert.equal(large.aaMin, 3);
  assert.equal(large.aaaMin, 4.5);
});
test('#767676 on white passes AA but not AAA', () => {
  const check = wcagContrast('#767676', '#fff');
  near(check.ratio, 4.542224959605253);
  assert.equal(check.aa, true);
  assert.equal(check.aaa, false);
});
test('#777 on white fails both normal-text levels', () => {
  const check = wcagContrast('#777', '#fff');
  assert.equal(check.aa, false);
  assert.equal(check.aaa, false);
});
test('#777 on white passes as large text at AA but not AAA', () => {
  const check = wcagContrast('#777', '#fff', { largeText: true });
  assert.equal(check.aa, true);
  assert.equal(check.aaa, false);
});
test('#767676 on white clears AAA as large text', () => {
  assert.equal(wcagContrast('#767676', '#fff', { largeText: true }).aaa, true);
});
test('the reading copy palette clears AAA', () => {
  const check = wcagContrast(COPY_THEME.ink, COPY_THEME.background);
  near(check.ratio, 15.79, 0.01);
  assert.equal(check.aa, true);
  assert.equal(check.aaa, true);
});
test('the shared theme constant drives the exported stylesheet', () => {
  assert.equal(COPY_THEME.ink, '#14232b');
  assert.equal(COPY_THEME.background, '#fffdf4');
  assert.ok(PAPER_CSS.includes(COPY_THEME.ink) && PAPER_CSS.includes(COPY_THEME.background));
  assert.ok(Object.isFrozen(COPY_THEME));
});

// WCAG 1.4.12 text spacing audit.
test('the dyslexia profile clears every 1.4.12 minimum', () => {
  const audit = textSpacingAudit(DYSLEXIA_SPACING);
  assert.equal(audit.pass, true);
  for (const key of Object.keys(SPACING_MIN)) assert.equal(audit.props[key].pass, true, key);
});
test('published 1.4.12 minimums are preserved', () => {
  assert.equal(SPACING_MIN.letterSpacing, 0.12);
  assert.equal(SPACING_MIN.wordSpacing, 0.16);
  assert.equal(SPACING_MIN.lineHeight, 1.5);
  assert.equal(SPACING_MIN.paragraphSpacing, 2);
  assert.ok(Object.isFrozen(SPACING_MIN));
});
test('exact minimum values pass', () => {
  assert.equal(textSpacingAudit({ letterSpacing: 0.12, wordSpacing: 0.16, lineHeight: 1.5, paragraphSpacing: 2 }).pass, true);
});
for (const [key, values] of [
  ['letterSpacing', { letterSpacing: 0.11, wordSpacing: 0.16, lineHeight: 1.5, paragraphSpacing: 2 }],
  ['wordSpacing', { letterSpacing: 0.12, wordSpacing: 0.15, lineHeight: 1.5, paragraphSpacing: 2 }],
  ['lineHeight', { letterSpacing: 0.12, wordSpacing: 0.16, lineHeight: 1.49, paragraphSpacing: 2 }],
  ['paragraphSpacing', { letterSpacing: 0.12, wordSpacing: 0.16, lineHeight: 1.5, paragraphSpacing: 1.9 }]
]) test(`one cramped ${key} fails the whole audit`, () => {
  const audit = textSpacingAudit(values);
  assert.equal(audit.pass, false);
  assert.equal(audit.props[key].pass, false);
});
test('a missing measurement reports null instead of guessing', () => {
  const audit = textSpacingAudit({ letterSpacing: 0.12, wordSpacing: 0.16, lineHeight: 1.6 });
  assert.equal(audit.props.paragraphSpacing.pass, null);
  assert.equal(audit.props.paragraphSpacing.value, null);
  assert.equal(audit.pass, true);
});
test('an empty audit reports null overall', () => assert.equal(textSpacingAudit({}).pass, null));
test('non-number spacing values are not measured', () => {
  const audit = textSpacingAudit({ letterSpacing: 'wide', wordSpacing: 0.16, lineHeight: 1.6, paragraphSpacing: 2 });
  assert.equal(audit.props.letterSpacing.pass, null);
  assert.equal(audit.pass, true);
});

// WCAG 3.1.5 reading level signal.
test('the grade bound is lower-secondary grade 9', () => assert.equal(READING_LEVEL_MAX_GRADE, 9));
test('grade 9 exactly passes the 3.1.5 signal', () => assert.equal(readingLevelPass(9), true));
test('above grade 9 fails the 3.1.5 signal', () => {
  assert.equal(readingLevelPass(9.01), false);
  assert.equal(readingLevelPass(12), false);
});
test('below grade 9 passes', () => {
  assert.equal(readingLevelPass(0), true);
  assert.equal(readingLevelPass(2.28), true);
});
test('missing estimates report null, not a pass', () => {
  assert.equal(readingLevelPass(null), null);
  assert.equal(readingLevelPass(NaN), null);
  assert.equal(readingLevelPass(undefined), null);
  assert.equal(readingLevelPass('8'), null);
  assert.equal(readingLevelPass(Infinity), null);
});
test('the summary requires every available estimate', () => {
  assert.equal(readingLevelSummary([8.5, null]), true);
  assert.equal(readingLevelSummary([8.5, 10.2]), false);
  assert.equal(readingLevelSummary([9]), true);
  assert.equal(readingLevelSummary([]), null);
  assert.equal(readingLevelSummary([null, null]), null);
  assert.equal(readingLevelSummary(null), null);
});

// Gunning Fog and density shares.
test('Gunning Fog follows the published equation', () => {
  const stats = readability('Education helps. '.repeat(30).trim());
  near(fogFromStats(stats), 0.4 * (stats.words / stats.sentences + 100 * stats.polysyllables / stats.words));
});
test('Gunning Fog computes from raw text', () => {
  const text = 'Cat sat. Dog ran.';
  assert.equal(gunningFog(text), 0.4 * (4 / 2 + 0));
});
test('Gunning Fog is null without words or sentences', () => {
  assert.equal(gunningFog(''), null);
  assert.equal(gunningFog('   '), null);
  assert.equal(fogFromStats({ words: 0, sentences: 3, polysyllables: 0 }), null);
  assert.equal(fogFromStats(null), null);
});
test('Gunning Fog equals the stats-derived form', () => {
  const stats = readability('The committee subsequently utilized every methodology.');
  near(gunningFog('The committee subsequently utilized every methodology.'), fogFromStats(stats));
});
test('polysyllables raise the Fog estimate', () => {
  const simple = gunningFog('Cat sat. Dog ran.');
  const complex = gunningFog('Education facilitates. Matriculation commences.');
  assert.ok(complex > simple);
});
test('Gunning Fog is deterministic', () => assert.equal(gunningFog('One two three.'), gunningFog('One two three.')));
test('long-word share is the polysyllable fraction', () => {
  assert.equal(longWordShare({ words: 4, polysyllables: 1 }), 0.25);
  assert.equal(longWordShare({ words: 0, polysyllables: 0 }), null);
  assert.equal(longWordShare(null), null);
});
test('jargon share counts glossary terms per word', () => {
  const stats = readability('Use the FAFSA and the GPA today.');
  near(jargonShare({ words: stats.words, terms: [{}, {}] }), 2 / stats.words);
  assert.equal(jargonShare({ words: 10, terms: [] }), 0);
  assert.equal(jargonShare({ words: 0, terms: [] }), null);
});

// Sentence-length histogram.
test('the flag line is strictly over 25 words', () => assert.equal(COGNITIVE_LOAD_WORDS, 25));
test('an empty document histogram is all zeros', () => {
  const hist = sentenceHistogram('');
  assert.equal(hist.sentences, 0);
  assert.equal(hist.overLimit, 0);
  assert.equal(hist.max, 0);
  assert.deepEqual(hist.lengths, []);
  assert.equal(hist.bins.reduce((sum, bin) => sum + bin.count, 0), 0);
});
for (const [count, binIndex] of [[1, 0], [5, 0], [6, 1], [10, 1], [15, 2], [20, 3], [25, 4], [26, 5], [30, 5], [31, 6], [40, 6], [41, 7], [80, 7]]) {
  test(`a ${count}-word sentence lands in bin ${binIndex}`, () => {
    const hist = sentenceHistogram(`${'word '.repeat(count)}.`);
    assert.equal(hist.bins[binIndex].count, 1);
    assert.equal(hist.sentences, 1);
  });
}
test('bin counts conserve the sentence total', () => {
  const hist = sentenceHistogram('One. Two three. ' + 'word '.repeat(30) + '. Last.');
  assert.equal(hist.sentences, 4);
  assert.equal(hist.bins.reduce((sum, bin) => sum + bin.count, 0), 4);
});
test('25 words does not flag but 26 does', () => {
  const at = sentenceHistogram(`${'word '.repeat(25)}.`);
  const over = sentenceHistogram(`${'word '.repeat(26)}.`);
  assert.equal(at.overLimit, 0);
  assert.equal(over.overLimit, 1);
});
test('only the over-25 bins carry the load flag', () => {
  const hist = sentenceHistogram('Hi.');
  assert.deepEqual(hist.bins.map(bin => bin.load), [false, false, false, false, false, true, true, true]);
});
test('the top bin is open ended', () => assert.equal(HISTOGRAM_BINS.at(-1).max, Infinity));
test('the biology example histogram is stable', () => {
  const hist = sentenceHistogram(inspectDocument(presets[0].source, 'text').text);
  assert.deepEqual(hist.bins.map(bin => bin.count), [3, 4, 5, 0, 0, 1, 0, 1]);
  assert.equal(hist.overLimit, 2);
  assert.equal(hist.sentences, 14);
});
test('histogram reports the longest length seen', () => {
  const hist = sentenceHistogram('One. ' + 'word '.repeat(30) + '.');
  assert.equal(hist.max, 30);
});
test('frozen bin table cannot be edited', () => assert.ok(Object.isFrozen(HISTOGRAM_BINS)));

// Histogram geometry and exported SVG.
test('geometry emits one bar per bin', () => {
  const geo = histogramGeometry(sentenceHistogram('Hi.'));
  assert.equal(geo.bars.length, 8);
});
test('bar positions are ordered and equal width', () => {
  const geo = histogramGeometry(sentenceHistogram('One. Two. Three.'));
  for (let i = 1; i < geo.bars.length; i++) {
    assert.ok(geo.bars[i].x > geo.bars[i - 1].x);
    assert.equal(geo.bars[i].width, geo.bars[0].width);
  }
});
test('the tallest bar fills the plot area', () => {
  const hist = sentenceHistogram('One. ' + 'word '.repeat(9) + '. ' + 'word '.repeat(9) + '.');
  const geo = histogramGeometry(hist, { height: 120, top: 8, bottom: 16 });
  const tallest = geo.bars.find(b => b.height === Math.max(...geo.bars.map(x => x.height)));
  assert.equal(tallest.count, geo.maxCount);
  near(tallest.height, 120 - 8 - 16);
  near(tallest.y, 8);
});
test('empty bins draw zero-height bars', () => {
  const geo = histogramGeometry(sentenceHistogram('Hi.'));
  const empties = geo.bars.filter(bar => bar.count === 0);
  assert.ok(empties.every(bar => bar.height === 0));
});
test('geometry honors a custom size', () => {
  const geo = histogramGeometry(sentenceHistogram('Hi.'), { width: 200, height: 80 });
  assert.equal(geo.width, 200);
  assert.equal(geo.height, 80);
  assert.equal(geo.bars.at(-1).labelY, 76);
});
test('exported SVG is deterministic markup', () => {
  const hist = sentenceHistogram('One. ' + 'word '.repeat(30) + '.');
  const a = histogramSVG(hist);
  assert.equal(a, histogramSVG(hist));
  assert.match(a, /^<svg /);
  assert.ok(a.includes('role="img"'));
  assert.ok((a.match(/<rect /g) ?? []).length === 8);
});
test('exported SVG paints load bins brick and others petrol', () => {
  const svg = histogramSVG(sentenceHistogram('One. ' + 'word '.repeat(30) + '.'));
  assert.ok(svg.includes('fill="#8f2f1f"'));
  assert.ok(svg.includes('fill="#174962"'));
});
test('exported SVG escapes the title and survives empty input', () => {
  assert.ok(histogramSVG(sentenceHistogram(''), { title: 'a<b' }).includes('a&lt;b'));
  assert.doesNotMatch(histogramSVG(sentenceHistogram('')), /NaN/);
});

// URL-hash preset bookmarking.
for (const [hash, expected] of [
  ['#lens=club', 'club'], ['lens=club', 'club'], ['#lens=aid&x=1', 'aid'], ['#x=1&lens=club', 'club'],
  ['##lens=biology', 'biology'], ['#lens=reference', 'reference']
]) test(`lens hash ${hash} resolves ${expected}`, () => assert.equal(parseLensHash(hash)?.preset, expected));
for (const hash of ['', '#', null, undefined, '#lens=', '#lens', '#lens=Club', '#lens=a_b', '#lens=a b', '#lens=' + 'x'.repeat(41), '#other=club', '#lens= club']) {
  test(`lens hash ${JSON.stringify(hash)} resolves nothing`, () => assert.equal(parseLensHash(hash), null));
}
test('lens hash encodes round-trip for every preset', () => {
  for (const preset of presets) {
    const hash = encodeLensHash(preset.id);
    assert.equal(hash, `#lens=${preset.id}`);
    assert.equal(parseLensHash(hash)?.preset, preset.id);
  }
});
for (const bad of ['Club', '', 'a b', 'has.dot', null, undefined]) {
  test(`lens hash rejects ${JSON.stringify(bad)}`, () => assert.equal(encodeLensHash(bad), null));
}

// Screen-reader semantic tree.
test('an empty outline stays empty', () => {
  const tree = semanticTree([]);
  assert.deepEqual(tree.outline, []);
  assert.equal(tree.headings, 0);
  assert.equal(tree.blocks, 0);
});
test('blocks without headings stay at the top level', () => {
  const tree = semanticTree([{ kind: 'paragraph', text: 'One' }, { kind: 'paragraph', text: 'Two' }]);
  assert.equal(tree.outline.length, 2);
  assert.equal(tree.outline[0].type, 'block');
});
test('headings nest following blocks', () => {
  const tree = semanticTree([
    { kind: 'heading', level: 1, text: 'Title' },
    { kind: 'paragraph', text: 'Intro' },
    { kind: 'heading', level: 2, text: 'Part' },
    { kind: 'bullet', text: 'Item' }
  ]);
  assert.equal(tree.outline.length, 1);
  assert.equal(tree.outline[0].children.length, 2);
  assert.equal(tree.outline[0].children[1].level, 2);
  assert.equal(tree.outline[0].children[1].children[0].kind, 'bullet');
  assert.equal(tree.headings, 2);
});
test('a skipped level still nests under the nearest smaller heading', () => {
  const tree = semanticTree([
    { kind: 'heading', level: 1, text: 'Top' },
    { kind: 'heading', level: 4, text: 'Deep' },
    { kind: 'paragraph', text: 'Body' }
  ]);
  assert.equal(tree.outline[0].children[0].level, 4);
  assert.equal(tree.outline[0].children[0].children[0].text, 'Body');
});
test('a later level-1 heading starts a new branch', () => {
  const tree = semanticTree([
    { kind: 'heading', level: 2, text: 'First' },
    { kind: 'heading', level: 1, text: 'Second' }
  ]);
  assert.equal(tree.outline.length, 2);
});
test('heading levels clamp into 1 to 6', () => {
  const tree = semanticTree([
    { kind: 'heading', level: 9, text: 'High' },
    { kind: 'paragraph', text: 'Nested' },
    { kind: 'heading', level: 'x', text: 'Low' }
  ]);
  assert.equal(tree.outline[0].level, 6);
  assert.equal(tree.outline[0].children[0].text, 'Nested');
  assert.equal(tree.outline[1].level, 1);
});
test('glossary terms attach to their containing block by offset', () => {
  const tree = semanticTree(
    [
      { kind: 'paragraph', text: 'See FAFSA.', start: 0, end: 10 },
      { kind: 'paragraph', text: 'Plain text.', start: 11, end: 22 }
    ],
    [{ text: 'FAFSA', explanation: 'Free Application for Federal Student Aid', start: 4, end: 9 }]
  );
  assert.equal(tree.outline[0].terms.length, 1);
  assert.equal(tree.outline[0].terms[0].explanation, 'Free Application for Federal Student Aid');
  assert.equal(tree.outline[1].terms.length, 0);
});
test('terms outside every block are dropped from the outline', () => {
  const tree = semanticTree([{ kind: 'paragraph', text: 'Short.', start: 0, end: 6 }], [{ text: 'GPA', start: 90, end: 93 }]);
  assert.equal(tree.outline[0].terms.length, 0);
});
test('unexplained terms keep a null explanation', () => {
  const tree = semanticTree([{ kind: 'paragraph', text: 'X Y Z', start: 0, end: 5 }], [{ text: 'XYZ', start: 0, end: 3 }]);
  assert.equal(tree.outline[0].terms[0].explanation, null);
});
test('copy-style blocks match glossary terms by text', () => {
  const tree = semanticTree([{ kind: 'paragraph', text: 'File the FAFSA early.' }], [{ text: 'FAFSA', explanation: 'aid form' }]);
  assert.equal(tree.outline[0].terms.length, 1);
});
test('the semantic summary counts structure and reading time', () => {
  const summary = semanticSummary([
    { kind: 'heading', level: 1, text: 'Title' },
    { kind: 'paragraph', text: 'one two three' },
    { kind: 'bullet', text: 'four' }
  ]);
  assert.deepEqual([summary.headings, summary.paragraphs, summary.bullets, summary.words], [1, 1, 1, 5]);
  assert.equal(summary.readingSeconds, Math.ceil(5 * 60 / 200));
});
test('an empty semantic summary reports zeros', () => {
  assert.deepEqual(semanticSummary([]), { headings: 0, bullets: 0, paragraphs: 0, words: 0, readingSeconds: 0 });
});

// Before-after comparator.
test('the comparator emits the eight metric rows in order', () => {
  const { rows } = compareReports(clubBefore(), clubAfter());
  assert.deepEqual(rows.map(row => row.key), ['fk', 'smog', 'fog', 'longWordShare', 'jargonShare', 'avgSentence', 'overLimit', 'readingSeconds']);
});
test('the club fk delta is a real improvement', () => {
  const { rows } = compareReports(clubBefore(), clubAfter());
  const fk = rows.find(row => row.key === 'fk');
  near(fk.before, 6.4, 0.01);
  near(fk.after, 2.73, 0.01);
  near(fk.delta, fk.after - fk.before);
});
test('rows without a reading copy report no delta', () => {
  const { rows } = compareReports(clubBefore());
  assert.ok(rows.every(row => row.after === null && row.delta === null));
});
test('over-limit rows come from the histograms', () => {
  const before = inspectDocument(presets[0].source, 'text');
  const { rows, histograms } = compareReports(before, buildReadingCopy(before).report);
  assert.equal(rows.find(row => row.key === 'overLimit').before, histograms.before.overLimit);
  assert.equal(histograms.before.overLimit, 2);
});
test('histograms conserve every sentence on both sides', () => {
  const before = clubBefore();
  const { histograms } = compareReports(before, clubAfter());
  assert.equal(histograms.before.bins.reduce((s, b) => s + b.count, 0), before.stats.sentences);
});
test('document badges cover 3.1.5 and cognitive load', () => {
  const { badges } = compareReports(clubBefore(), clubAfter());
  const ids = badges.map(badge => badge.id);
  assert.ok(ids.includes('sc315') && ids.includes('load'));
  const sc315 = badges.find(badge => badge.id === 'sc315');
  assert.equal(sc315.before, true);
  assert.equal(sc315.after, true);
});
test('stylesheet badges report computed ratios', () => {
  const { badges } = compareReports(clubBefore(), clubAfter());
  const aa = badges.find(badge => badge.id === 'contrast-aa');
  const aaa = badges.find(badge => badge.id === 'contrast-aaa');
  assert.equal(aa.pass, true);
  assert.equal(aaa.pass, true);
  assert.match(aa.detail, /^15\.7\d:1/);
  assert.match(aaa.detail, /7:1 minimum$/);
});
test('no theme means no stylesheet badges', () => {
  const { badges } = compareReports(clubBefore(), clubAfter(), null);
  assert.equal(badges.filter(badge => badge.scope === 'stylesheet').length, 0);
});
test('the load badge counts sentences over the flag line', () => {
  const before = inspectDocument(presets[0].source, 'text');
  const { badges } = compareReports(before, buildReadingCopy(before).report);
  const load = badges.find(badge => badge.id === 'load');
  assert.match(load.detail, /2 to 1$/);
  assert.equal(load.before, false);
  assert.equal(load.after, false);
});
test('shares match the underlying stats', () => {
  const before = inspectDocument('Commence the FAFSA exercise and subsequently utilize it.');
  const { rows } = compareReports(before);
  const jargon = rows.find(row => row.key === 'jargonShare');
  near(jargon.before, before.stats.terms.length / before.stats.words);
});

// Signed certificate JSON.
test('the certificate carries a SHA-256 of the canonical payload', () => {
  const doc = certificateDoc(clubBefore(), clubAfter(), ISSUED);
  assert.equal(doc.algorithm, 'SHA-256');
  assert.match(doc.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(doc.fingerprint, sha256hex(canonicalJSON(doc.payload)));
  assert.equal(doc.payload.format, 'accesslens-certificate-v1');
});
test('the certificate is deterministic for a fixed issue time', () => {
  assert.equal(certificateJSON(clubBefore(), clubAfter(), ISSUED), certificateJSON(clubBefore(), clubAfter(), ISSUED));
});
test('a different issue time changes the fingerprint', () => {
  const a = certificateDoc(clubBefore(), null, ISSUED);
  const b = certificateDoc(clubBefore(), null, '2026-06-06T00:00:00.000Z');
  assert.notEqual(a.fingerprint, b.fingerprint);
});
test('the issue time defaults to a real UTC timestamp', () => {
  assert.match(certificateDoc(clubBefore()).payload.issued, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});
test('the certificate stores source hashes, never source text', () => {
  const before = clubBefore();
  const doc = certificateDoc(before, clubAfter(), ISSUED);
  assert.equal(doc.payload.before.sourceSHA256, sha256hex(before.source));
  assert.ok(!certificateJSON(before, null, ISSUED).includes('Design club build night'));
});
test('the certificate holds findings spans but not labels', () => {
  const before = clubBefore();
  const doc = certificateDoc(before, null, ISSUED);
  assert.equal(doc.payload.before.findings.length, before.issues.length);
  assert.equal(doc.payload.before.issueCount, 13);
  const finding = doc.payload.before.findings[0];
  assert.deepEqual(Object.keys(finding), ['id', 'criterion', 'start', 'end']);
});
test('certificate metrics carry all eight rows with kinds', () => {
  const doc = certificateDoc(clubBefore(), clubAfter(), ISSUED);
  assert.equal(doc.payload.metrics.length, 8);
  assert.equal(doc.payload.metrics[0].kind, 'grade');
  assert.ok(doc.payload.metrics.every(row => typeof row.label === 'string'));
});
test('certificate histograms mirror the comparator bins', () => {
  const doc = certificateDoc(clubBefore(), clubAfter(), ISSUED);
  assert.equal(doc.payload.histograms.before.bins.length, 8);
  assert.equal(doc.payload.histograms.after.bins.length, 8);
  assert.ok(doc.payload.histograms.before.bins.every(bin => 'label' in bin && 'count' in bin && 'load' in bin));
});
test('a certificate without a reading copy marks the after side null', () => {
  const doc = certificateDoc(clubBefore(), null, ISSUED);
  assert.equal(doc.payload.after, null);
  assert.equal(doc.payload.histograms.after, null);
});
test('certificate JSON ends with a newline', () => assert.ok(certificateJSON(clubBefore()).endsWith('\n')));

// Certificate verification and tamper detection.
test('a fresh certificate verifies intact', () => {
  const result = verifyCertificate(certificateJSON(clubBefore(), clubAfter(), ISSUED));
  assert.equal(result.ok, true);
  assert.match(result.fingerprint, /^[0-9a-f]{64}$/);
});
test('verification works without an after side', () => {
  assert.equal(verifyCertificate(certificateJSON(clubBefore(), null, ISSUED)).ok, true);
});
for (const [name, text] of [
  ['not JSON', 'this is not json'],
  ['empty', ''],
  ['a bare object', '{}'],
  ['a number', '42'],
  ['null', 'null'],
  ['missing payload', '{"algorithm":"SHA-256","fingerprint":"' + 'a'.repeat(64) + '"}'],
  ['missing fingerprint', '{"algorithm":"SHA-256","payload":{}}'],
  ['wrong algorithm', '{"algorithm":"SHA-1","fingerprint":"' + 'a'.repeat(64) + '","payload":{}}'],
  ['numeric fingerprint', '{"algorithm":"SHA-256","fingerprint":5,"payload":{}}']
]) test(`verification rejects ${name}`, () => assert.equal(verifyCertificate(text).ok, false));
test('verification returns the mismatch evidence', () => {
  const doc = JSON.parse(certificateJSON(clubBefore(), null, ISSUED));
  doc.payload.issued = 'changed';
  const result = verifyCertificate(JSON.stringify(doc));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'fingerprint mismatch');
  assert.equal(result.expected.length, 64);
});
test('a flipped fingerprint nibble fails verification', () => {
  const doc = JSON.parse(certificateJSON(clubBefore(), null, ISSUED));
  doc.fingerprint = (doc.fingerprint[0] === 'a' ? 'b' : 'a') + doc.fingerprint.slice(1);
  assert.equal(verifyCertificate(JSON.stringify(doc)).ok, false);
});
test('uppercase fingerprints still verify', () => {
  const doc = JSON.parse(certificateJSON(clubBefore(), null, ISSUED));
  doc.fingerprint = doc.fingerprint.toUpperCase();
  assert.equal(verifyCertificate(JSON.stringify(doc)).ok, true);
});
test('reordered payload keys still verify through canonical JSON', () => {
  const doc = JSON.parse(certificateJSON(clubBefore(), null, ISSUED));
  const shuffled = { payload: doc.payload, fingerprint: doc.fingerprint, algorithm: doc.algorithm };
  assert.equal(verifyCertificate(JSON.stringify(shuffled)).ok, true);
});
test('trailing whitespace around a certificate is tolerated', () => {
  assert.equal(verifyCertificate('  ' + certificateJSON(clubBefore(), null, ISSUED) + ' \n').ok, true);
});

// Certificate CSV and Markdown.
test('certificate CSV leads with the fingerprint block', () => {
  const doc = certificateDoc(clubBefore(), clubAfter(), ISSUED);
  const out = certificateCSV(clubBefore(), clubAfter(), ISSUED);
  assert.ok(out.startsWith('"AccessLens audit certificate"'));
  assert.ok(out.includes(doc.fingerprint));
  assert.ok(out.includes('"Metric","Original","Reading copy","Change"'));
});
test('certificate CSV formats metrics and badges', () => {
  const out = certificateCSV(clubBefore(), clubAfter(), ISSUED);
  assert.ok(out.includes('"Flesch-Kincaid grade","6.40","2.73"'));
  assert.ok(out.includes('"Badge","Verdict","Detail"'));
  assert.ok(out.includes('Reading copy contrast, WCAG 2.2 SC 1.4.3 AA'));
  assert.ok(out.includes('"Source SHA-256"'));
});
test('certificate CSV marks a missing copy as n/a', () => {
  const out = certificateCSV(clubBefore(), null, ISSUED);
  assert.ok(out.includes('"Flesch-Kincaid grade","6.40","n/a","n/a"'));
});
test('certificate CSV stays formula safe like every export', () => {
  const out = certificateCSV(clubBefore(), clubAfter(), ISSUED);
  for (const cell of out.split('\r\n').join(',').match(/"([^"]*)"/g) ?? []) {
    assert.doesNotMatch(cell, /^"[=+\-@\u2212]/u, cell);
  }
});
test('certificate markdown has the signed header and table', () => {
  const doc = certificateDoc(clubBefore(), clubAfter(), ISSUED);
  const out = certificateMarkdown(clubBefore(), clubAfter(), ISSUED);
  assert.ok(out.startsWith('# AccessLens audit certificate'));
  assert.ok(out.includes('`' + doc.fingerprint + '`'));
  assert.ok(out.includes('| Metric | Original | Reading copy | Change |'));
  assert.ok(out.includes('| Flesch-Kincaid grade | 6.40 | 2.73 | -3.68 |'));
});
test('certificate markdown lists badge verdicts and histograms', () => {
  const out = certificateMarkdown(clubBefore(), clubAfter(), ISSUED);
  assert.ok(out.includes('- **pass**'));
  assert.ok(out.includes('words x'));
  assert.ok(out.includes('## Sentence-length histograms'));
});
test('certificate markdown discloses the tamper-check scope', () => {
  assert.ok(certificateMarkdown(clubBefore(), null, ISSUED).includes('not a legal signature'));
});
test('certificate markdown marks a missing copy plainly', () => {
  assert.ok(certificateMarkdown(clubBefore(), null, ISSUED).includes('not built'));
});

// The in-page self-test suite also runs under node.
test('the self-test suite has unique ids and enough coverage', () => {
  assert.ok(selfTests.length >= 20);
  assert.equal(new Set(selfTests.map(t => t.id)).size, selfTests.length);
});
test('every shipped self-test passes', () => {
  const results = runSelfTests();
  assert.equal(results.length, selfTests.length);
  assert.deepEqual(results.filter(r => !r.pass), []);
});
test('self-test results carry names', () => {
  assert.ok(runSelfTests().every(result => result.name.length > 10 && result.id.length > 2));
});

// Remediation non-worsening invariants across every preset.
for (const preset of presets) test(`reading copy never worsens findings: ${preset.id}`, () => {
  const before = inspectDocument(preset.source, preset.mode);
  const after = buildReadingCopy(before).report;
  assert.ok(after.issues.length <= before.issues.length);
});
for (const preset of presets) test(`reading copy stays measurable: ${preset.id}`, () => {
  const after = buildReadingCopy(inspectDocument(preset.source, preset.mode)).report;
  assert.ok(after.stats.words > 0);
  assert.equal(typeof after.stats.readingSeconds, 'number');
});

// Shared CSV surface stays formula safe on certificate content.
test('csv escapes still guard the certificate sheet', () => {
  assert.equal(csv([['=cmd']]), `"'=cmd"\r\n`);
});
test('contrast ratio still matches the audit module', () => {
  assert.equal(contrastRatio('#000', '#fff'), wcagContrast('#000', '#fff').ratio);
});
