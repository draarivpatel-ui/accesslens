import { acronyms, common, jargon } from './glossary.js';

export const DAMPING = 0.85;
export const TOLERANCE = 1e-6;
export const MAX_SENTENCES = 400;
const STOP = new Set('a an and are as at be but by can for from had has have he her in is it its of on or our she that the their them then they this to was we were will with you your'.split(' '));
const ABBR = new Set(['mr.', 'mrs.', 'ms.', 'dr.', 'prof.', 'vs.', 'e.g.', 'i.e.', 'a.m.', 'p.m.', 'no.', 'st.', 'etc.']);
const wordPattern = /[\p{L}\p{N}]+(?:['\u2019-][\p{L}\p{N}]+)*/gu;
const exactSyllables = { every: 2, education: 4, people: 2, science: 2, business: 2, quiet: 2, hour: 1, queue: 1, little: 2, area: 3, recipe: 3 };

export function words(text) {
  return [...text.matchAll(wordPattern)].map(m => ({ text: m[0], start: m.index, end: m.index + m[0].length }));
}

export function sentences(text) {
  const items = [];
  let start = 0;
  const push = end => {
    const raw = text.slice(start, end);
    const trimmed = raw.trim();
    if (trimmed && /[\p{L}\p{N}]/u.test(trimmed)) {
      const offset = start + raw.length - raw.trimStart().length;
      items.push({ text: trimmed, start: offset, end: offset + trimmed.length, index: items.length });
    }
    start = end;
  };
  for (const m of text.matchAll(/[.!?]+["')\]\u201d\u2019]*(?=\s|$)|\r?\n+/g)) {
    if (m[0][0] === '.' && m[0].length === 1) {
      const last = text.slice(Math.max(start, m.index - 12), m.index + 1).match(/[a-z.]+\.$/i)?.[0] ?? '';
      const next = text.slice(m.index + 1);
      if (ABBR.has(last.toLowerCase()) && !/^[ \t]*(?:\n|$)/.test(next)) continue;
      if (/^[A-Z]\.$/.test(last) && /^\s+[A-Z][a-z]/.test(next)) continue;
    }
    push(m.index + m[0].length);
  }
  push(text.length);
  return items;
}

export function syllables(word) {
  const w = word.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  if (w.includes('-')) return w.split('-').reduce((sum, part) => sum + syllables(part), 0);
  if (Object.hasOwn(exactSyllables, w)) return exactSyllables[w];
  if (/^[A-Z]{2,6}$/.test(word)) return word.length + Number(word.includes('W'));
  const clean = w.replace(/[^a-z]/g, '');
  if (clean.length < 4) return 1;
  const stem = clean.replace(/(?:[^l]e|ed|es)$/, match => match.length === 2 && !/^[aeiouy]/.test(match) && match.endsWith('e') ? match[0] : /[td]ed$|[csxz]es$/.test(clean) ? match : '').replace(/^y/, '');
  return Math.max(1, stem.match(/[aeiouy]+/g)?.length ?? 0);
}

export function readability(text, segments = sentences(text)) {
  const tokens = words(text);
  const count = tokens.length;
  const lines = segments.length;
  const counts = tokens.map(token => syllables(token.text));
  const total = counts.reduce((a, b) => a + b, 0);
  const poly = counts.filter(n => n >= 3).length;
  const difficult = tokens.filter(({text: w}) => /[a-z]/i.test(w) && !common.has(w.toLowerCase())).length;
  const density = count ? difficult / count : 0;
  return {
    words: count, sentences: lines, syllables: total, polysyllables: poly, difficult, difficultDensity: density,
    fk: count && lines ? 0.39 * count / lines + 11.8 * total / count - 15.59 : null,
    smog: lines >= 30 ? 1.043 * Math.sqrt(poly * 30 / lines) + 3.1291 : null,
    daleChallProxy: count && lines ? 0.1579 * density * 100 + 0.0496 * count / lines + (density > .05 ? 3.6365 : 0) : null,
    readingSeconds: Math.ceil(count * 60 / 200)
  };
}

export function similarityGraph(segments) {
  const docs = segments.map(s => {
    const map = new Map();
    for (const { text } of words(s.text)) {
      const term = text.toLowerCase();
      if (!STOP.has(term)) map.set(term, (map.get(term) ?? 0) + 1);
    }
    return map;
  });
  const df = new Map();
  for (const doc of docs) for (const term of doc.keys()) df.set(term, (df.get(term) ?? 0) + 1);
  const norms = docs.map(doc => {
    let squares = 0;
    for (const [term, count] of doc) {
      const weight = count * (Math.log((1 + docs.length) / (1 + df.get(term))) + 1);
      doc.set(term, weight);
      squares += weight * weight;
    }
    return Math.sqrt(squares);
  });
  const graph = docs.map(() => new Float64Array(docs.length));
  for (let a = 0; a < docs.length; a++) {
    if (!norms[a]) continue;
    for (let b = a + 1; b < docs.length; b++) {
      if (!norms[b]) continue;
      let dot = 0;
      const [short, other] = docs[a].size < docs[b].size ? [docs[a], docs[b]] : [docs[b], docs[a]];
      for (const [term, weight] of short) dot += weight * (other.get(term) ?? 0);
      graph[a][b] = graph[b][a] = Math.min(1, dot / (norms[a] * norms[b]));
    }
  }
  return graph;
}

export function pageRank(graph, damping = DAMPING, tolerance = TOLERANCE) {
  const n = graph.length;
  if (!n) return { scores: [], iterations: 0, residual: 0, converged: true };
  const degrees = graph.map(row => row.reduce((sum, weight) => sum + weight, 0));
  let scores = Array(n).fill(1 / n);
  let residual = Infinity;
  let iterations = 0;
  while (iterations < 500 && residual > tolerance) {
    const dangling = scores.reduce((sum, score, i) => sum + (degrees[i] ? 0 : score), 0);
    const next = Array(n).fill((1 - damping + damping * dangling) / n);
    for (let j = 0; j < n; j++) {
      if (!degrees[j]) continue;
      const scale = damping * scores[j] / degrees[j];
      for (let i = 0; i < n; i++) next[i] += scale * graph[j][i];
    }
    residual = next.reduce((sum, score, i) => sum + Math.abs(score - scores[i]), 0);
    scores = next;
    iterations++;
  }
  return { scores, iterations, residual, converged: residual <= tolerance };
}

export function rankSentences(segments) {
  const sample = segments.slice(0, MAX_SENTENCES);
  const result = pageRank(similarityGraph(sample));
  const ranked = sample.map((s, i) => ({ ...s, score: result.scores[i] }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return { ...result, ranked, truncated: segments.length > sample.length };
}

export function detectTerms(text) {
  return words(text).flatMap(token => {
    const {text: word, start, end} = token;
    const lower = word.toLowerCase();
    if (Object.hasOwn(jargon, lower)) return [{...token, kind: 'jargon', explanation: jargon[lower]}];
    if (Object.hasOwn(acronyms, word) || (/^[A-Z]{2,6}$/.test(word) && !common.has(lower))) {
      const definition = Object.hasOwn(acronyms, word) ? acronyms[word] : null;
      return [{text: word, start, end, kind: 'acronym', explanation: definition}];
    }
    return [];
  });
}

export function detectPassive(text) {
  const pattern = /\b(?:am|is|are|was|were|be|been|being)(?:\s+(?:not|[a-z]+ly)){0,2}\s+([a-z]{3,}ed|built|done|given|held|known|made|read|sent|shown|taken|taught|written)\b/gi;
  return [...text.matchAll(pattern)].filter(m => !/^(?:tired|excited|interested|bored|worried|scared|pleased|related)$/i.test(m[1]))
    .map(m => ({ text: m[0], start: m.index, end: m.index + m[0].length }));
}

export function splitLongSentence(text) {
  const tokens = words(text);
  if (tokens.length <= 24) return null;
  const leftBoundary = tokens[6].end;
  const rightBoundary = tokens.at(-7).start;
  const breaks = [...text.matchAll(/;\s+|:\s+(?=[a-z])|,\s+(?=(?:then|but|however|and then)\b)/gi)]
    .filter(m => m.index >= leftBoundary && m.index + m[0].length <= rightBoundary);
  if (!breaks.length) return null;
  const m = breaks.reduce((a, b) => Math.abs(b.index - text.length / 2) < Math.abs(a.index - text.length / 2) ? b : a);
  const rest = text.slice(m.index + m[0].length);
  return [text.slice(0, m.index) + '.', rest[0].toUpperCase() + rest.slice(1)];
}

export function analyzeText(text) {
  const segments = sentences(text);
  return {
    ...readability(text, segments), ...rankSentences(segments), terms: detectTerms(text), passive: detectPassive(text),
    long: segments.filter(s => words(s.text).length > 24).map(s => ({ ...s, split: splitLongSentence(s.text) }))
  };
}
