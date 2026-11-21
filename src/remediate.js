import { auditHTML, capsDiagnostic } from './a11y.js';
import { analyzeText, detectTerms, sentences, splitLongSentence } from './nlp.js';
import { makeCards, sourceSpan } from './study.js';
import { extractHTML, tokenizeHTML } from './tokenize.js';

export const MAX_SOURCE = 60000;
export const PAPER_CSS = `html{color:#14232b;background:#fffdf4;font:18px Verdana,sans-serif}
body{margin:0}main{max-width:64ch;margin:0 auto;padding:2rem 1.25rem;line-height:1.75;overflow-wrap:anywhere}
h1,h2,h3,h4,h5,h6{font-family:Georgia,serif;line-height:1.25;margin-block:1.4em .45em}
p,li{letter-spacing:.025em;margin-block:.7em}ul{padding-inline-start:1.5em}
@media print{html{background:#fff;color:#000;font-size:10.5pt}main{padding:0;max-width:none;line-height:1.45}
h1{margin-top:0}h2{break-after:avoid}li{break-inside:avoid}}`;
const ACTION = /^(?:(?:please|then)\s+)?(?:apply|ask|bring|check|complete|compare|fill|find|keep|label|list|mark|measure|note|open|place|put|read|record|remove|report|return|save|send|sign|submit|take|tell|turn|upload|use|visit|wait|write|do not)\b/i;
const SIMPLE = new Set(['ascertain', 'commence', 'concatenate', 'contemporaneously', 'disseminate', 'facilitate', 'matriculation',
  'methodology', 'mitigation', 'prerequisite', 'subsequently', 'utilization', 'utilize']);
const OMITTED = /^(?:a|audio|button|canvas|embed|form|iframe|img|input|math|object|select|svg|table|textarea|video)$/;

export const escapeHTML = value => String(value).replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[ch]);

export function paperDocument(title, lang, body) {
  return `<!doctype html>\n<html lang="${escapeHTML(lang)}">\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeHTML(title)}</title><style>${PAPER_CSS}</style></head>\n<body><main>\n${body}</main></body>\n</html>\n`;
}

function plainBlocks(text) {
  return Array.from(text.matchAll(/[^\r\n]+/g), m => {
    const trimmed = m[0].trim();
    const used = trimmed.match(/^(#{1,6})\s+(.+)|^[-*]\s+(.+)$/);
    const start = m.index + m[0].length - m[0].trimStart().length;
    if (!used) return { kind: 'paragraph', text: trimmed, start, end: start + trimmed.length };
    const content = used[2] ?? used[3];
    return {kind: used[1] ? 'heading' : 'bullet', ...(used[1] ? {level: used[1].length} : {}),
      text: content, start: start + trimmed.indexOf(content), end: start + trimmed.length};
  }).filter(b => b.text);
}

export function inspectDocument(source, mode = 'text') {
  if (typeof source !== 'string') throw new TypeError('Paste text or HTML to run checks.');
  if (!['text', 'html'].includes(mode)) throw new RangeError('Choose text or HTML mode.');
  if (source.length > MAX_SOURCE) throw new RangeError(`Use at most ${MAX_SOURCE.toLocaleString('en-US')} characters at a time.`);
  return inspect(source, mode);
}

function inspect(source, mode) {
  const parsed = mode === 'html' ? tokenizeHTML(source) : null;
  const map = parsed ? extractHTML(parsed) : null;
  const text = map?.text ?? source;
  const blocks = map?.blocks ?? plainBlocks(text);
  const issues = parsed ? auditHTML(source, parsed) : blocks.map(b => capsDiagnostic(b.text, b.start, b.end)).filter(Boolean);
  const stats = analyzeText(text);
  for (const group of ['ranked', 'terms', 'long', 'passive']) {
    stats[group] = stats[group].map(item => ({...item, ...sourceSpan(map, item.start, item.end)}));
  }
  return { source, mode, text, stats, issues, cards: makeCards(stats.ranked, stats.terms, map), map, blocks, parsed };
}

function simplify(text, expanded, notes) {
  if (capsDiagnostic(text)) {
    const known = new Set(detectTerms(text).filter(t => t.kind === 'acronym' && t.explanation).map(t => t.text));
    text = text.replace(/[\p{Lu}]+/gu, token => known.has(token) ? token : token.toLowerCase());
    text = text.replace(/^\p{Ll}|([.!?]\s+)\p{Ll}/gu, m => m.toUpperCase());
    notes.add('Capitalization was reduced in long uppercase blocks. Verify names and abbreviations.');
  }
  const replacements = detectTerms(text).flatMap(term => {
    if (!term.explanation) return [];
    const isSimple = term.kind === 'jargon' && SIMPLE.has(term.text.toLowerCase());
    if (!isSimple && expanded.has(term.text)) return [];
    if (!isSimple && term.kind !== 'acronym') return [];
    if (!isSimple && (text.slice(term.end).trimStart().startsWith('(') || text.slice(0, term.start).trimEnd().endsWith('('))) return [];
    expanded.add(term.text);
    const value = isSimple
      ? (/^[A-Z]/.test(term.text) ? term.explanation[0].toUpperCase() + term.explanation.slice(1) : term.explanation)
      : `${term.text} (${term.explanation})`;
    return [{...term, value}];
  });
  for (const term of replacements.reverse()) text = text.slice(0, term.start) + term.value + text.slice(term.end);
  const lines = sentences(text);
  for (const line of lines.reverse()) {
    const split = splitLongSentence(line.text);
    if (split) text = text.slice(0, line.start) + split.join(' ') + text.slice(line.end);
  }
  return text;
}

export function renderBlocks(blocks) {
  let inList = false;
  let html = '';
  for (const block of blocks) {
    if (block.kind === 'bullet' && !inList) { html += '<ul>\n'; inList = true; }
    if (block.kind !== 'bullet' && inList) { html += '</ul>\n'; inList = false; }
    const tag = block.kind === 'heading' ? `h${Math.max(1, Math.min(6, Number(block.level) || 2))}` : block.kind === 'bullet' ? 'li' : 'p';
    html += `<${tag}>${escapeHTML(block.text)}</${tag}>\n`;
  }
  return inList ? html + '</ul>\n' : html;
}

export function buildReadingCopy(original) {
  const notes = new Set();
  const expanded = new Set();
  const actions = [];
  let previous = 1;
  let first = true;
  const declared = original.parsed?.elements.find(node => node.tag === 'html')?.attrs.lang?.trim();
  let lang = 'en';
  if (declared) {
    try {
      const locale = new Intl.Locale(declared);
      if (locale.language !== 'und') lang = locale.toString();
    } catch { /* Fall back to the studio's default. */ }
  }
  if (!declared || lang === 'en' && declared.toLowerCase() !== 'en') notes.add('Verify the output language tag before publishing.');
  if (original.parsed?.limited) notes.add('Deeply nested HTML was cut off. Inspect the original before using this copy.');
  if (original.parsed?.elements.some(node => OMITTED.test(node.tag))) {
    notes.add('This is a reading copy, not a replacement web page. Link destinations, controls, tables and media need human review; only available text is carried forward.');
  }
  const english = /^en(?:-|$)/i.test(lang);
  if (!english) notes.add('English plain-language substitutions were skipped for this language.');
  const blocks = original.blocks.map(block => {
    const text = english ? simplify(block.text, expanded, notes) : block.text;
    if (english && block.kind !== 'heading') {
      for (const clause of sentences(text)) {
        if (actions.length < 5 && (block.kind === 'bullet' || ACTION.test(clause.text)) &&
          !actions.includes(clause.text)) actions.push(clause.text);
      }
    }
    let result = {kind: block.kind, text};
    if (block.kind === 'heading') {
      const level = first ? 1 : Math.min(Math.max(2, block.level), previous + 1);
      previous = level;
      result = {...result, level};
    }
    first = false;
    return result;
  });
  if (blocks[0]?.kind !== 'heading') blocks.unshift({kind: 'heading', text: 'Reading copy', level: 1});
  const title = blocks[0].text;
  const html = paperDocument(title, lang, renderBlocks(blocks));
  const report = inspect(html, 'html');
  if (original.stats.truncated) notes.add('Key-point ranking covers the first 400 sentences. Readability checks cover the full accepted source.');
  return { html, blocks, actions, notes: [...notes], report };
}
