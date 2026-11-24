import assert from 'node:assert/strict';
import test from 'node:test';
import { acronyms, jargon } from '../src/glossary.js';
import { MAX_SENTENCES, analyzeText, detectPassive, detectTerms, pageRank, rankSentences, readability, sentences, similarityGraph, splitLongSentence, syllables, words } from '../src/nlp.js';
import { rankCases } from '../scripts/evaluation-corpus.mjs';

const near = (a, b, epsilon = 1e-9) => assert.ok(Math.abs(a - b) <= epsilon, `${a} is not near ${b}`);
for (const [source, expected] of [
  ['', []], ['\t  \n  ', []], ['!?', []], ['One line', ['One line']],
  ['  First. Second.   ', ['First.', 'Second.']], ['Ready?! Go.', ['Ready?!', 'Go.']],
  ['Line one\nLine two', ['Line one', 'Line two']], ['Line one\r\n\r\nLine two\n', ['Line one', 'Line two']],
  ['Dr. Smith arrived. Wait.', ['Dr. Smith arrived.', 'Wait.']],
  ['Prof. Chen arrived.', ['Prof. Chen arrived.']], ['Ms. Lee. Go.', ['Ms. Lee.', 'Go.']],
  ['See No. 4. Go on.', ['See No. 4.', 'Go on.']], ['Mix 1.5 mL. Stop.', ['Mix 1.5 mL.', 'Stop.']],
  ['A. Patel read it.', ['A. Patel read it.']], ['He said "go." Then stop.', ['He said "go."', 'Then stop.']],
  ['Example, e.g. a cup. Good.', ['Example, e.g. a cup.', 'Good.']],
  ['Meet at 9 a.m. in the lab.', ['Meet at 9 a.m. in the lab.']],
  ['First.\nSecond.', ['First.', 'Second.']], ['One\tword. Two.', ['One\tword.', 'Two.']],
  ['Ask at the end (really!). Next.', ['Ask at the end (really!).', 'Next.']]
]) test(`sentence boundaries ${JSON.stringify(source)}`, () => {
  const result = sentences(source);
  assert.deepEqual(result.map(x => x.text), expected);
  result.forEach((s, index) => { assert.equal(s.index, index); assert.equal(source.slice(s.start, s.end), s.text); });
});

for (const [word, expected] of [
  ['cat',1], ['science',2], ['education',4], ['every',2], ['people',2], ['queue',1], ['little',2], ['hour',1],
  ['business',2], ['quiet',2], ['area',3], ['recipe',3], ['makes',1], ['boxes',2], ['wanted',2], ['part-time',2],
  ['FAFSA',2], ['NASA',2], ['STEM',1], ['WCAG',5], ['RSVP',4], ['7',1], ['1234',1],
  ['coffee',2], ['agree',2], ['degree',2], ['cookie',2], ['rescue',2], ['argue',2], ['cafe',2], ['naive',2],
  ['vague',1], ['league',1], ['dialogue',3], ['unique',2], ['free',1], ['tree',1], ['blue',1], ['shoe',1]
]) test(`syllables ${word}`, () => assert.equal(syllables(word), expected));

test('word offsets are UTF-16 and preserve hyphens, apostrophes and accents', () => {
  const source = '\uD83D\uDD0E Don\u2019t split Caf\u00e9-style words.';
  const tokens = words(source);
  assert.deepEqual(tokens.map(t => t.text), ['Don\u2019t', 'split', 'Caf\u00e9-style', 'words']);
  assert.equal(tokens[0].start, 3);
  for (const t of tokens) assert.equal(source.slice(t.start, t.end), t.text);
});

test('FK formula separately computed for a single word', () => near(readability('The cat sat on the mat today.').fk, .39 * 7 + 11.8 * 8 / 7 - 15.59));
test('FK grade never reports below zero', () => assert.equal(readability('Cat.').fk, 0));
test('FK grade uses words per sentence and syllables per word', () => {
  const result = readability('Cat sat. Education helps.');
  assert.deepEqual([result.words, result.sentences, result.syllables], [4, 2, 7]);
  near(result.fk, .39 * 2 + 11.8 * 7 / 4 - 15.59);
});
test('empty readability does not report a grade', () => assert.equal(readability('').fk, null));
test('short samples do not report SMOG', () => assert.equal(readability('Education helps. '.repeat(29)).smog, null));
test('SMOG uses count of polysyllables', () => near(readability('Education helps. '.repeat(30)).smog, 1.043 * Math.sqrt(30) + 3.1291));
test('SMOG span normalization for 60 sentences', () => near(readability('Education helps. Cat sat. '.repeat(30)).smog, 1.043 * Math.sqrt(15) + 3.1291));
test('Dale-Chall proxy is explicit about the difficult-word adjustment', () => {
  const result = readability('Use water. Use chromatography.');
  near(result.difficultDensity, .25);
  near(result.daleChallProxy, .1579 * 25 + .0496 * 2 + 3.6365);
});
test('below the Dale-Chall adjustment threshold', () => near(readability('Use water.').daleChallProxy, .0496 * 2));
test('reading time is a 200 wpm estimate', () => assert.equal(readability('word '.repeat(200)).readingSeconds, 60));
test('reading time rounds up to a second for nonempty text', () => assert.equal(readability('Read.').readingSeconds, 1));

for (const [word, definition] of Object.entries(acronyms)) {
  test(`glossary acronym and exact span ${word}`, () => {
    const source = `See ${word}.`;
    assert.deepEqual(detectTerms(source), [{text: word, kind: 'acronym', explanation: definition, start: 4, end: 4 + word.length}]);
  });
}
for (const [word, definition] of Object.entries(jargon)) {
  test(`glossary jargon and exact span ${word}`, () => {
    const term = word[0].toUpperCase() + word.slice(1);
    assert.deepEqual(detectTerms(`${term} is a term.`), [{text: term, kind: 'jargon', explanation: definition, start: 0, end: term.length}]);
  });
}
test('capitals outside glossary stay unexplained', () => assert.equal(detectTerms('Bring the XYZ form.')[0].explanation, null));
test('lowercase stems are not uppercase acronyms', () => assert.deepEqual(detectTerms('The plant stem grew.'), []));
test('prototype keys are not recognized as glossary terms', () => assert.deepEqual(detectTerms('constructor prototype'), []));

for (const [line, spans] of [
  ['It was measured.', ['was measured']], ['The tubes were carefully labeled.', ['were carefully labeled']],
  ['The form has been sent.', ['been sent']], ['The sample is not heated.', ['is not heated']],
  ['It is shown below.', ['is shown']], ['They measured it.', []], ['The student is tired.', []], ['I was late.', []],
  ['It is hot, and it was cooled.', ['was cooled']], ['The first was sent. The second was written.', ['was sent','was written']]
]) test(`passive signal ${line}`, () => {
  const results = detectPassive(line);
  assert.deepEqual(results.map(x => x.text), spans);
  for (const x of results) assert.equal(line.slice(x.start, x.end), x.text);
});

const longLeft = 'Check the reading at the start of class with the same type of ruler';
const longRight = 'write that reading in the worksheet and make sure you indicate the proper unit';
test('long semicolon suggests a sentence split', () => assert.deepEqual(splitLongSentence(`${longLeft}; ${longRight}.`), [`${longLeft}.`, `Write${longRight.slice(5)}.`]));
test('short semicolon remains untouched', () => assert.equal(splitLongSentence('Read this; do that.'), null));
for (const count of [24, 25, 26]) {
  test(`splitLongSentence respects the ${count} word boundary with a safe central semicolon`, () => {
    const left = Array(12).fill('word').join(' ');
    const right = Array(count - 12).fill('word').join(' ');
    const text = `${left}; ${right}.`;
    assert.equal(words(text).length, count);
    assert.equal(sentences(text).length, 1);
    assert.deepEqual(splitLongSentence(text), count > 25 ? [`${left}.`, `Word${right.slice(4)}.`] : null);
  });
}
test('long sentence is flagged when no safe split is available', () => {
  const {long} = analyzeText(`${longLeft} and ${longRight}.`);
  assert.equal(long.length, 1);
  assert.equal(long[0].split, null);
});
test('split leaves a short subordinate fragment alone', () => assert.equal(splitLongSentence(`${longLeft} ${longRight}; good.`), null));
test('multiple separators choose the valid midpoint, preserving every word', () => {
  const text = 'Check; then ' + Array.from({length: 500}, () => 'record data').join('; ') + '; done.';
  const split = splitLongSentence(text);
  assert.ok(split && Math.abs(split[0].length - split[1].length) < 25);
  assert.equal(words(split.join(' ')).map(w => w.text.toLowerCase()).join(' '), words(text).map(w => w.text.toLowerCase()).join(' '));
});

test('graph is symmetric with no self edges', () => {
  const graph = similarityGraph(sentences('A green book. A red book. A green chair.'));
  graph.forEach((row, i) => row.forEach((weight, j) => assert.equal(weight, i === j ? 0 : graph[j][i])));
});
test('cosine with two orthogonal rows', () => assert.equal(similarityGraph(sentences('Book. Chair.'))[0][1], 0));
test('identical normalized vectors have unit cosine', () => near(similarityGraph(sentences('Red book. Red red book book.'))[0][1], 1));
test('TF-IDF cosine uses smoothed inverse frequencies', () => {
  const idfRare = Math.log(3 / 2) + 1;
  const graph = similarityGraph(sentences('Red book. Blue book.'));
  near(graph[0][1], 1 / (1 + idfRare ** 2));
});
test('stop-word-only vectors do not produce invalid weights', () => assert.equal(similarityGraph(sentences('The. And.'))[0][1], 0));
test('PageRank for a three-node path matches the analytic stationary distribution', () => {
  const rank = pageRank([[0, 1, 0], [1, 0, 1], [0, 1, 0]]);
  const center = (.05 + .85) / 1.85;
  near(rank.scores[1], center, 4e-6);
  near(rank.scores[0], (1 - center) / 2, 4e-6);
  near(rank.scores.reduce((a, b) => a + b), 1);
  assert.ok(rank.converged && rank.residual <= 1e-6 && rank.iterations > 1);
});
test('empty PageRank has no fabricated scores', () => assert.deepEqual(pageRank([]), {scores: [], iterations: 0, residual: 0, converged: true}));
test('all dangling PageRank is uniform', () => assert.deepEqual(pageRank([[0,0],[0,0]]).scores, [.5,.5]));
test('an isolated node redistributes its mass to the whole graph', () => {
  const rank = pageRank([[0,1,0],[1,0,0],[0,0,0]]);
  const isolated = .15 / (3 - .85);
  near(rank.scores[2], isolated, 1e-6);
  near(rank.scores[0], (1 - isolated) / 2, 1e-6);
});
test('single sentence ranks with unit mass', () => assert.equal(analyzeText('Read.').ranked[0].score, 1));
test('graph resource cap does not silently truncate readability', () => {
  const report = analyzeText('Study. '.repeat(MAX_SENTENCES + 1));
  assert.equal(report.sentences, MAX_SENTENCES + 1);
  assert.equal(report.ranked.length, MAX_SENTENCES);
  assert.equal(report.truncated, true);
});
test('stable ranking tie order is source order', () => assert.deepEqual(rankSentences(sentences('Alpha. Delta. Bravo.')).ranked.map(s => s.index), [0,1,2]));
for (const {id, lines} of rankCases) test(`ranking retains source and normalized mass: ${id}`, () => {
  const text = lines.join(' ');
  const result = analyzeText(text);
  assert.equal(result.ranked.length, lines.length);
  near(result.ranked.reduce((sum, r) => sum + r.score, 0), 1);
  for (const item of result.ranked) assert.equal(text.slice(item.start, item.end), lines[item.index]);
});

test('unlisted abbreviations keep the sentence whole', () => {
  for (const source of [
    'See Fig. 3 for details.', 'See Eq. 2 and approx. 5 pages now.', 'The answer is in Eq. 4, not Eq. 5.',
    'She visited St. Louis last year.', 'He joined the U.S. Army last year.', 'Smith et al. found the effect.',
    'Due Jan. 5 at the latest.', 'Meet at 9 a.m. in the lab.', 'Example, e.g. a cup. Good.'])
    assert.equal(sentences(source).length <= 2, true, source);
  assert.deepEqual(sentences('See Fig. 3 for details.').map(s => s.text), ['See Fig. 3 for details.']);
});

test('abbreviations do not suppress real sentence ends', () => {
  for (const source of [
    'Bring pens, paper, etc. Then wash your hands.', 'Meet at 9 a.m. Everyone should come.',
    'She lives on Main St. Next week we visit.', 'He moved to the U.S. Then he left.',
    'The meeting is at 5 p.m. Please bring a pen.']) {
    const parts = sentences(source).map(s => s.text);
    assert.equal(parts.length, 2, source);
    assert.equal(parts[0][0] === parts[0][0].toUpperCase() && parts[1][0] === parts[1][0].toUpperCase(), true, source);
  }
});

test('single initials split only before real sentence starts', () => {
  assert.equal(sentences('Plan A. The team reviewed it.').length, 2);
  assert.equal(sentences('I saw A. It was red.').length, 2);
  assert.deepEqual(sentences('Prof. X. arrived late.').map(s => s.text), ['Prof. X. arrived late.']);
  assert.equal(sentences('A. Patel read it.').length, 1);
});

test('more line separators end sentences', () => {
  assert.equal(sentences('one\rtwo').length, 2);
  assert.equal(sentences('one\vtwo').length, 2);
  assert.equal(sentences('one\ftwo').length, 2);
  assert.equal(sentences('one\u2028two').length, 2);
  assert.equal(sentences('one\u2029two').length, 2);
});

test('numbers with separators and underscore names are single words', () => {
  assert.deepEqual(words('Use 1.5 mL and 1,000 cells.').map(w => w.text), ['Use', '1.5', 'mL', 'and', '1,000', 'cells']);
  assert.deepEqual(words('version 2.0.1 ships').map(w => w.text), ['version', '2.0.1', 'ships']);
  assert.deepEqual(words('Meet at 3:30 sharp.').map(w => w.text), ['Meet', 'at', '3:30', 'sharp']);
  assert.deepEqual(words('snake_case works').map(w => w.text), ['snake_case', 'works']);
});

test('dotted acronyms stay whole and resolve to names', () => {
  assert.deepEqual(words('the U.S. team met').map(w => w.text), ['the', 'U.S.', 'team', 'met']);
  assert.equal(syllables('U.S.'), 2);
  const terms = detectTerms('the U.S. team met');
  assert.equal(terms.length, 1);
  assert.equal(terms[0].kind, 'acronym');
  assert.equal(terms[0].explanation, 'United States');
});

test('passive detector catches comma and adverb chains plus irregular participles', () => {
  for (const source of ['The sample was very carefully labeled.', 'He was born in June.',
      'She got fired.', 'It was, however, reviewed.', 'The data was only partially recorded.'])
    assert.equal(detectPassive(source).length, 1, source);
});

test('passive detector skips nouns and participial adjectives', () => {
  for (const source of ['The coat was tweed.', 'The motive was greed.', 'I am done.',
      'The team was annoyed.', 'She was delighted.', 'It is a good day.'])
    assert.equal(detectPassive(source).length, 0, source);
  assert.equal(detectPassive('They were elected officials.').length, 1);
});

test('split suggestion never emits a space before the inserted period', () => {
  const long = 'Alpha beta gamma delta epsilon zeta eta theta ; then iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega again';
  assert.equal(words(long).length, 26);
  const parts = splitLongSentence(long);
  assert.ok(parts);
  assert.ok(parts[0].endsWith('.') && !parts[0].endsWith(' .'), parts[0]);
});
