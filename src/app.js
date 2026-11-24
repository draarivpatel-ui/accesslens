import { presets } from './presets.js';
import { inspectDocument, buildReadingCopy, MAX_SOURCE } from './remediate.js';
import { auditCSV, ankiTSV, certificateCSV, certificateJSON, certificateMarkdown, evaluationBundle, readingHTML, reviewCSV, studyHTML, verifyCertificate } from './exports.js';
import { shortcutAction } from './shortcuts.js';
import { sm2 } from './study.js';
import { runSelfTests } from './selftest.js';
import { AUDIENCES, BARRIERS, FORMATS, buildFixCards, cognitiveView, documentTitle, formatPack, keyboardPath,
  packSummary, screenReaderScript } from './handoff.js';
import { contrastMath, fleschKincaidMath, spacingMath, suggestForeground, targetSize } from './learn.js';
import {
  COPY_THEME, DYSLEXIA_SPACING, compareReports, encodeLensHash, histogramGeometry,
  parseLensHash, semanticSummary, semanticTree, textSpacingAudit, wcagContrast
} from './wcag-audit.js';

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
const wcagIdleEl = $('wcag-idle');
const wcagAuditEl = $('wcag-audit');
const wcagRowsEl = $('wcag-rows');
const wcagBadgesEl = $('wcag-badges');
const histBeforeEl = $('hist-before');
const histAfterEl = $('hist-after');
const histBeforeCapEl = $('hist-before-cap');
const histAfterCapEl = $('hist-after-cap');
const profileEl = $('profile');
const profileNoteEl = $('profile-note');
const papersEl = document.querySelector('#comparison .papers');
const outlineEl = $('outline');
const outlineSummaryEl = $('outline-summary');
const outlineTreeEl = $('outline-tree');
const verifyTextEl = $('verify-text');
const verifyEl = $('verify');
const verifyResultEl = $('verify-result');
const selftestsRunEl = $('selftests-run');
const selftestsStatusEl = $('selftests-status');
const selftestsListEl = $('selftests-list');

const state = { report: null, copy: null, ratings: {}, card: 0, revealed: false, profile: 'default',
  barrier: 'cognitive', barrierChosen: false, audience: 'nonprofit', format: 'github', runs: 0 };

const EXPORT_IDS = {
  html: 'export-html',
  tsv: 'export-tsv',
  audit: 'export-audit',
  bundle: 'export-bundle',
  study: 'export-study',
  review: 'export-review',
  cert: 'export-cert',
  certcsv: 'export-certcsv',
  certmd: 'export-certmd'
};
const REPORT_EXPORTS = ['export-tsv', 'export-audit', 'export-bundle', 'export-review', 'export-cert', 'export-certcsv', 'export-certmd'];
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
  renderWcag();
  renderHandoff();
  if (state.profile === 'outline') renderOutline();
  setExports({ analyzed: false, repaired: false });
  setStatus('Source or input mode changed. Run checks again.');
}

function clearExample() {
  const checked = examplesEl.querySelector('input:checked');
  if (checked) checked.checked = false;
}

function selectPreset(index, { updateHash = true } = {}) {
  const preset = presets[index];
  if (!preset) return;
  sourceEl.value = preset.source;
  if ([...modeEl.options].some(o => o.value === preset.mode)) modeEl.value = preset.mode;
  updateCount();
  invalidate();
  if (updateHash) setLensHash(preset);
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

function metricText(value, kind) {
  if (value === null || value === undefined) return 'n/a';
  if (kind === 'share') return `${(value * 100).toFixed(1)}%`;
  if (kind === 'grade') return `grade ${value.toFixed(2)}`;
  if (kind === 'time') return formatStat(value, 'time');
  if (kind === 'int') return String(Math.round(value));
  return value.toFixed(2);
}

function metricDeltaCell(row) {
  const td = el('td', 'num');
  if (row.delta === null || row.delta === undefined) { td.textContent = '-'; return td; }
  td.textContent = row.kind === 'share' ? `${row.delta > 0 ? '+' : ''}${(row.delta * 100).toFixed(1)} pt`
    : row.kind === 'int' || row.kind === 'time' ? `${row.delta > 0 ? '+' : ''}${Math.round(row.delta)}`
    : `${row.delta > 0 ? '+' : ''}${row.delta.toFixed(2)}`;
  if (row.delta !== 0) td.classList.add(row.delta < 0 ? 'delta-down' : 'delta-up');
  return td;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function histogramNode(hist, title) {
  const geo = histogramGeometry(hist);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${geo.width} ${geo.height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', title);
  svg.classList.add('hist');
  const name = document.createElementNS(SVG_NS, 'title');
  name.textContent = title;
  svg.append(name);
  for (const bar of geo.bars) {
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', bar.x);
    rect.setAttribute('y', bar.y);
    rect.setAttribute('width', bar.width);
    rect.setAttribute('height', bar.height);
    rect.setAttribute('fill', bar.load ? '#8f2f1f' : '#174962');
    const caption = document.createElementNS(SVG_NS, 'title');
    caption.textContent = `${bar.label} words: ${bar.count} sentence${bar.count === 1 ? '' : 's'}`;
    rect.append(caption);
    svg.append(rect);
    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', bar.x + bar.width / 2);
    label.setAttribute('y', bar.labelY);
    label.setAttribute('text-anchor', 'middle');
    label.classList.add('hist-label');
    label.textContent = bar.label;
    svg.append(label);
  }
  return svg;
}

function badgeNode(badge) {
  const value = badge.scope === 'stylesheet' ? badge.pass : badge.after !== null && badge.after !== undefined ? badge.after : badge.before;
  const cls = value === null || value === undefined ? 'wcag-na' : value ? 'wcag-pass' : 'wcag-fail';
  const verdict = value === null || value === undefined ? 'n/a' : value ? 'pass' : 'fail';
  const li = el('li', cls);
  li.append(el('span', 'verdict', verdict));
  const text = badge.scope === 'document'
    ? `${badge.label}: original ${badge.before === null ? 'n/a' : badge.before ? 'pass' : 'fail'}${badge.after === null ? '' : `, copy ${badge.after ? 'pass' : 'fail'}`}. ${badge.detail}`
    : `${badge.label}. ${badge.detail}`;
  li.append(el('span', null, text));
  return li;
}

function renderWcag() {
  const before = state.report;
  const after = state.copy?.report ?? null;
  if (!before) {
    wcagAuditEl.hidden = true;
    wcagIdleEl.hidden = false;
    wcagRowsEl.replaceChildren();
    wcagBadgesEl.replaceChildren();
    histBeforeEl.replaceChildren();
    histAfterEl.replaceChildren();
    return;
  }
  wcagIdleEl.hidden = true;
  wcagAuditEl.hidden = false;
  const comparison = compareReports(before, after, COPY_THEME);
  wcagRowsEl.replaceChildren();
  for (const row of comparison.rows) {
    const tr = document.createElement('tr');
    const th = el('th', null, row.label);
    th.setAttribute('scope', 'row');
    tr.append(th, el('td', null, metricText(row.before, row.kind)),
      el('td', null, after ? metricText(row.after, row.kind) : 'not built'), metricDeltaCell(row));
    wcagRowsEl.append(tr);
  }
  wcagBadgesEl.replaceChildren();
  for (const badge of comparison.badges) wcagBadgesEl.append(badgeNode(badge));
  histBeforeEl.replaceChildren(histogramNode(comparison.histograms.before, 'Original sentence length distribution'));
  histBeforeCapEl.textContent = `Original sentence lengths (${comparison.histograms.before.overLimit} over 25 words)`;
  if (comparison.histograms.after) {
    histAfterEl.replaceChildren(histogramNode(comparison.histograms.after, 'Reading copy sentence length distribution'));
    histAfterCapEl.textContent = `Reading copy sentence lengths (${comparison.histograms.after.overLimit} over 25 words)`;
  } else {
    histAfterEl.replaceChildren(el('p', 'idle', 'Build a reading copy to compare.'));
    histAfterCapEl.textContent = 'Reading copy sentence lengths';
  }
}

function outlineList(nodes) {
  const ul = document.createElement('ul');
  for (const node of nodes) {
    const li = document.createElement('li');
    const tag = node.type === 'heading' ? `h${node.level}` : node.kind === 'bullet' ? 'li' : 'p';
    li.append(el('span', 'h-tag', tag), el('span', 'blk', node.text));
    if (node.terms?.length) {
      const terms = el('ul', 'term-list');
      for (const term of node.terms) {
        terms.append(el('li', 'term', term.explanation ? `${term.text}: ${term.explanation}` : `${term.text}: needs an author expansion`));
      }
      li.append(terms);
    }
    if (node.children?.length) li.append(outlineList(node.children));
    ul.append(li);
  }
  return ul;
}

function renderOutline() {
  outlineTreeEl.replaceChildren();
  const copy = state.copy;
  const blocks = copy?.blocks ?? state.report?.blocks ?? [];
  if (!blocks.length) {
    outlineSummaryEl.textContent = 'Run checks, then build a reading copy to see the reader outline.';
    outlineSummaryEl.hidden = false;
    return;
  }
  const terms = (copy ? copy.report.stats.terms : state.report.stats.terms) ?? [];
  const tree = semanticTree(blocks, terms);
  const summary = semanticSummary(blocks);
  const source = copy ? 'reading copy' : 'original';
  const original = copy ? semanticSummary(state.report.blocks ?? []) : null;
  const delta = original ? `, reading time ${formatStat(original.readingSeconds, 'time')} to ${formatStat(summary.readingSeconds, 'time')}` : '';
  outlineSummaryEl.textContent = `Screen-reader outline of the ${source}: ${summary.headings} headings, ${summary.paragraphs} paragraphs, ${summary.bullets} bullets, ${summary.words} words${delta}.`;
  outlineSummaryEl.hidden = false;
  outlineTreeEl.append(outlineList(tree.outline));
}

const PROFILE_CLASS = { dyslexia: 'profile-dyslexia', contrast: 'profile-contrast', outline: 'profile-outline' };

function updateProfileNote(profile) {
  profileNoteEl.classList.remove('err');
  if (profile === 'dyslexia') {
    const audit = textSpacingAudit(DYSLEXIA_SPACING);
    profileNoteEl.textContent = `WCAG 1.4.12 text spacing ${audit.pass ? 'pass' : 'fail'}: letter ${DYSLEXIA_SPACING.letterSpacing}em, word ${DYSLEXIA_SPACING.wordSpacing}em, line ${DYSLEXIA_SPACING.lineHeight}em, paragraph ${DYSLEXIA_SPACING.paragraphSpacing}em.`;
    profileNoteEl.hidden = false;
  } else if (profile === 'contrast') {
    const check = wcagContrast('#000000', '#ffffff');
    profileNoteEl.textContent = `Computed contrast ${check.ratio.toFixed(1)}:1 on black and white. WCAG 1.4.6 AAA needs ${check.aaaMin}:1, ${check.aaa ? 'met' : 'not met'}.`;
    profileNoteEl.hidden = false;
  } else if (profile === 'outline') {
    profileNoteEl.textContent = 'The reader outline shows the heading hierarchy and glossary terms a screen reader announces.';
    profileNoteEl.hidden = false;
  } else {
    profileNoteEl.textContent = '';
    profileNoteEl.hidden = true;
  }
}

function applyProfile(profile) {
  state.profile = PROFILE_CLASS[profile] ? profile : 'default';
  comparisonEl.classList.remove('profile-dyslexia', 'profile-contrast', 'profile-outline');
  if (PROFILE_CLASS[state.profile]) comparisonEl.classList.add(PROFILE_CLASS[state.profile]);
  outlineEl.hidden = state.profile !== 'outline';
  papersEl.hidden = state.profile === 'outline';
  if (state.profile === 'outline') renderOutline();
  updateProfileNote(state.profile);
}

function presetIndexFromHash() {
  const parsed = parseLensHash(location.hash);
  return parsed ? presets.findIndex(p => p.id === parsed.preset) : -1;
}

function setLensHash(preset) {
  const hash = encodeLensHash(preset.id);
  if (!hash || location.hash === hash) return;
  try { history.replaceState(null, '', hash); } catch { /* file URLs keep the old hash */ }
}

function clearLensHash() {
  if (!parseLensHash(location.hash)) return;
  try { history.replaceState(null, '', location.pathname + location.search); } catch { /* file URLs keep the old hash */ }
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
    renderWcag();
    if (state.profile === 'outline') renderOutline();
    renderDeck(report);
    renderHandoff();
    state.runs += 1;
    statusEl.dataset.runs = String(state.runs);
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
    renderWcag();
    if (state.profile === 'outline') renderOutline();
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
  'export-review': () => ['accesslens-review.csv', reviewCSV(state.report.cards, state.ratings), 'text/csv'],
  'export-cert': () => ['accesslens-certificate.json', certificateJSON(state.report, state.copy?.report ?? null), 'application/json'],
  'export-certcsv': () => ['accesslens-certificate.csv', certificateCSV(state.report, state.copy?.report ?? null), 'text/csv'],
  'export-certmd': () => ['accesslens-certificate.md', certificateMarkdown(state.report, state.copy?.report ?? null), 'text/markdown']
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

// Community fix handoff: barrier previews and Fix Cards.
const handoffIdleEl = $('handoff-idle');
const handoffBodyEl = $('handoff-body');
const simBeforeEl = $('sim-before');
const simAfterEl = $('sim-after');
const simTallyEl = $('sim-tally');
const fixCardsEl = $('fix-cards');
const fixTextEl = $('fix-text');
const fixStatusEl = $('fix-status');

function buildHandoffControls() {
  const chips = $('barrier-chips');
  for (const barrier of BARRIERS) {
    const label = el('label', 'chip');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'barrier';
    input.value = barrier.id;
    input.checked = barrier.id === state.barrier;
    label.append(input, el('span', null, barrier.label));
    chips.append(label);
  }
  for (const [id, aud] of Object.entries(AUDIENCES)) $('fix-audience').append(new Option(aud.label, id));
  for (const [id, label] of Object.entries(FORMATS)) $('fix-format').append(new Option(label, id));
  $('fix-audience').value = state.audience;
  $('fix-format').value = state.format;
}

function fixStatus(text, kind) {
  fixStatusEl.hidden = false;
  fixStatusEl.textContent = text;
  fixStatusEl.classList.toggle('err', kind === 'err');
}

const BARRIER_TITLE = {
  lowvision: 'Blurred and enlarged',
  screenreader: 'What a screen reader announces',
  keyboard: 'Tab order for keyboard and switch users',
  cognitive: 'Long sentences fade, hard words marked'
};

function renderSimulation() {
  const report = state.report;
  renderBlocksPreview(simBeforeEl, report.blocks, 'No readable blocks in this source.');
  simAfterEl.replaceChildren();
  simAfterEl.className = `sim-body sim-${state.barrier}`;
  $('sim-after-h').textContent = BARRIER_TITLE[state.barrier];
  const issues = report.issues || [];
  if (state.barrier === 'lowvision') {
    renderBlocksPreview(simAfterEl, report.blocks, 'No readable blocks in this source.');
    const n = issues.filter(i => i.id === 'contrast' || i.id === 'tiny-text').length;
    simTallyEl.textContent = n ? `${n} low-contrast or tiny text finding${n === 1 ? '' : 's'} get even harder to read like this.`
      : 'No contrast or tiny text findings. Zoom and blur still test the layout.';
  } else if (state.barrier === 'screenreader') {
    const lines = screenReaderScript(report);
    const list = el('ol', 'announce');
    for (const line of lines) {
      const li = el('li', line.problem ? 'problem' : '');
      li.append(el('span', 'said', line.text));
      if (line.problem) li.append(el('span', 'why', line.problem));
      list.append(li);
    }
    simAfterEl.append(list);
    const bad = lines.filter(l => l.problem).length;
    simTallyEl.textContent = `${lines.length} announcements, ${bad} confusing or missing.`;
  } else if (state.barrier === 'keyboard') {
    const stops = keyboardPath(report);
    if (!stops.length) {
      simAfterEl.append(el('p', 'idle', report.parsed ? 'This page has no links or controls to reach.' : 'Plain text has no links or controls. Switch Input mode to HTML and paste the page source to trace its Tab order.'));
      simTallyEl.textContent = report.parsed ? '0 Tab stops.' : 'Tab order needs HTML.';
    } else {
      const list = el('ol', 'tabpath');
      for (const stop of stops) {
        const li = el('li', stop.problem ? 'problem' : '');
        li.append(el('span', 'key', `Tab ${stop.stop}`), el('span', 'said', `${stop.role}${stop.name ? `, "${stop.name}"` : ', no name'}`));
        if (stop.problem) li.append(el('span', 'why', stop.problem));
        list.append(li);
      }
      simAfterEl.append(list);
      const bad = stops.filter(s => s.problem).length;
      simTallyEl.textContent = `${stops.length} Tab stop${stops.length === 1 ? '' : 's'}, ${bad} a keyboard or voice user cannot identify.`;
    }
  } else {
    const view = cognitiveView(report.blocks);
    let hard = 0, faded = 0;
    for (const block of view) {
      hard += block.hard;
      faded += block.faded;
      const node = el(block.kind === 'heading' ? 'h5' : 'p', block.kind === 'bullet' ? 'bullet' : null);
      for (const token of block.tokens) node.append(token.cls ? el('span', token.cls, token.text) : document.createTextNode(token.text));
      simAfterEl.append(node);
    }
    simTallyEl.textContent = `${hard} hard word${hard === 1 ? '' : 's'} marked, ${faded} word${faded === 1 ? '' : 's'} past the 25-word limit fading out.`;
  }
}

function currentPack() {
  const cards = buildFixCards(state.report);
  return { cards, text: formatPack(cards, { format: state.format, audience: state.audience, title: documentTitle(state.report) }) };
}

function renderFixCards() {
  const { cards, text } = currentPack();
  const summary = packSummary(cards);
  const facts = [['Fixes', summary.total], ['High priority', summary.high], ['Quick fixes', summary.quick], ['Groups helped', summary.people.length]];
  $('fix-summary').replaceChildren(...facts.map(([k, v]) => {
    const wrap = el('div');
    wrap.append(el('dt', null, k), el('dd', null, String(v)));
    return wrap;
  }));
  fixCardsEl.replaceChildren();
  if (!cards.length) fixCardsEl.append(el('li', 'idle', 'No fixes flagged. Still test the page with a keyboard and a screen reader.'));
  cards.forEach((card, i) => {
    const li = el('li', `fix-card pri-${card.priority}`);
    const head = el('div', 'fix-card-head');
    head.append(el('span', 'pri', `${card.priority[0].toUpperCase()}${card.priority.slice(1)}`), el('h4', null, `${i + 1}. ${card.title}`));
    const meta = el('p', 'fix-meta');
    meta.append(el('span', null, card.sc), el('span', null, card.effortLabel),
      el('span', null, card.lines.length ? `Line${card.lines.length > 1 ? 's' : ''} ${card.lines.join(', ')}` : 'Whole document'));
    const who = el('ul', 'who');
    for (const person of card.who) who.append(el('li', null, person));
    const steps = el('ol', 'steps');
    for (const step of card.steps) steps.append(el('li', null, step));
    li.append(head, meta, who, el('p', 'why', `${card.why}${card.terms.length ? ` Terms: ${card.terms.join(', ')}.` : ''}`), steps);
    if (card.starts.length) li.append(evidenceButton(card.starts[0], card.starts[0] + 1, card.title));
    fixCardsEl.append(li);
  });
  fixTextEl.value = text;
}

function renderHandoff() {
  const ready = Boolean(state.report);
  handoffIdleEl.hidden = ready;
  handoffBodyEl.hidden = !ready;
  if (!ready) return;
  if (!state.barrierChosen) {
    state.barrier = state.report.parsed ? 'screenreader' : 'cognitive';
    const input = $('barrier-chips').querySelector(`input[value="${state.barrier}"]`);
    if (input) input.checked = true;
  }
  renderSimulation();
  renderFixCards();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const prior = document.activeElement;
    fixTextEl.closest('details').open = true;
    fixTextEl.focus();
    fixTextEl.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    prior?.focus?.();
    return ok;
  }
}

$('barrier-chips').addEventListener('change', event => {
  if (event.target.name !== 'barrier') return;
  state.barrier = event.target.value;
  state.barrierChosen = true;
  if (state.report) renderSimulation();
});
$('fix-audience').addEventListener('change', event => { state.audience = event.target.value; if (state.report) renderFixCards(); });
$('fix-format').addEventListener('change', event => { state.format = event.target.value; if (state.report) renderFixCards(); });
$('fix-copy').addEventListener('click', async () => {
  if (!state.report) return;
  const ok = await copyText(currentPack().text);
  fixStatus(ok ? `Copied the ${FORMATS[state.format].toLowerCase()} text. Paste it where the site owner will see it.`
    : 'This browser blocked copying. The text is selected in the preview below; use Handoff .md instead.', ok ? null : 'err');
});
$('fix-download').addEventListener('click', () => {
  if (!state.report) return;
  const name = `accesslens-handoff-${state.format}.md`;
  download(name, currentPack().text, 'text/markdown');
  fixStatus(`Saved ${name}.`);
});

// "How WCAG 2.2 math works" drawer.
const learnEl = $('learn');
const fmt = (v, d = 4) => Number(v).toFixed(d);

function renderContrastMath() {
  const fg = $('learn-fg').value, bg = $('learn-bg').value;
  const m = contrastMath(fg, bg);
  if (!m) return;
  const sample = $('learn-sample');
  sample.style.color = fg;
  sample.style.backgroundColor = bg;
  $('m-srgb').textContent = `text ${m.fg.channels8.join(', ')} / 255 = ${m.fg.srgb.map(c => fmt(c, 3)).join(', ')}; background ${m.bg.srgb.map(c => fmt(c, 3)).join(', ')}`;
  $('m-linear').textContent = `text ${m.fg.linear.map(c => fmt(c)).join(', ')}; background ${m.bg.linear.map(c => fmt(c)).join(', ')}`;
  $('m-lum').textContent = `text L = ${fmt(m.fg.L)}; background L = ${fmt(m.bg.L)}`;
  $('m-ratio').textContent = `(${fmt(m.lighter)} + 0.05) / (${fmt(m.darker)} + 0.05) = ${m.ratio.toFixed(2)} : 1`;
  const list = $('m-verdicts');
  list.replaceChildren(...m.verdicts.map(v => {
    const li = el('li', v.pass ? 'pass' : 'fail');
    li.append(el('span', 'verdict', v.pass ? 'pass' : 'fail'), el('span', null, `${v.sc} ${v.level}, ${v.text.toLowerCase()}: needs ${v.min}:1`));
    return li;
  }));
  const better = m.verdicts[0].pass ? null : suggestForeground(fg, bg);
  $('m-suggest').textContent = m.verdicts[0].pass ? 'This pair clears the body text minimum.'
    : better ? `Closest text color in the same hue that reaches 4.5:1: ${better}.` : 'No shade of this hue reaches 4.5:1 on this background.';
}

function renderReadingMath() {
  const steps = $('m-fk');
  const m = fleschKincaidMath(state.report?.stats);
  steps.replaceChildren();
  if (!m) {
    steps.append(el('li', 'idle', "Run checks to plug in this document's counts."));
    $('m-fk-verdict').textContent = '';
    return;
  }
  const rows = [
    ['Counts', `${m.words} words, ${m.sentences} sentences, ${m.syllables} syllables`],
    ['Words per sentence', `${m.words} / ${m.sentences} = ${m.wps.toFixed(2)}, times 0.39 = ${m.terms[0].toFixed(2)}`],
    ['Syllables per word', `${m.syllables} / ${m.words} = ${m.spw.toFixed(3)}, times 11.8 = ${m.terms[1].toFixed(2)}`],
    ['Grade', `${m.terms[0].toFixed(2)} + ${m.terms[1].toFixed(2)} - 15.59 = ${m.grade.toFixed(1)}`]
  ];
  for (const [k, v] of rows) {
    const li = document.createElement('li');
    li.append(el('span', 'step-k', k), el('code', null, v));
    steps.append(li);
  }
  $('m-fk-verdict').textContent = `3.1.5 Reading Level (AAA) uses the lower secondary level, grade ${m.max} here: ${m.pass ? 'this document is at or below it.' : 'this document is above it, so readers may need a simpler version.'}`;
}

function renderTargetMath() {
  const size = Number($('t-size').value), gap = Number($('t-gap').value);
  $('t-size-out').textContent = `${size} px`;
  $('t-gap-out').textContent = `${gap} px`;
  const row = $('t-row');
  row.style.gap = `${gap}px`;
  for (const span of row.children) { span.style.width = `${size}px`; span.style.height = `${size}px`; }
  const t = targetSize(size, gap);
  row.classList.toggle('fail', !t.pass);
  $('t-verdict').textContent = `2.5.8 Target Size (Minimum) (AA), new in WCAG 2.2: ${t.pass ? 'pass' : 'fail'}. `
    + (t.rule === 'size' ? 'Each target is at least 24 by 24 CSS pixels.'
      : `Targets are under 24 px, so centers must sit at least 24 px apart: ${size} + ${gap} = ${t.pitch} px.`);
}

function renderSpacingMath() {
  $('m-spacing').replaceChildren(...spacingMath(16).map(r => {
    const tr = document.createElement('tr');
    tr.append(el('th', null, r.label), el('td', null, `${r.factor} × font size`), el('td', null, `${r.px.toFixed(2)} px`));
    tr.firstChild.scope = 'row';
    return tr;
  }));
}

function openLearn() {
  renderContrastMath();
  renderReadingMath();
  renderTargetMath();
  renderSpacingMath();
  learnEl.showModal();
}
$('learn-open').addEventListener('click', openLearn);
$('learn-open-2').addEventListener('click', openLearn);
$('learn-close').addEventListener('click', () => learnEl.close());
learnEl.addEventListener('click', event => { if (event.target === learnEl) learnEl.close(); });
for (const id of ['learn-fg', 'learn-bg']) $(id).addEventListener('input', renderContrastMath);
for (const id of ['t-size', 't-gap']) $(id).addEventListener('input', renderTargetMath);

runEl.addEventListener('click', run);
repairEl.addEventListener('click', repair);
sourceEl.addEventListener('input', () => { updateCount(); clearExample(); clearLensHash(); invalidate(); });
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
profileEl.addEventListener('change', event => {
  if (event.target.name === 'profile') applyProfile(event.target.value);
});
verifyEl.addEventListener('click', () => {
  verifyResultEl.hidden = false;
  const text = verifyTextEl.value.trim();
  if (!text) {
    verifyResultEl.classList.add('err');
    verifyResultEl.textContent = 'Paste the certificate text first.';
    return;
  }
  const result = verifyCertificate(text);
  verifyResultEl.classList.toggle('err', !result.ok);
  verifyResultEl.textContent = result.ok
    ? `Certificate intact. SHA-256 ${result.fingerprint.slice(0, 24)}...`
    : result.reason === 'fingerprint mismatch'
      ? `Tamper detected: stored fingerprint ${result.actual.slice(0, 24)}... does not match recomputed ${result.expected.slice(0, 24)}...`
      : result.reason;
});
selftestsRunEl.addEventListener('click', () => {
  selftestsListEl.replaceChildren();
  selftestsStatusEl.hidden = false;
  selftestsStatusEl.classList.remove('err');
  selftestsStatusEl.textContent = 'Running self-tests...';
  setTimeout(() => {
    const results = runSelfTests();
    for (const result of results) {
      const li = el('li', result.pass ? 'pass' : 'fail');
      li.append(el('span', 'verdict', result.pass ? 'pass' : 'fail'), el('span', null, result.name));
      if (result.detail) li.append(el('span', 'detail', result.detail));
      selftestsListEl.append(li);
    }
    const failed = results.filter(result => !result.pass).length;
    selftestsStatusEl.classList.toggle('err', failed > 0);
    selftestsStatusEl.textContent = `${results.length - failed} of ${results.length} self-tests passed${failed ? `; ${failed} failed` : ''}.`;
  }, 30);
});
window.addEventListener('hashchange', () => {
  const index = presetIndexFromHash();
  if (index < 0) return;
  const input = examplesEl.querySelector(`input[value="${presets[index].id}"]`);
  if (input) input.checked = true;
  selectPreset(index, { updateHash: false });
});

document.addEventListener('keydown', event => {
  const action = shortcutAction(event, keysEl.checked);
  if (!action) return;
  event.preventDefault();
  if (action === 'analyze') run();
  else if (action === 'editor') sourceEl.focus();
});

buildModePicker();
buildExamplePicker();
const hashed = presetIndexFromHash();
if (hashed >= 0) {
  const input = examplesEl.querySelector(`input[value="${presets[hashed].id}"]`);
  if (input) input.checked = true;
  selectPreset(hashed, { updateHash: false });
} else if (presets[0]) {
  selectPreset(0, { updateHash: false });
}
buildHandoffControls();
updateCount();
renderIdleAnalysis();
renderIdleComparison();
renderIdleDeck();
setExports({ analyzed: false, repaired: false });
renderHandoff();
run();
