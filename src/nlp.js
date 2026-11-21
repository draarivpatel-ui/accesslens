import { acronyms, common, jargon } from './glossary.js';

export const DAMPING = 0.85;
export const TOLERANCE = 1e-6;
export const MAX_SENTENCES = 400;
const STOP = new Set('a an and are as at be but by can for from had has have he her in is it its of on or our she that the their them then they this to was we were will with you your'.split(' '));
const ABBR_ALWAYS = new Set('mr. mrs. ms. dr. prof. vs. jr. sr. mt. rev. hon. gen. col. capt. lt. sgt. fr. br. cf. pres. rep. sen. gov. esq. e.g. i.e. ph.d. m.d. b.a. m.a. b.s. m.s. j.d. r.n. p.s.'.split(' '));
const ABBR = new Set('st. u.s. u.k. u.n. d.c. a.m. p.m. no. etc. fig. eq. approx. est. sec. ch. pt. ex. ca. p. pp. vol. dept. univ. inc. ed. eds. al. jan. feb. apr. jun. jul. aug. sep. sept. oct. nov. dec. mon. tue. tues. thu. thur. thurs. fri. min. max. avg. misc. dist. asst. supt. assoc. bros. co. corp. ltd.'.split(' '));
const STARTERS = new Set('the a an it he she we they this that these those there then than when where while if in on at for to from by with about as of is was are were be been has have had do does did will would can could should may might must shall who what why how which whose whom not no yes all each every some any most more many much few both either neither one two first next last another other new same after before during between under over again once now soon later today tomorrow yesterday here everyone everybody someone anyone nobody students teachers parents class please bring take make get go come use keep read write ask tell check see look find give put let try turn start stop wait work remember note'.split(' '));
const wordPattern = /(?:\p{Lu}\.){2,}|\p{N}+(?:[.,:][\p{N}]+)+|[\p{L}\p{N}_]+(?:['\u2019-][\p{L}\p{N}_]+)*/gu;
const exactSyllables = { every: 2, education: 4, people: 2, science: 2, business: 2, quiet: 2, hour: 1, queue: 1, little: 2, area: 3, recipe: 3, cafe: 2, naive: 2, touche: 2, resume: 2, coyote: 3, argue: 2, segue: 2, dengue: 2, dialogue: 3, rhythm: 2, jpeg: 2 };
const WORD_ACRONYMS = new Set('fafsa nasa stem smog osha ferpa aids laser scuba radar sonar fema sars unicef unesco nato opec ascii gif'.split(' '));

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
  for (const m of text.matchAll(/[.!?]+["')\]\u201d\u2019]*(?=\s|$)|[\r\n\v\f\u2028\u2029]+/g)) {
    if (m[0][0] === '.' && m[0].length === 1) {
      const last = text.slice(Math.max(start, m.index - 12), m.index + 1).match(/[a-z.]+\.$/i)?.[0] ?? '';
      const next = text.slice(m.index + 1);
      if (ABBR_ALWAYS.has(last.toLowerCase())) {
        if (!/^[ \t]*(?:\n|$)/.test(next)) continue;
      } else if (ABBR.has(last.toLowerCase()) || /^[A-Z]\.$/.test(last)) {
        const word = next.match(/^\s*([\p{L}\p{N}]+)/u)?.[1];
        if (word === undefined ? !/^[ \t]*(?:\n|$)/.test(next)
            : !/^[ \t]*\n/.test(next) && (/^[\p{Ll}\p{N}]/u.test(word) || !STARTERS.has(word.toLowerCase()))) continue;
      }
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
  if (/^(?:[A-Z]\.){2,}$/.test(word)) return word.length / 2 | 0;
  if (/^[A-Z]{2,6}$/.test(word) && !WORD_ACRONYMS.has(w)) return word.length + Number(word.includes('W'));
  const clean = w.replace(/[^a-z]/g, '').replace(/qu/g, 'q');
  if (clean.length < 4) return 1;
  const stem = clean.replace(/(?:[^l]e|ed|es)$/, match => {
    if (match === 'ed' || match === 'es') return /[td]ed$|[csxz]es$/.test(clean) ? match : '';
    if (match === 'ue' && /[gq]$/.test(clean.slice(0, -2))) return '';
    if (/^[aeiouy]/.test(match)) return match;
    return match[0];
  }).replace(/^y/, '');
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
    fk: count && lines ? Math.max(0, 0.39 * count / lines + 11.8 * total / count - 15.59) : null,
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
    if (Object.hasOwn(acronyms, word) || /^(?:[A-Z]\.){2,}$/.test(word) || (/^[A-Z]{2,6}$/.test(word) && !common.has(lower))) {
      const definition = Object.hasOwn(acronyms, word) ? acronyms[word] : null;
      return [{text: word, start, end, kind: 'acronym', explanation: definition}];
    }
    return [];
  });
}

const PASSIVE_ADVERBS = new Set('not very so too quite rather fairly pretty somewhat partly partially fully completely entirely totally already just only even also still now then often usually always never nearly almost hardly barely scarcely quickly slowly really clearly simply merely mostly mainly largely chiefly primarily generally typically commonly normally currently recently finally eventually immediately directly properly correctly accurately precisely exactly thoroughly deliberately accidentally repeatedly routinely regularly consistently constantly however therefore thus hence moreover furthermore nevertheless nonetheless besides instead otherwise meanwhile'.split(' '));
const NOT_PASSIVE = new Set('tweed greed speed deed weed breed creed seed heed reed steed indeed annoyed ashamed convinced delighted embarrassed excited interested bored worried scared pleased related tired confused depressed disappointed frustrated surprised satisfied amused appalled devoted distinguished exhausted fascinated frightened insulted offended overwhelmed puzzled shocked thrilled touched troubled unsettled upset amazed astonished astounded bewildered concerned content dedicated determined devastated disgusted distressed disturbed elated encouraged enraged entertained fulfilled gratified grieved horrified humbled humiliated inclined indignant inspired intimidated irritated keen motivated moved mystified opposed outraged perplexed perturbed preoccupied provoked relieved resigned sickened startled stunned terrified unnerved vexed wounded accustomed addicted alarmed alleged bent charmed collected crushed dazed decided demoralized disconcerted disillusioned dismayed diverted dumbfounded eager educated enchanted enthralled exhilarated exasperated experienced flabbergasted flustered galvanized jaded maddened mortified naked wicked crooked rugged learned aged beloved blessed cursed dogged jagged ragged sacred supposed marked fixed deceased wretched'.split(' '));
const PARTICIPLES = 'built|done|given|held|known|made|read|sent|shown|taken|taught|written|born|seen|eaten|broken|chosen|driven|forgotten|frozen|grown|hidden|ridden|risen|shaken|spoken|stolen|sworn|thrown|worn|beaten|bitten|blown|drawn|flown|forgiven|forbidden|woven|undone|begun|dealt|dug|felt|fought|found|heard|kept|laid|led|left|lent|lost|meant|met|paid|sold|sought|spent|stood|stuck|struck|swept|told|won|wound|bound|fed|fled|slid|slit|split|shut|cut|hit|hurt|put|set|shed|spread|thrust|cost|burst|cast|quit|rid|upset';

export function detectPassive(text) {
  const pattern = new RegExp(`\\b(am|is|are|was|were|been|being|be|getting|gets|got)\\s*,?\\s*((?:[a-z]+(?:\\s+|,\\s*)){0,3})` +
    `([a-z]{3,}ed|${PARTICIPLES})\\b`, 'gi');
  return [...text.matchAll(pattern)].filter(m => {
    const middle = m[2].trim().split(/[\s,]+/).filter(Boolean).map(w => w.toLowerCase());
    if (!middle.every(w => PASSIVE_ADVERBS.has(w) || /^[a-z]+ly$/i.test(w))) return false;
    const part = m[3].toLowerCase();
    if (NOT_PASSIVE.has(part)) return false;
    if (part === 'done' && /^(?:am|is|are)$/i.test(m[1])) return false;
    return true;
  }).map(m => ({ text: m[0], start: m.index, end: m.index + m[0].length }));
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
  return [text.slice(0, m.index).replace(/\s+$/, '') + '.', rest[0].toUpperCase() + rest.slice(1)];
}

export function analyzeText(text) {
  const segments = sentences(text);
  return {
    ...readability(text, segments), ...rankSentences(segments), terms: detectTerms(text), passive: detectPassive(text),
    long: segments.filter(s => words(s.text).length > 24).map(s => ({ ...s, split: splitLongSentence(s.text) }))
  };
}
