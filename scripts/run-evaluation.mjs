import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { RULES, auditHTML } from '../src/a11y.js';
import { canonicalJSON, fingerprint } from '../src/exports.js';
import { analyzeText, detectTerms } from '../src/nlp.js';
import { auditCases, languageCases, rankCases } from './evaluation-corpus.mjs';

function labels(source, items) {
  return items.map(([id, literal, nth = 0]) => {
    let start = -1;
    for (let i = 0; i <= nth; i++) {
      start = source.indexOf(literal, i === 0 ? 0 : start + literal.length);
      assert.notEqual(start, -1, `Invalid hand label ${id} ${literal}`);
    }
    return `${id}:${start}:${start + literal.length}`;
  });
}

function counts(gold, guessed) {
  const pending = [...gold];
  let tp = 0;
  for (const key of guessed) {
    const match = pending.indexOf(key);
    if (match >= 0) { pending.splice(match, 1); tp++; }
  }
  return {tp, fp: guessed.length - tp, fn: pending.length};
}

function totals(rows) {
  const { tp, fp, fn } = rows.reduce((sum, row) => ({
    tp: sum.tp + row.tp, fp: sum.fp + row.fp, fn: sum.fn + row.fn
  }), {tp: 0, fp: 0, fn: 0});
  return {tp, fp, fn, precision: tp + fp ? tp / (tp + fp) : null,
    recall: tp + fn ? tp / (tp + fn) : null, f1: 2 * tp + fp + fn ? (2 * tp) / (2 * tp + fp + fn) : null};
}

function categorized(rows, categories) {
  const results = rows.map(({ id, gold, guessed }) => ({id, ...counts(gold, guessed)}));
  return {
    ...totals(results), cases: results,
    byCategory: Object.fromEntries(categories.map(rule => [rule, totals(rows.map(({gold, guessed}) =>
      counts(gold.filter(s => s.startsWith(`${rule}:`)), guessed.filter(s => s.startsWith(`${rule}:`)))))]))
  };
}

const languageRows = languageCases.map(({id, text, labels: expected}) => ({
  id, gold: labels(text, expected), guessed: detectTerms(text).map(t => `${t.kind}:${t.start}:${t.end}`)
}));
const auditRows = auditCases.map(({id, source, labels: expected}) => ({
  id, gold: labels(source, expected), guessed: auditHTML(source).map(i => `${i.id}:${i.start}:${i.end}`)
}));
const topK = 3;
const rankRows = rankCases.map(({id, lines, gold}) => {
  const stats = analyzeText(lines.join(' '));
  assert.equal(stats.sentences, lines.length, `Fixture boundaries changed: ${id}`);
  assert.equal(stats.converged, true);
  const selected = stats.ranked.slice(0, topK).map(point => point.index);
  const baseline = [0, 1, 2];
  const overlap = indexes => indexes.filter(i => gold.includes(i)).length;
  return {id, gold, selected, baseline, textRankHits: overlap(selected), leadHits: overlap(baseline)};
});

const result = {
  schema: 'accesslens-frozen-eval-v1',
  corpusFingerprint: await fingerprint(canonicalJSON({languageCases, auditCases, rankCases})),
  language: categorized(languageRows, ['acronym', 'jargon']),
  audit: categorized(auditRows, Object.keys(RULES)),
  ranking: {
    denominator: topK * rankRows.length,
    textRankHits: rankRows.reduce((sum, c) => sum + c.textRankHits, 0),
    leadHits: rankRows.reduce((sum, c) => sum + c.leadHits, 0),
    cases: rankRows
  }
};

if (process.argv.includes('--check')) {
  const frozen = JSON.parse(await readFile(new URL('../docs/evaluation.json', import.meta.url), 'utf8'));
  assert.deepEqual(result, frozen, 'Frozen evaluation changed. Investigate the specific examples before updating the snapshot.');
  assert.equal(result.audit.fn, 0, 'The 12-rule labeled corpus has a missed check.');
  assert.equal(Object.values(result.audit.byCategory).filter(m => m.tp > 0).length, 12, 'The corpus must exercise every rule.');
}

console.log(JSON.stringify(result, null, 2));
