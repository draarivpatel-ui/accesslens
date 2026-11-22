import { escapeHTML, paperDocument } from './remediate.js';
import { sha256hex } from './sha256.js';
import { COPY_THEME, compareReports } from './wcag-audit.js';

function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (typeof value !== 'number' && /^[\s\u0000-\u001f\u007f-\u009f\p{Cf}]*(?:[=+\-\u2212@\uff1d\uff0b\uff0d\uff20]|[\t\r\n])/u.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function csv(rows) {
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function auditCSV(before, after) {
  const rows = [['Version', 'Check', 'Category', 'Reference', 'Start (inclusive)', 'End (exclusive)', 'Detail']];
  for (const [stage, report] of [['Before', before], ['After', after]]) {
    if (!report) continue;
    rows.push([stage, 'Readability', 'estimate', 'FK grade', '', '', report.stats.fk]);
    rows.push([stage, 'Issue count', 'limited audit', '', '', '', report.issues.length]);
    for (const issue of report.issues) rows.push([stage, issue.id, issue.kind, issue.criterion, issue.start, issue.end, issue.detail]);
  }
  return csv(rows);
}

const field = value => {
  const text = String(value).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ');
  return text.startsWith('#') ? ' ' + text : text;
};

export function ankiTSV(cards) {
  return ['#separator:Tab', '#html:false', '#columns:Front\tBack',
    ...cards.map(card => `${field(card.front)}\t${field(card.back)} | Source [${field(card.sourceStart)}, ${field(card.sourceEnd)})`)].join('\n') + '\n';
}

export function reviewCSV(cards, ratings) {
  return csv([['Front', 'Back', 'Source start', 'Source end', 'Repetitions', 'Interval (days)', 'Ease', 'Due (UTC)'],
    ...cards.map((card, index) => {
      const s = ratings?.[index] ?? {repetitions: 0, interval: 0, ease: 2.5, due: ''};
      return [card.front, card.back, card.sourceStart, card.sourceEnd, s.repetitions, s.interval, s.ease, s.due];
    })]);
}

export function canonicalJSON(input) {
  const active = new Set();
  function encode(holder, key) {
    let value = holder[key];
    if (value != null && (typeof value === 'object' || typeof value === 'function' || typeof value === 'bigint') &&
        typeof value.toJSON === 'function') value = value.toJSON(key);
    if (value instanceof Number || value instanceof String || value instanceof Boolean || value instanceof BigInt || value instanceof Symbol) value = value.valueOf();
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (active.has(value)) throw new TypeError('Cannot encode a circular object.');
    active.add(value);
    let encoded;
    if (Array.isArray(value)) {
      const cells = [];
      for (let i = 0, length = value.length; i < length; i++) cells.push(encode(value, String(i)) ?? 'null');
      encoded = '[' + cells.join(',') + ']';
    } else {
      const pairs = [];
      for (const name of Object.keys(value).sort()) {
        const item = encode(value, name);
        if (item !== undefined) pairs.push(JSON.stringify(name) + ':' + item);
      }
      encoded = '{' + pairs.join(',') + '}';
    }
    active.delete(value);
    return encoded;
  }
  return encode({'': input}, '');
}

export async function fingerprint(text) {
  if (!globalThis.crypto?.subtle) throw new Error('Fingerprinting needs a secure context (HTTPS or localhost).');
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
}

function bundleReport(report) {
  return { mode: report.mode, source: report.source, metrics: report.stats, issues: report.issues, cards: report.cards };
}

export async function evaluationBundle(before, after) {
  const payload = { format: 'accesslens-evaluation-v1', spanUnit: 'UTF-16 code units [start,end)',
    before: bundleReport(before), after: after ? bundleReport(after) : null };
  return canonicalJSON({ algorithm: 'SHA-256', fingerprint: await fingerprint(canonicalJSON(payload)), payload }) + '\n';
}

export const readingHTML = copy => copy.html;

// Signed audit certificate. The payload holds every computed metric, badge and
// histogram plus a SHA-256 of each source (never the source text itself). The
// fingerprint is a tamper check on the canonical payload, not a legal signature.
function certSide(report) {
  return {
    mode: report.mode,
    sourceSHA256: sha256hex(report.source),
    issueCount: report.issues.length,
    findings: report.issues.map(issue => ({ id: issue.id, criterion: issue.criterion, start: issue.start, end: issue.end }))
  };
}

const certHistogram = hist => ({
  sentences: hist.sentences,
  overLimit: hist.overLimit,
  bins: hist.bins.map(bin => ({ label: bin.label, count: bin.count, load: bin.load }))
});

export function certificateDoc(before, after = null, issued = new Date().toISOString()) {
  const comparison = compareReports(before, after, COPY_THEME);
  const payload = {
    format: 'accesslens-certificate-v1',
    spanUnit: 'UTF-16 code units [start,end)',
    issued,
    badges: comparison.badges,
    metrics: comparison.rows.map(row => ({ key: row.key, label: row.label, kind: row.kind, before: row.before, after: row.after, delta: row.delta })),
    histograms: { before: certHistogram(comparison.histograms.before), after: comparison.histograms.after ? certHistogram(comparison.histograms.after) : null },
    before: certSide(before),
    after: after ? certSide(after) : null
  };
  return { algorithm: 'SHA-256', fingerprint: sha256hex(canonicalJSON(payload)), payload };
}

export function certificateJSON(before, after = null, issued) {
  return canonicalJSON(certificateDoc(before, after, issued)) + '\n';
}

export function verifyCertificate(text) {
  let doc;
  try { doc = JSON.parse(text); } catch { return { ok: false, reason: 'The pasted text is not JSON.' }; }
  if (!doc || doc.algorithm !== 'SHA-256' || typeof doc.fingerprint !== 'string' || doc.payload === undefined) {
    return { ok: false, reason: 'This is not an AccessLens certificate document.' };
  }
  const expected = sha256hex(canonicalJSON(doc.payload));
  return expected === doc.fingerprint.toLowerCase()
    ? { ok: true, fingerprint: expected }
    : { ok: false, reason: 'fingerprint mismatch', expected, actual: doc.fingerprint };
}

const certNumber = (value, kind) => {
  if (value === null || value === undefined) return 'n/a';
  if (kind === 'share') return `${(value * 100).toFixed(1)}%`;
  if (kind === 'grade' || kind === 'num') return value.toFixed(2);
  if (kind === 'time') return `${value} s`;
  return String(Math.round(value));
};

export function certificateCSV(before, after = null, issued = new Date().toISOString()) {
  const doc = certificateDoc(before, after, issued);
  const rows = [
    ['AccessLens audit certificate'],
    ['SHA-256 fingerprint', doc.fingerprint],
    ['Issued', doc.payload.issued],
    [],
    ['Metric', 'Original', 'Reading copy', 'Change'],
    ...doc.payload.metrics.map(row => [row.label, certNumber(row.before, row.kind), certNumber(row.after, row.kind),
      row.delta === null ? 'n/a' : `${row.delta > 0 ? '+' : ''}${row.kind === 'share' ? `${(row.delta * 100).toFixed(1)} pt` : certNumber(row.delta, 'num')}`]),
    [],
    ['Badge', 'Verdict', 'Detail'],
    ...doc.payload.badges.map(badge => {
      const verdict = badge.scope === 'document'
        ? `original ${badge.before === null ? 'n/a' : badge.before ? 'pass' : 'fail'}, copy ${badge.after === null ? 'n/a' : badge.after ? 'pass' : 'fail'}`
        : badge.pass ? 'pass' : 'fail';
      return [badge.label, verdict, badge.detail];
    }),
    [],
    ['Source SHA-256', doc.payload.before.sourceSHA256, doc.payload.after?.sourceSHA256 ?? '-']
  ];
  return csv(rows);
}

const mdCell = value => String(value).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');

export function certificateMarkdown(before, after = null, issued = new Date().toISOString()) {
  const doc = certificateDoc(before, after, issued);
  const lines = [
    '# AccessLens audit certificate',
    '',
    `SHA-256 fingerprint: \`${doc.fingerprint}\``,
    `Issued: ${doc.payload.issued}`,
    '',
    'The fingerprint covers the canonical payload below and is a tamper check, not a legal signature.',
    '',
    '## Metrics',
    '',
    '| Metric | Original | Reading copy | Change |',
    '| --- | --- | --- | --- |',
    ...doc.payload.metrics.map(row =>
      `| ${mdCell(row.label)} | ${certNumber(row.before, row.kind)} | ${certNumber(row.after, row.kind)} | ${row.delta === null ? 'n/a' : `${row.delta > 0 ? '+' : ''}${row.kind === 'share' ? `${(row.delta * 100).toFixed(1)} pt` : certNumber(row.delta, 'num')}`} |`),
    '',
    '## Badges',
    '',
    ...doc.payload.badges.map(badge => {
      const verdict = badge.scope === 'document'
        ? `original ${badge.before === null ? 'n/a' : badge.before ? 'pass' : 'fail'}, copy ${badge.after === null ? 'n/a' : badge.after ? 'pass' : 'fail'}`
        : badge.pass ? 'pass' : 'fail';
      return `- **${verdict}** ${mdCell(badge.label)} (${mdCell(badge.detail)})`;
    }),
    '',
    '## Sentence-length histograms',
    '',
    `- Original: ${doc.payload.histograms.before.bins.map(bin => `${bin.label} words x${bin.count}`).join(', ')}`,
    `- Reading copy: ${doc.payload.histograms.after ? doc.payload.histograms.after.bins.map(bin => `${bin.label} words x${bin.count}`).join(', ') : 'not built'}`,
    '',
    `Source fingerprints: ${doc.payload.before.sourceSHA256.slice(0, 16)}...${doc.payload.after ? ` to ${doc.payload.after.sourceSHA256.slice(0, 16)}...` : ''}`,
    ''
  ];
  return lines.join('\n');
}

function shorten(text, n = 190) {
  if (text.length <= n) return text;
  return text.slice(0, n).replace(/\s+\S*$/, '') + '...';
}

export function studyHTML(copy, report) {
  const list = entries => `<ul>${entries.map(x => `<li>${escapeHTML(shorten(x))}</li>`).join('')}</ul>`;
  const key = report.stats.ranked.slice(0, 3).sort((a, b) => a.start - b.start).map(s => s.text);
  const drills = report.cards.slice(0, 4).map(card => `${card.front} [${card.sourceStart}, ${card.sourceEnd})`);
  const steps = copy?.actions?.slice(0, 3) ?? [];
  const body = '<h1>AccessLens Study Sheet</h1>'
    + (key.length ? '<h2>Key points</h2>' + list(key) : '')
    + (steps.length ? '<h2>Action checklist</h2>' + list(steps) : '')
    + (drills.length ? '<h2>Recall prompts</h2>' + list(drills) : '')
    + '<p>Bracketed offsets refer to the original source. Points may be shortened for print. Check the original for full context.</p>';
  return paperDocument('AccessLens Study Sheet', 'en', body);
}
