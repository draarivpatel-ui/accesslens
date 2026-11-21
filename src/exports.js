import { escapeHTML, paperDocument } from './remediate.js';

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
