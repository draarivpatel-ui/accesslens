import { presets } from './presets.js';
import { inspectDocument, buildReadingCopy, MAX_SOURCE } from './remediate.js';
import { auditCSV, ankiTSV, evaluationBundle, readingHTML, studyHTML, reviewCSV } from './exports.js';
import { shortcutAction } from './shortcuts.js';
import { sm2 } from './study.js';

const $ = id => document.getElementById(id);

const sourceEl = $('document');
const modeEl = $('mode');
const runEl = $('run');
const repairEl = $('repair');
const keysEl = $('keys');
const shortcutsEl = $('shortcuts');
const examplesEl = $('examples');
const charhintEl = $('charhint');
const limitEl = $('limit');
const statusEl = $('status');
const readoutEl = $('readout');
const issuesEl = $('issues');
const issuesIdleEl = $('issues-idle');
const comparisonEl = $('comparison');
const spacingEl = $('spacing');
const beforeEl = $('before');
const afterEl = $('after');
const notesEl = $('notes');
const deckEl = $('deck');
const deckIdleEl = $('deck-idle');
const deckCountEl = $('deck-count');
const deckKindEl = $('deck-kind');
const deckOffsetEl = $('deck-offset');
const deckEvidenceEl = $('deck-evidence');
const cardFrontEl = $('card-front');
const cardBackEl = $('card-back');
const cardPrevEl = $('card-prev');
const cardRevealEl = $('card-reveal');
const cardNextEl = $('card-next');
const cardGradeEl = $('card-grade');
const cardDueEl = $('card-due');
const helpEl = $('help');
const helpLinkEl = $('help-link');

const state = { report: null, copy: null, ratings: {}, card: 0, revealed: false };

const EXPORT_IDS = {
  html: 'export-html',
  tsv: 'export-tsv',
  audit: 'export-audit',
  bundle: 'export-bundle',
  study: 'export-study',
  review: 'export-review'
};
const REPORT_EXPORTS = ['export-tsv', 'export-audit', 'export-bundle', 'export-review'];
const COPY_EXPORTS = ['export-html', 'export-study'];

const READOUT_GROUPS = [
  { title: 'Reading level', rows: [
    ['fk', 'Flesch-Kincaid grade', 'grade'],
    ['smog', 'SMOG index', 'grade'],
    ['daleChallProxy', 'Dale-Chall proxy', 'score']
  ] },
  { title: 'Vocabulary', rows: [
    ['difficultDensity', 'Difficult-word share', 'share'],
    ['terms', 'Glossary terms', 'items']
  ] },
  { title: 'Size', rows: [
    ['words', 'Words', 'count'],
    ['sentences', 'Sentences', 'count'],
    ['readingSeconds', 'Reading time', 'time']
  ] },
  { title: 'Findings', rows: [
    ['long', 'Long sentences', 'items'],
    ['passive', 'Passive voice', 'items'],
    ['ranked', 'Ranked sentences', 'items']
  ] },
  { title: 'Method', rows: [
    ['iterations', 'Ranking passes', 'count'],
    ['residual', 'Residual', 'small'],
    ['converged', 'Converged', 'flag'],
    ['truncated', 'Ranking capped', 'flag']
  ] }
];

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.classList.toggle('err', kind === 'err');
}

function formatStat(value, kind) {
  if (value === null || value === undefined) return 'n/a';
  switch (kind) {
    case 'grade': return typeof value === 'number' ? `grade ${value.toFixed(1)}` : String(value);
    case 'share': return typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : String(value);
    case 'time': {
      if (typeof value !== 'number') return String(value);
      const s = Math.max(0, Math.round(value));
      return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
    }
    case 'items': return Array.isArray(value) ? String(value.length) : String(value);
    case 'small': return typeof value === 'number' ? value.toExponential(1) : String(value);
    case 'flag': return value ? 'yes' : 'no';
    default: return typeof value === 'number' ? String(Math.round(value * 100) / 100) : String(value);
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function updateCount() {
  const n = sourceEl.value.length;
  charhintEl.textContent = `${n.toLocaleString()} character${n === 1 ? '' : 's'}`;
  charhintEl.classList.toggle('over', n > MAX_SOURCE);
  limitEl.textContent = n > MAX_SOURCE
    ? `over the ${MAX_SOURCE.toLocaleString()} limit; split the document`
    : `limit ${MAX_SOURCE.toLocaleString()}`;
}

function setExports({ analyzed, repaired }) {
  for (const id of Object.values(EXPORT_IDS)) $(id).disabled = true;
  if (!analyzed) return;
  for (const id of REPORT_EXPORTS) $(id).disabled = false;
  if (repaired) for (const id of COPY_EXPORTS) $(id).disabled = false;
}

function renderIdleAnalysis() {
  readoutEl.replaceChildren(el('p', 'idle', 'The readout fills in after Run checks.'));
  issuesEl.replaceChildren();
  issuesIdleEl.textContent = 'Findings tied to the source appear here after Run checks.';
  issuesIdleEl.hidden = false;
  $('language-evidence').replaceChildren();
}

function renderIdleComparison() {
  beforeEl.replaceChildren(el('p', 'idle', 'The analyzed source appears here once a reading copy is built.'));
  afterEl.replaceChildren(el('p', 'idle', 'Choose Build reading copy to see the suggested edit.'));
  notesEl.replaceChildren();
  const summary = $('comparison-summary');
  summary.hidden = true;
  summary.textContent = '';
}

function renderIdleDeck(message) {
  deckEl.hidden = true;
  deckIdleEl.hidden = false;
  deckIdleEl.textContent = message || 'Cards appear here after Run checks. Reveal each card, then rate your recall from 0 to 5 to build a review schedule.';
}

function invalidate() {
  if (!state.report && !state.copy) return;
  state.report = null;
  state.copy = null;
  state.ratings = {};
  state.card = 0;
  state.revealed = false;
  repairEl.disabled = true;
  renderIdleAnalysis();
  renderIdleComparison();
  renderIdleDeck();
  setExports({ analyzed: false, repaired: false });
  setStatus('Source or input mode changed. Run checks again.');
}

function clearExample() {
  const checked = examplesEl.querySelector('input:checked');
  if (checked) checked.checked = false;
}

function selectPreset(index) {
  const preset = presets[index];
  if (!preset) return;
  sourceEl.value = preset.source;
  if ([...modeEl.options].some(o => o.value === preset.mode)) modeEl.value = preset.mode;
  updateCount();
  invalidate();
}

function buildExamplePicker() {
  const chips = el('div', 'chips');
  presets.forEach((preset, index) => {
    const label = el('label', 'chip');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'example';
    input.value = preset.id;
    input.addEventListener('change', () => { if (input.checked) selectPreset(index); });
    label.append(input, el('span', null, preset.label));
    chips.append(label);
  });
  examplesEl.append(chips);
  const first = chips.querySelector('input');
  if (first) first.checked = true;
}

function buildModePicker() {
  const seen = new Set();
  for (const preset of presets) {
    if (seen.has(preset.mode)) continue;
    seen.add(preset.mode);
    const option = document.createElement('option');
    option.value = preset.mode;
    option.textContent = { text: 'Plain text', html: 'HTML' }[preset.mode]
      ?? preset.mode.replace(/[-_]+/g, ' ').replace(/^\w/, c => c.toUpperCase());
    modeEl.append(option);
  }
}

function renderReadout(stats) {
  readoutEl.replaceChildren();
  for (const group of READOUT_GROUPS) {
    const wrap = el('div', 'group');
    wrap.append(el('h3', null, group.title));
    const dl = document.createElement('dl');
    for (const [key, label, kind] of group.rows) {
      const dt = el('dt', null, label);
      const dd = el('dd', null, formatStat(stats[key], kind));
      dl.append(dt, dd);
    }
    wrap.append(dl);
    readoutEl.append(wrap);
  }
}

function showEvidence(start, end) {
  const len = sourceEl.value.length;
  const s = Math.max(0, Math.min(Number(start) || 0, len));
  const e = Math.max(s, Math.min(Number(end) || 0, len));
  sourceEl.focus();
  sourceEl.setSelectionRange(s, e);
  const lineHeight = parseFloat(getComputedStyle(sourceEl).lineHeight) || 26;
  const line = sourceEl.value.slice(0, s).split('\n').length;
  sourceEl.scrollTop = Math.max(0, (line - 3) * lineHeight);
}

function evidenceButton(start, end, label) {
  const btn = el('button', 'evidence', 'Show in source');
  btn.type = 'button';
  if (label) btn.setAttribute('aria-label', `Show in source: ${String(label).slice(0, 90)}`);
  btn.addEventListener('click', () => showEvidence(start, end));
  return btn;
}

function renderIssues(issues) {
  issuesEl.replaceChildren();
  issuesIdleEl.hidden = issues.length > 0;
  if (!issues.length) issuesIdleEl.textContent = 'No findings flagged in this document.';
  for (const issue of issues) {
    const li = el('li', 'issue');
    const meta = el('div', 'meta');
    if (issue.kind) meta.append(el('span', 'badge kind', String(issue.kind)));
    if (issue.criterion) meta.append(el('span', 'badge', String(issue.criterion)));
    meta.append(el('span', 'offset', `${issue.start}..${issue.end}`));
    li.append(meta);
    li.append(el('p', 'issue-label', issue.label));
    li.append(el('p', 'issue-detail', issue.detail));
    li.append(evidenceButton(issue.start, issue.end, issue.label));
    issuesEl.append(li);
  }
}

function renderLanguageEvidence(stats) {
  const host = $('language-evidence');
  host.replaceChildren();
  const sections = [
    ['Key points', stats.ranked, 3, item => `TextRank ${item.score}`],
    ['Acronyms and jargon', stats.terms, 20, item => item.explanation ?? 'Needs an expansion from the author.'],
    ['Passive voice signals', stats.passive, 20, () => 'Review who performs the action.'],
    ['Long sentences', stats.long, 20, item => item.split?.join(' ') ?? 'No conservative split suggested.']
  ];
  for (const [title, items, max, describe] of sections) {
    if (!items.length) continue;
    const section = el('details', 'language-finding');
    section.open = title === 'Key points';
    section.append(el('summary', null, `${title} (${Math.min(max, items.length)} of ${items.length})`));
    const list = el('ol', 'issues');
    for (const item of items.slice(0, max)) {
      const row = el('li', 'issue');
      row.append(el('p', 'issue-label', item.text), el('p', 'issue-detail', describe(item)),
        evidenceButton(item.sourceStart, item.sourceEnd, item.text));
      list.append(row);
    }
    section.append(list);
    host.append(section);
  }
}

function renderBlocksPreview(container, blocks, emptyText) {
  container.replaceChildren();
  if (!Array.isArray(blocks) || !blocks.length) {
    container.append(el('p', 'idle', emptyText));
    return;
  }
  let list = null;
  for (const block of blocks) {
    if (block.kind === 'bullet') {
      if (!list) { list = document.createElement('ul'); container.append(list); }
      list.append(el('li', null, block.text));
      continue;
    }
    list = null;
    if (block.kind === 'heading') {
      const level = Number(block.level) || 1;
      container.append(el(level === 1 ? 'h4' : level >= 5 ? 'h6' : 'h5', null, block.text));
    } else {
      container.append(el('p', null, block.text));
    }
  }
}

function renderNotes(copy) {
  notesEl.replaceChildren();
  const groups = [
    ['Action checklist', copy.actions],
    ['Review before sharing', copy.notes]
  ];
  for (const [title, items] of groups) {
    if (!Array.isArray(items) || !items.length) continue;
    notesEl.append(el('h4', null, title));
    const ul = document.createElement('ul');
    for (const item of items) ul.append(el('li', null, item));
    notesEl.append(ul);
  }
}

function renderDelta(before, after) {
  const target = $('comparison-summary');
  const grade = v => v === null ? 'n/a' : v.toFixed(2);
  const difference = before.stats.fk === null || after.stats.fk === null ? null : after.stats.fk - before.stats.fk;
  const delta = difference === null ? '' : ` (${difference > 0 ? '+' : ''}${difference.toFixed(2)})`;
  target.textContent = `Estimated grade ${grade(before.stats.fk)} to ${grade(after.stats.fk)}${delta} | Audit flags ${before.issues.length} to ${after.issues.length} | Estimated time ${formatStat(before.stats.readingSeconds, 'time')} to ${formatStat(after.stats.readingSeconds, 'time')}`;
  target.hidden = false;
}

function renderDeck(report) {
  const cards = report.cards || [];
  if (!cards.length) {
    renderIdleDeck('No study cards for this document.');
    return;
  }
  deckIdleEl.hidden = true;
  deckEl.hidden = false;
  state.card = 0;
  renderCard();
}

function renderCard() {
  const cards = state.report?.cards || [];
  const card = cards[state.card];
  if (!card) return;
  state.revealed = false;
  cardFrontEl.textContent = card.front;
  cardBackEl.textContent = card.back;
  cardBackEl.hidden = true;
  cardRevealEl.textContent = 'Show answer';
  cardRevealEl.setAttribute('aria-expanded', 'false');
  deckCountEl.textContent = `Card ${state.card + 1} of ${cards.length}`;
  deckKindEl.textContent = card.kind ? String(card.kind) : 'card';
  deckOffsetEl.textContent = `${card.sourceStart}..${card.sourceEnd}`;
  deckEvidenceEl.setAttribute('aria-label', `Show in source: ${String(card.front).slice(0, 90)}`);
  deckEvidenceEl.onclick = () => showEvidence(card.sourceStart, card.sourceEnd);
  cardPrevEl.disabled = state.card === 0;
  cardNextEl.disabled = state.card === cards.length - 1;
  cardGradeEl.value = '';
  cardGradeEl.disabled = true;
  const rating = state.ratings[state.card];
  cardDueEl.textContent = rating ? dueText(rating) : '';
}

function dueText(rating) {
  if (!rating) return '';
  const parts = [];
  if (typeof rating.due === 'string' && rating.due) parts.push(`next review ${rating.due}`);
  else if (rating.due instanceof Date && !Number.isNaN(rating.due.getTime())) parts.push(`next review ${rating.due.toISOString().slice(0, 10)}`);
  if (typeof rating.interval === 'number') parts.push(`interval ${rating.interval} d`);
  return parts.join(', ');
}

function revealCard() {
  state.revealed = !state.revealed;
  cardBackEl.hidden = !state.revealed;
  cardRevealEl.textContent = state.revealed ? 'Hide answer' : 'Show answer';
  cardRevealEl.setAttribute('aria-expanded', String(state.revealed));
  cardGradeEl.disabled = !state.revealed;
}

function rateCard() {
  const value = cardGradeEl.value;
  if (value === '') return;
  const grade = Number(value);
  if (!Number.isInteger(grade) || grade < 0 || grade > 5) return;
  try {
    const next = sm2(state.ratings[state.card] ?? null, grade);
    state.ratings[state.card] = next;
    cardDueEl.textContent = dueText(next);
    setStatus(`Card ${state.card + 1} graded ${grade} of 5. ${dueText(next)}`.trim());
  } catch (err) {
    setStatus(`Could not record the grade: ${err.message}`, 'err');
  }
}

function run() {
  const source = sourceEl.value;
  if (!source.trim()) {
    setStatus('Nothing to check. Paste a document or pick an example first.', 'err');
    sourceEl.focus();
    return;
  }
  if (source.length > MAX_SOURCE) {
    setStatus(`That document is ${source.length.toLocaleString()} characters, over the ${MAX_SOURCE.toLocaleString()} limit. Trim it and run again.`, 'err');
    sourceEl.focus();
    return;
  }
  try {
    const report = inspectDocument(source, modeEl.value);
    state.report = report;
    state.copy = null;
    state.ratings = {};
    state.card = 0;
    renderReadout(report.stats);
    renderIssues(report.issues || []);
    renderLanguageEvidence(report.stats);
    renderIdleComparison();
    renderDeck(report);
    repairEl.disabled = false;
    setExports({ analyzed: true, repaired: false });
    const count = (report.issues || []).length;
    const notes = [];
    if (report.parsed?.limited) notes.push('deep HTML was cut off');
    if (report.stats.truncated) notes.push('ranking covered the first 400 sentences');
    setStatus(`Checked ${report.stats.words} words in ${report.stats.sentences} sentences: ${count} finding${count === 1 ? '' : 's'}.${notes.length ? ` Note: ${notes.join('; ')}.` : ''}`);
  } catch (err) {
    setStatus(`Run failed: ${err.message}`, 'err');
  }
}

function repair() {
  if (!state.report) {
    setStatus('Run checks before building a reading copy.', 'err');
    return;
  }
  try {
    const copy = buildReadingCopy(state.report);
    state.copy = copy;
    renderBlocksPreview(beforeEl, state.report.blocks, 'No blocks in this source.');
    renderBlocksPreview(afterEl, copy.blocks, 'The builder returned no blocks.');
    renderNotes(copy);
    renderDelta(state.report, copy.report);
    setExports({ analyzed: true, repaired: true });
    setStatus('Reading copy built. The suggested edit sits beside the original below.');
  } catch (err) {
    setStatus(`Could not build the reading copy: ${err.message}`, 'err');
  }
}

function download(name, text, mime) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const EXPORTERS = {
  'export-html': () => {
    if (!state.copy) throw new Error('Build a reading copy first.');
    return ['accesslens-reading.html', readingHTML(state.copy), 'text/html'];
  },
  'export-tsv': () => ['accesslens-cards.tsv', ankiTSV(state.report.cards), 'text/tab-separated-values'],
  'export-audit': () => ['accesslens-audit.csv', auditCSV(state.report, state.copy?.report), 'text/csv'],
  'export-bundle': async () => {
    const report = state.report;
    const copyReport = state.copy?.report;
    return ['accesslens-evaluation.json', await evaluationBundle(report, copyReport), 'application/json'];
  },
  'export-study': () => {
    if (!state.copy) throw new Error('Build a reading copy first.');
    return ['accesslens-study.html', studyHTML(state.copy, state.report), 'text/html'];
  },
  'export-review': () => ['accesslens-review.csv', reviewCSV(state.report.cards, state.ratings), 'text/csv']
};

for (const id of Object.values(EXPORT_IDS)) {
  $(id).addEventListener('click', async () => {
    if (!state.report) {
      setStatus('Run checks before exporting.', 'err');
      return;
    }
    try {
      const [name, text, mime] = await EXPORTERS[id]();
      download(name, text, mime);
      setStatus(`Saved ${name}.`);
    } catch (err) {
      setStatus(`Export failed: ${err.message}`, 'err');
    }
  });
}

runEl.addEventListener('click', run);
repairEl.addEventListener('click', repair);
sourceEl.addEventListener('input', () => { updateCount(); clearExample(); invalidate(); });
modeEl.addEventListener('change', () => { clearExample(); invalidate(); });
spacingEl.addEventListener('change', () => comparisonEl.classList.toggle('roomy', spacingEl.checked));
cardPrevEl.addEventListener('click', () => { if (state.card > 0) { state.card -= 1; renderCard(); } });
cardNextEl.addEventListener('click', () => {
  const cards = state.report?.cards || [];
  if (state.card < cards.length - 1) { state.card += 1; renderCard(); }
});
cardRevealEl.addEventListener('click', revealCard);
cardGradeEl.addEventListener('change', rateCard);
shortcutsEl.addEventListener('click', () => {
  helpEl.open = true;
  helpEl.querySelector('summary').focus();
});
helpLinkEl.addEventListener('click', () => { helpEl.open = true; });

document.addEventListener('keydown', event => {
  const action = shortcutAction(event, keysEl.checked);
  if (!action) return;
  event.preventDefault();
  if (action === 'analyze') run();
  else if (action === 'editor') sourceEl.focus();
});

buildModePicker();
buildExamplePicker();
if (presets[0]) selectPreset(0);
updateCount();
renderIdleAnalysis();
renderIdleComparison();
renderIdleDeck();
setExports({ analyzed: false, repaired: false });
