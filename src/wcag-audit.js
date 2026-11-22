// WCAG 2.2 readability and cognitive-access audit. Every metric is a
// deterministic estimate computed in the tab; the badges are signals drawn
// from published thresholds, not WCAG conformance decisions.
import { contrastRatio } from './a11y.js';
import { sentences, syllables, words } from './nlp.js';

// Palette of the generated reading copy (see PAPER_CSS in remediate.js).
export const COPY_THEME = Object.freeze({ ink: '#14232b', background: '#fffdf4' });

export const COGNITIVE_LOAD_WORDS = 25;      // sentences strictly over 25 words are flagged
export const READING_LEVEL_MAX_GRADE = 9;    // lower-secondary bound used for the 3.1.5 signal
export const CONTRAST_AA = 4.5;
export const CONTRAST_AA_LARGE = 3;
export const CONTRAST_AAA = 7;
export const CONTRAST_AAA_LARGE = 4.5;

// WCAG 2.2 SC 1.4.12 minimum text spacing, in em units.
export const SPACING_MIN = Object.freeze({
  letterSpacing: 0.12, wordSpacing: 0.16, lineHeight: 1.5, paragraphSpacing: 2
});

// Spacing applied by the dyslexia-friendly preview profile. Every value clears
// the 1.4.12 minimums above.
export const DYSLEXIA_SPACING = Object.freeze({
  letterSpacing: 0.12, wordSpacing: 0.16, lineHeight: 1.55, paragraphSpacing: 2
});

export const HISTOGRAM_BINS = Object.freeze([
  { min: 1, max: 5, label: '1-5' },
  { min: 6, max: 10, label: '6-10' },
  { min: 11, max: 15, label: '11-15' },
  { min: 16, max: 20, label: '16-20' },
  { min: 21, max: 25, label: '21-25' },
  { min: 26, max: 30, label: '26-30' },
  { min: 31, max: 40, label: '31-40' },
  { min: 41, max: Infinity, label: '41+' }
]);

// Gunning Fog Index: 0.4 * (average sentence length + 100 * complex-word share).
// Complex words are the studio's polysyllable estimate (3+ syllables), which
// does not strip proper nouns or common suffixes the way the published rule does.
export function gunningFog(text, segments = sentences(text)) {
  const tokens = words(text);
  if (!tokens.length || !segments.length) return null;
  const complex = tokens.filter(token => syllables(token.text) >= 3).length;
  return 0.4 * (tokens.length / segments.length + 100 * complex / tokens.length);
}

export function fogFromStats(stats) {
  return stats && stats.words && stats.sentences
    ? 0.4 * (stats.words / stats.sentences + 100 * stats.polysyllables / stats.words)
    : null;
}

export function longWordShare(stats) {
  return stats && stats.words ? stats.polysyllables / stats.words : null;
}

export function jargonShare(stats) {
  return stats && stats.words ? stats.terms.length / stats.words : null;
}

export function sentenceHistogram(text, segments = sentences(text)) {
  const lengths = segments.map(segment => words(segment.text).length);
  const bins = HISTOGRAM_BINS.map(bin => ({ ...bin, count: 0, load: bin.min > COGNITIVE_LOAD_WORDS }));
  for (const length of lengths) {
    const bin = bins.find(b => length >= b.min && length <= b.max) ?? bins[bins.length - 1];
    bin.count++;
  }
  return {
    lengths, bins, sentences: lengths.length,
    overLimit: lengths.filter(n => n > COGNITIVE_LOAD_WORDS).length,
    max: lengths.length ? Math.max(...lengths) : 0
  };
}

// Pure geometry so tests can verify the chart without a DOM.
export function histogramGeometry(hist, { width = 340, height = 120, gap = 6, bottom = 16, top = 8 } = {}) {
  const bins = hist.bins ?? [];
  const maxCount = Math.max(1, ...bins.map(bin => bin.count));
  const barWidth = bins.length ? (width - gap * (bins.length - 1)) / bins.length : 0;
  const plot = height - bottom - top;
  return {
    width, height, maxCount,
    bars: bins.map((bin, index) => {
      const barHeight = Math.round((bin.count / maxCount) * plot * 1000) / 1000;
      return {
        x: Math.round(index * (barWidth + gap) * 1000) / 1000,
        y: Math.round((top + plot - barHeight) * 1000) / 1000,
        width: Math.round(barWidth * 1000) / 1000,
        height: barHeight,
        labelY: height - 4,
        label: bin.label, count: bin.count, load: Boolean(bin.load)
      };
    })
  };
}

const xmlEscape = value => String(value).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

// Deterministic SVG markup for exports. The page builds the same geometry with
// namespaced elements instead of string HTML.
export function histogramSVG(hist, { width = 340, height = 120, title = 'Sentence length distribution' } = {}) {
  const geo = histogramGeometry(hist, { width, height });
  const bars = geo.bars.map(bar =>
    `<rect x="${bar.x}" y="${bar.y}" width="${bar.width}" height="${bar.height}" fill="${bar.load ? '#8f2f1f' : '#174962'}"><title>${bar.label} words: ${bar.count}</title></rect>`).join('');
  const labels = geo.bars.map(bar =>
    `<text x="${bar.x + bar.width / 2}" y="${bar.labelY}" font-size="8" text-anchor="middle" fill="#41535c">${bar.label}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${geo.width} ${geo.height}" role="img"><title>${xmlEscape(title)}</title>${bars}${labels}</svg>`;
}

// WCAG 2.2 SC 1.4.3 (AA) and SC 1.4.6 (AAA) thresholds on exact sRGB luminance.
export function wcagContrast(foreground, background, { largeText = false } = {}) {
  const ratio = contrastRatio(foreground, background);
  if (ratio === null) return null;
  const aaMin = largeText ? CONTRAST_AA_LARGE : CONTRAST_AA;
  const aaaMin = largeText ? CONTRAST_AAA_LARGE : CONTRAST_AAA;
  return { ratio, aaMin, aaaMin, aa: ratio >= aaMin, aaa: ratio >= aaaMin };
}

// WCAG 2.2 SC 3.1.5 (AAA) signal: every available grade estimate must sit at or
// below the lower-secondary bound. Null means no estimate existed to judge.
export function readingLevelPass(grade) {
  return typeof grade === 'number' && Number.isFinite(grade) ? grade <= READING_LEVEL_MAX_GRADE : null;
}

export function readingLevelSummary(grades) {
  const checked = (grades ?? []).map(readingLevelPass).filter(value => value !== null);
  return checked.length ? checked.every(Boolean) : null;
}

// WCAG 2.2 SC 1.4.12 per-property audit. A missing measurement reports null so
// the caller can say "not measured" instead of guessing.
export function textSpacingAudit(spacing = {}) {
  const props = {};
  for (const [key, min] of Object.entries(SPACING_MIN)) {
    const value = spacing[key];
    props[key] = {
      value: typeof value === 'number' ? value : null, min,
      pass: typeof value === 'number' ? value + 1e-9 >= min : null
    };
  }
  const checked = Object.values(props).map(prop => prop.pass).filter(value => value !== null);
  return { props, pass: checked.length ? checked.every(Boolean) : null };
}

// The structure a screen reader announces: headings nested by level, blocks in
// order, glossary terms attached to the block that contains them.
export function semanticTree(blocks = [], terms = []) {
  const root = { type: 'heading', level: 0, text: '', terms: [], children: [] };
  const stack = [root];
  let headings = 0;
  // Copy blocks carry no source offsets; match their terms by text instead.
  const glossaryFor = block => terms
    .filter(term => typeof term.start === 'number' && typeof block.start === 'number'
      ? term.start >= block.start && term.start < block.end
      : typeof term.text === 'string' && typeof block.text === 'string' && block.text.toLowerCase().includes(term.text.toLowerCase()))
    .map(term => ({ text: term.text, explanation: term.explanation ?? null }));
  for (const block of blocks) {
    if (block.kind === 'heading') {
      const level = Math.max(1, Math.min(6, Number(block.level) || 1));
      const node = { type: 'heading', level, text: block.text, terms: glossaryFor(block), children: [] };
      while (stack[stack.length - 1].level >= level) stack.pop();
      stack[stack.length - 1].children.push(node);
      stack.push(node);
      headings++;
    } else {
      stack[stack.length - 1].children.push({
        type: 'block', kind: block.kind === 'bullet' ? 'bullet' : 'paragraph',
        text: block.text, terms: glossaryFor(block), children: []
      });
    }
  }
  return { outline: root.children, headings, blocks: blocks.length };
}

export function semanticSummary(blocks = []) {
  let headings = 0, bullets = 0, paragraphs = 0;
  const text = [];
  for (const block of blocks) {
    if (block.kind === 'heading') headings++;
    else if (block.kind === 'bullet') bullets++;
    else paragraphs++;
    if (block.text) text.push(block.text);
  }
  const count = words(text.join(' ')).length;
  return { headings, bullets, paragraphs, words: count, readingSeconds: Math.ceil(count * 60 / 200) };
}

const LENS_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

// URL-hash preset bookmarking: "#lens=club" selects a shipped example on load.
export function parseLensHash(hash) {
  const raw = String(hash ?? '').trim().replace(/^#+/, '');
  if (!raw) return null;
  for (const part of raw.split('&')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq) === 'lens' && LENS_ID.test(part.slice(eq + 1))) {
      return { preset: part.slice(eq + 1) };
    }
  }
  return null;
}

export function encodeLensHash(preset) {
  return LENS_ID.test(preset ?? '') ? `#lens=${preset}` : null;
}

const METRIC_ROWS = [
  ['fk', 'Flesch-Kincaid grade', 'grade'],
  ['smog', 'SMOG index', 'grade'],
  ['fog', 'Gunning Fog index', 'grade'],
  ['longWordShare', 'Long-word share (3+ syllables)', 'share'],
  ['jargonShare', 'Jargon and acronym share', 'share'],
  ['avgSentence', 'Average sentence length', 'num'],
  ['overLimit', 'Sentences over 25 words', 'int'],
  ['readingSeconds', 'Estimated reading time', 'time']
];

// The before/after comparator behind the WCAG audit table, badge row and the
// two sentence-length histograms.
export function compareReports(before, after = null, theme = COPY_THEME) {
  const histograms = { before: sentenceHistogram(before.text), after: after ? sentenceHistogram(after.text) : null };
  const pick = (report, hist) => {
    const stats = report.stats;
    return {
      fk: stats.fk, smog: stats.smog, fog: fogFromStats(stats),
      longWordShare: longWordShare(stats), jargonShare: jargonShare(stats),
      avgSentence: stats.sentences ? stats.words / stats.sentences : null,
      overLimit: hist.overLimit, readingSeconds: stats.readingSeconds
    };
  };
  const b = pick(before, histograms.before);
  const a = after ? pick(after, histograms.after) : null;
  const rows = METRIC_ROWS.map(([key, label, kind]) => {
    const row = { key, label, kind, before: b[key], after: a ? a[key] : null, delta: null };
    if (a && typeof row.before === 'number' && typeof row.after === 'number') row.delta = row.after - row.before;
    return row;
  });
  const badges = [];
  badges.push({
    id: 'sc315', scope: 'document', label: 'WCAG 2.2 SC 3.1.5 reading level signal',
    before: readingLevelSummary([b.fk, b.smog, b.fog]),
    after: a ? readingLevelSummary([a.fk, a.smog, a.fog]) : null,
    detail: `all available estimates at or below grade ${READING_LEVEL_MAX_GRADE}`
  });
  badges.push({
    id: 'load', scope: 'document', label: 'Cognitive-load sentences',
    before: histograms.before.overLimit === 0,
    after: histograms.after ? histograms.after.overLimit === 0 : null,
    detail: `sentences over ${COGNITIVE_LOAD_WORDS} words: ${histograms.before.overLimit}${histograms.after ? ` to ${histograms.after.overLimit}` : ''}`
  });
  if (theme) {
    const normal = wcagContrast(theme.ink, theme.background);
    if (normal) {
      badges.push({ id: 'contrast-aa', scope: 'stylesheet', pass: normal.aa,
        label: 'Reading copy contrast, WCAG 2.2 SC 1.4.3 AA', detail: `${normal.ratio.toFixed(2)}:1 against a ${normal.aaMin}:1 minimum` });
      badges.push({ id: 'contrast-aaa', scope: 'stylesheet', pass: normal.aaa,
        label: 'Reading copy contrast, WCAG 2.2 SC 1.4.6 AAA', detail: `${normal.ratio.toFixed(2)}:1 against a ${normal.aaaMin}:1 minimum` });
    }
    const large = wcagContrast(theme.ink, theme.background, { largeText: true });
    if (large) {
      badges.push({ id: 'contrast-large', scope: 'stylesheet', pass: large.aa && large.aaa,
        label: 'Reading copy headings as large text, AA and AAA', detail: `${large.ratio.toFixed(2)}:1 clears ${large.aaMin}:1 and ${large.aaaMin}:1` });
    }
  }
  return { rows, badges, histograms };
}
