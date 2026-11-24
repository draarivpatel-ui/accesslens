// Community fix handoff: turns a report into plain-language Fix Cards that a
// volunteer can hand to a nonprofit, school or club webmaster, and builds the
// barrier simulations shown beside the source. Pure functions, no DOM.
import { RULES, accessibleName, capsDiagnostic, nameContext } from './a11y.js';
import { decodeEntities } from './tokenize.js';
import { common } from './glossary.js';
import { COGNITIVE_LOAD_WORDS, sentences, syllables, words } from './nlp.js';
import { READING_LEVEL_MAX_GRADE } from './wcag-audit.js';

export const WHO = Object.freeze({
  sr: 'Screen reader users',
  vision: 'People with low vision',
  motor: 'Keyboard and switch users',
  cognitive: 'Readers with dyslexia, ADHD or memory loss',
  language: 'People reading in a second language'
});

export const EFFORT = Object.freeze({ quick: 'Quick fix', hour: 'Under an hour', team: 'Needs the site owner' });

// Every audit rule id plus the text-only findings. Each entry is written for a
// person who edits the page, not for an accessibility specialist.
export const FIXES = Object.freeze({
  language: { title: 'Tell browsers which language the page is in', who: ['sr', 'language'], effort: 'quick',
    sc: '3.1.1 Language of Page (A)',
    why: 'Without a language tag, a screen reader may read the page with the wrong voice and pronunciation, and translation tools guess.',
    steps: ['Add lang="en" (or the right language code) to the opening html tag.'] },
  'page-title': { title: 'Give the page a title', who: ['sr', 'cognitive'], effort: 'quick',
    sc: '2.4.2 Page Titled (A)',
    why: 'The title is the first thing a screen reader announces and the label on the browser tab.',
    steps: ['Add a short title inside the head, such as <title>Build night | Design Club</title>.'] },
  'heading-order': { title: 'Put headings in order', who: ['sr', 'cognitive'], effort: 'quick',
    sc: '1.3.1 Info and Relationships (A)',
    why: 'Screen reader users jump between headings like a table of contents. A skipped level looks like a missing section.',
    steps: ['Use one h1 for the page title.', 'Step down one level at a time: h2 for sections, h3 inside them.', 'Change heading size with CSS, not by picking a different heading level.'] },
  'empty-heading': { title: 'Remove or fill empty headings', who: ['sr'], effort: 'quick',
    sc: '2.4.6 Headings and Labels (AA)',
    why: 'An empty heading is announced as a heading with nothing in it, which sounds like a broken page.',
    steps: ['Delete the empty heading tag, or type the section name inside it.'] },
  'image-alt': { title: 'Describe images with alt text', who: ['sr', 'vision'], effort: 'quick',
    sc: '1.1.1 Non-text Content (A)',
    why: 'Without alt text a screen reader may read the file name aloud, or skip the picture entirely.',
    steps: ['Add alt="..." that says what the image shows or does, in one short sentence.', 'If the image is only decoration, use alt="" so it is skipped.'] },
  'link-purpose': { title: 'Say where links go', who: ['sr', 'motor', 'cognitive'], effort: 'quick',
    sc: '2.4.4 Link Purpose (In Context) (A)',
    why: 'Screen reader and voice control users often pull up a list of links. Ten links that all say "Click here" are impossible to tell apart.',
    steps: ['Rewrite the link text to name the destination, for example "Sign up for build night".'] },
  'input-label': { title: 'Label every form field', who: ['sr', 'motor', 'cognitive'], effort: 'quick',
    sc: '4.1.2 Name, Role, Value (A)',
    why: 'Placeholder text disappears as soon as someone types and is not announced reliably, so the field has no lasting name.',
    steps: ['Add a visible <label for="field-id"> next to the field.', 'Keep the placeholder only as an example, never as the label.'] },
  'button-name': { title: 'Name every button', who: ['sr', 'motor'], effort: 'quick',
    sc: '4.1.2 Name, Role, Value (A)',
    why: 'An empty button is announced as just "button". Voice control users cannot say its name to press it.',
    steps: ['Put the action in the button text, such as "Send RSVP".', 'For an icon-only button, add aria-label with the action.'] },
  'frame-title': { title: 'Title embedded maps and frames', who: ['sr'], effort: 'quick',
    sc: '4.1.2 Name, Role, Value (A)',
    why: 'An untitled frame is announced as "frame" with no hint of what is inside.',
    steps: ['Add title="Map to the meeting room" (or what it shows) to the iframe tag.'] },
  contrast: { title: 'Darken low-contrast text', who: ['vision'], effort: 'quick',
    sc: '1.4.3 Contrast (Minimum) (AA)',
    why: 'Light gray text on white fades out on phones in sunlight and for anyone with low vision.',
    steps: ['Use text and background colors with a contrast ratio of at least 4.5 to 1.', 'Check the pair in the WCAG math drawer before publishing.'] },
  'caps-block': { title: 'Write in sentence case, not all caps', who: ['cognitive', 'sr'], effort: 'quick',
    sc: 'Reading heuristic (not a WCAG requirement)',
    why: 'Long all-caps text is slower to read because word shapes disappear, and some screen readers spell out all-caps words.',
    steps: ['Retype the block in sentence case.', 'Use bold or a heading for emphasis instead of capitals.'] },
  'tiny-text': { title: 'Make tiny text bigger', who: ['vision', 'cognitive'], effort: 'quick',
    sc: 'Reading heuristic, related to 1.4.4 Resize Text (AA)',
    why: 'Text under 12 pixels is hard to read on a phone and forces zooming.',
    steps: ['Set body text to at least 16 pixels.', 'Use relative units such as rem so the text grows with browser zoom.'] },
  'long-sentence': { title: 'Break up long sentences', who: ['cognitive', 'language'], effort: 'hour',
    sc: '3.1.5 Reading Level (AAA)',
    why: `Sentences over ${COGNITIVE_LOAD_WORDS} words make readers hold too much in memory before the point arrives.`,
    steps: ['Split each long sentence at a semicolon, "and" or "then".', 'Put the action first: "Seal each bag. Then write its mass in the table."'] },
  'reading-level': { title: 'Aim for a grade 9 reading level', who: ['cognitive', 'language'], effort: 'hour',
    sc: '3.1.5 Reading Level (AAA)',
    why: `The estimated grade is above ${READING_LEVEL_MAX_GRADE}, the lower secondary level WCAG uses as its reading benchmark.`,
    steps: ['Swap long words for common ones ("start" for "commence").', 'Use Build reading copy in AccessLens as a first draft, then check names and numbers by hand.'] },
  jargon: { title: 'Explain acronyms and jargon on first use', who: ['language', 'cognitive'], effort: 'quick',
    sc: '3.1.4 Abbreviations (AAA)',
    why: 'Readers outside the field, families and new members do not know the short forms insiders use.',
    steps: ['Spell out each acronym the first time: "Free Application for Federal Student Aid (FAFSA)".', 'Replace jargon with the everyday word when one exists.'] },
  passive: { title: 'Say who does what', who: ['cognitive', 'language'], effort: 'hour',
    sc: 'Plain language guideline (not a WCAG requirement)',
    why: 'Passive sentences hide who has to act, which is the one thing a reader needs from an instruction.',
    steps: ['Rewrite "A transcript was requested" as "Bring your transcript".'] }
});

export const AUDIENCES = Object.freeze({
  nonprofit: { label: 'Local nonprofit', greeting: 'Hi team,', serves: 'the neighbors you serve' },
  school: { label: 'School', greeting: 'Hello,', serves: 'students and families' },
  club: { label: 'Student club', greeting: 'Hey team,', serves: 'every member' }
});
export const FORMATS = Object.freeze({ github: 'GitHub issue', email: 'Email', checklist: 'Checklist' });

const lineOf = (source, offset) => source.slice(0, Math.max(0, offset)).split('\n').length;

export function documentTitle(report) {
  const title = report.parsed?.elements.find(n => n.tag === 'title')?.label.trim();
  const heading = report.blocks?.find(b => b.kind === 'heading')?.text.trim();
  const first = report.text?.trim().split('\n')[0]?.trim();
  return (title || heading || first || 'this page').replace(/\s+/g, ' ').slice(0, 80);
}

export function buildFixCards(report) {
  if (!report) return [];
  const groups = new Map();
  const add = (id, start = null) => {
    if (!FIXES[id]) return;
    const entry = groups.get(id) ?? { id, count: 0, lines: [], starts: [] };
    entry.count += 1;
    if (start !== null && entry.starts.length < 6) entry.starts.push(start);
    if (start !== null) {
      const line = lineOf(report.source, start);
      if (!entry.lines.includes(line) && entry.lines.length < 6) entry.lines.push(line);
    }
    groups.set(id, entry);
  };
  for (const issue of report.issues ?? []) {
    if (RULES[issue.id]) add(issue.id, issue.start);
  }
  const stats = report.stats ?? {};
  const srcStart = item => item.sourceStart ?? item.start ?? null;
  for (const item of stats.long ?? []) add('long-sentence', srcStart(item));
  if (typeof stats.fk === 'number' && stats.fk > READING_LEVEL_MAX_GRADE) add('reading-level');
  const text = report.text ?? '';
  const capsBlocks = (report.blocks ?? []).filter(b => capsDiagnostic(b.text));
  const inCaps = t => capsBlocks.some(b => t.start >= b.start && t.start < b.end);
  const unexplained = (stats.terms ?? []).filter(t => !inCaps(t) && (t.kind === 'jargon'
    || !(text.slice(t.end).trimStart().startsWith('(') || text.slice(0, t.start).trimEnd().endsWith('('))));
  const seen = new Map();
  for (const term of unexplained) {
    if (seen.has(term.text.toLowerCase())) continue;
    seen.set(term.text.toLowerCase(), term.text);
    add('jargon', srcStart(term));
  }
  if ((stats.passive ?? []).length >= 2) for (const p of stats.passive) add('passive', srcStart(p));
  const order = Object.keys(FIXES);
  const weight = { wcag: 0, signal: 1, ergonomic: 2 };
  return [...groups.values()].map(g => {
    const fix = FIXES[g.id];
    const kind = RULES[g.id]?.[2] ?? 'language';
    const level = /\((A|AA|AAA)\)/.exec(fix.sc)?.[1] ?? null;
    const priority = level === 'A' ? 'high' : level === 'AA' ? 'medium' : 'low';
    return { ...g, ...fix, who: fix.who.map(k => WHO[k]), effortLabel: EFFORT[fix.effort], level, priority, kind,
      terms: g.id === 'jargon' ? [...seen.values()].slice(0, 8) : [] };
  }).sort((a, b) => ['high', 'medium', 'low'].indexOf(a.priority) - ['high', 'medium', 'low'].indexOf(b.priority)
    || (weight[a.kind] ?? 3) - (weight[b.kind] ?? 3) || order.indexOf(a.id) - order.indexOf(b.id));
}

export function packSummary(cards) {
  const by = p => cards.filter(c => c.priority === p).length;
  return { total: cards.length, high: by('high'), medium: by('medium'), low: by('low'),
    quick: cards.filter(c => c.effort === 'quick').length,
    people: [...new Set(cards.flatMap(c => c.who))] };
}

const where = card => card.lines.length
  ? `line${card.lines.length > 1 ? 's' : ''} ${card.lines.join(', ')}${card.count > card.lines.length ? ' and more' : ''}`
  : 'whole document';
const termsNote = card => card.terms.length ? ` Terms: ${card.terms.join(', ')}.` : '';

export function formatPack(cards, { format = 'github', audience = 'nonprofit', title = 'this page' } = {}) {
  const aud = AUDIENCES[audience] ?? AUDIENCES.nonprofit;
  const name = String(title).replace(/[\r\n]+/g, ' ').slice(0, 80);
  if (!cards.length) {
    return format === 'checklist' ? `Accessibility checklist for ${name}\n\nNo findings from this check. Test with a keyboard and a screen reader before publishing.\n`
      : `No accessibility findings for ${name} from this check. A keyboard and screen reader test is still worth doing.\n`;
  }
  const s = packSummary(cards);
  if (format === 'email') {
    const lines = [
      `Subject: ${s.total} small accessibility fixes for ${name}`,
      '',
      aud.greeting,
      '',
      `I ran ${name} through AccessLens, a free accessibility checker, so the page works for ${aud.serves}. It found ${s.total} ${s.total === 1 ? 'thing' : 'things'} to fix${s.quick ? `, and ${s.quick === 1 ? 'one takes' : `${s.quick} of them take`} only a few minutes` : ''}:`,
      ''
    ];
    cards.forEach((c, i) => {
      lines.push(`${i + 1}. ${c.title} (${where(c)})`);
      lines.push(`   Why: ${c.why}${termsNote(c)}`);
      lines.push(`   Fix: ${c.steps.join(' ')}`);
      lines.push('');
    });
    lines.push(`These follow WCAG 2.2, the web accessibility standard. I would be glad to help make the changes or check them afterward.`, '', 'Thank you,');
    return `${lines.join('\n')}\n`;
  }
  if (format === 'checklist') {
    const lines = [`Accessibility checklist for ${name}`, ''];
    for (const effort of Object.keys(EFFORT)) {
      const group = cards.filter(c => c.effort === effort);
      if (!group.length) continue;
      lines.push(`${EFFORT[effort]}`);
      for (const c of group) {
        lines.push(`[ ] ${c.title} (${where(c)})`);
        for (const step of c.steps) lines.push(`    [ ] ${step}`);
      }
      lines.push('');
    }
    lines.push('Check again with AccessLens after the changes.');
    return `${lines.join('\n')}\n`;
  }
  const lines = [
    `## Accessibility fixes for ${name}`,
    '',
    `${s.total} findings from an AccessLens check: ${s.high} high, ${s.medium} medium and ${s.low} low priority. Priority follows the WCAG 2.2 level (A, then AA, then AAA and reading heuristics). These are automated signals; a person should confirm each one.`,
    ''
  ];
  cards.forEach((c, i) => {
    lines.push(`### ${i + 1}. ${c.title}`);
    lines.push('');
    lines.push(`- **Standard:** ${c.sc}`);
    lines.push(`- **Who it blocks:** ${c.who.join(', ')}`);
    lines.push(`- **Where:** ${where(c)}`);
    lines.push(`- **Effort:** ${c.effortLabel}`);
    lines.push('');
    lines.push(`${c.why}${termsNote(c)}`);
    lines.push('');
    for (const step of c.steps) lines.push(`- [ ] ${step}`);
    lines.push('');
  });
  return `${lines.join('\n')}`;
}

// Barrier simulations.

const DISABLABLE = new Set(['button', 'input', 'select', 'textarea', 'fieldset']);
function isDisabled(node, elements) {
  if (!DISABLABLE.has(node.tag)) return false;
  if (Object.hasOwn(node.attrs, 'disabled')) return true;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.tag !== 'fieldset' || !Object.hasOwn(parent.attrs, 'disabled')) continue;
    const firstLegend = elements.find(element => element.tag === 'legend' && element.parent === parent);
    let inLegend = false;
    for (let ancestor = node.parent; ancestor && ancestor !== parent; ancestor = ancestor.parent) {
      if (ancestor === firstLegend) { inLegend = true; break; }
    }
    if (!inLegend) return true;
  }
  return false;
}

const REPLACED = new Set(['iframe', 'select', 'textarea', 'object', 'embed']);
const visible = node => !node.aria && !node.excluded && (!node.hidden || REPLACED.has(node.tag));
const FOCUSABLE = (node, elements) => {
  const a = node.attrs;
  if (!visible(node) || isDisabled(node, elements)) return false;
  if (a.tabindex !== undefined && Number(a.tabindex) < 0) return false;
  if (node.tag === 'a' || node.tag === 'area') return Object.hasOwn(a, 'href');
  if (node.tag === 'input') return (a.type ?? '').toLowerCase() !== 'hidden';
  return ['button', 'select', 'textarea', 'iframe'].includes(node.tag) || (a.tabindex !== undefined && Number(a.tabindex) >= 0);
};
const ROLE = { a: 'Link', area: 'Link', button: 'Button', select: 'List box', textarea: 'Edit text', iframe: 'Frame' };
const issueAt = (report, node) => (report.issues ?? []).find(i => i.start === node.start && i.end === node.end)
  ?? (report.issues ?? []).find(i => i.start === node.start);

export function keyboardPath(report) {
  if (!report?.parsed) return [];
  const names = nameContext(report.parsed);
  const priority = node => Number(node.attrs.tabindex) > 0 ? Number(node.attrs.tabindex) : Infinity;
  return report.parsed.elements.filter(node => FOCUSABLE(node, report.parsed.elements))
    .sort((a, b) => priority(a) === priority(b) ? a.start - b.start : priority(a) - priority(b)).map((node, i) => {
    const role = node.tag === 'input' ? (['button', 'submit', 'reset', 'image'].includes((node.attrs.type ?? '').toLowerCase()) ? 'Button' : 'Edit text') : ROLE[node.tag] ?? 'Control';
    const issue = issueAt(report, node);
    const name = accessibleName(node, names);
    return { stop: i + 1, role, name, problem: issue ? issue.label : null, start: node.start };
  });
}

export function screenReaderScript(report) {
  if (!report) return [];
  const out = [];
  const say = (text, problem = null) => out.push({ text, problem });
  if (report.parsed) {
    const names = nameContext(report.parsed);
    const stops = new Map(keyboardPath(report).map(step => [step.start, step]));
    const root = report.parsed.elements.find(n => n.tag === 'html');
    const title = report.parsed.elements.find(n => n.tag === 'title')?.label.trim();
    say(title ? `Page, "${title}"` : 'Page, untitled', title ? null : RULES['page-title'][0]);
    if (!root?.attrs.lang?.trim()) say('Language unknown, so the voice may guess the pronunciation', RULES.language[0]);
    const ownText = new Map();
    for (const event of report.parsed.events ?? []) {
      if (event.type !== 'text' || !event.node || event.hidden || event.aria) continue;
      for (let n = event.node; n; n = n.parent) if (n.tag === 'p' || n.tag === 'li') ownText.set(n, (ownText.get(n) ?? '') + decodeEntities(event.value));
    }
    for (const node of report.parsed.elements) {
      if (!visible(node)) continue;
      const issue = issueAt(report, node);
      const name = accessibleName(node, names);
      if (/^h[1-6]$/.test(node.tag)) say(name ? `Heading level ${node.tag[1]}, "${name}"` : `Heading level ${node.tag[1]}, empty`, issue?.label ?? null);
      else if (node.tag === 'img') {
        if (node.attrs.alt === '') continue;
        const file = (node.attrs.src ?? '').split('/').pop();
        say(name ? `Image, "${name}"` : `Image${file ? `, "${file}"` : ', unlabeled'}`, issue?.label ?? null);
      } else if (stops.has(node.start)) {
        const step = stops.get(node.start);
        say(step.name ? `${step.role}, "${step.name}"` : `${step.role}, unlabeled`, issue?.label ?? (step.name ? null : 'No accessible name'));
      } else if (['p', 'li'].includes(node.tag) && (ownText.get(node) ?? '').trim()) {
        const text = ownText.get(node).replace(/\s+/g, ' ').trim();
        const caps = issue?.id === 'caps-block';
        say(`${node.tag === 'li' ? 'Bullet, ' : ''}${text.length > 90 ? `${text.slice(0, 90)}...` : text}`, caps ? `${RULES['caps-block'][0]}: some voices spell out capitals` : issue?.id === 'contrast' || issue?.id === 'tiny-text' ? null : issue?.label ?? null);
      }
    }
    return out;
  }
  for (const block of report.blocks ?? []) {
    const text = block.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const short = text.length > 90 ? `${text.slice(0, 90)}...` : text;
    const caps = (report.issues ?? []).find(i => i.id === 'caps-block' && i.start >= block.start && i.start < block.end);
    if (block.kind === 'heading') say(`Heading, "${short}"`);
    else say(`${block.kind === 'bullet' ? 'Bullet, ' : ''}${short}`, caps ? `${caps.label}: some voices spell out capitals` : null);
  }
  return out;
}

// Cognitive load view: words past the sentence limit fade out, long words (three or
// more syllables) outside the common vocabulary are marked hard.
export function cognitiveView(blocks) {
  return (blocks ?? []).map(block => {
    const tokens = [];
    let cursor = 0;
    let hard = 0;
    let faded = 0;
    for (const sentence of sentences(block.text)) {
      const ws = words(sentence.text);
      ws.forEach((w, i) => {
        const start = sentence.start + w.start;
        if (start > cursor) tokens.push({ text: block.text.slice(cursor, start), cls: '' });
        const lower = w.text.toLowerCase();
        const isHard = /[a-z]/i.test(w.text) && !common.has(lower) && syllables(w.text) >= 3;
        const fade = i >= COGNITIVE_LOAD_WORDS;
        if (isHard) hard++;
        if (fade) faded++;
        tokens.push({ text: w.text, cls: [isHard ? 'hard' : '', fade ? 'fade' : ''].filter(Boolean).join(' ') });
        cursor = start + w.text.length;
      });
    }
    if (cursor < block.text.length) tokens.push({ text: block.text.slice(cursor), cls: '' });
    return { kind: block.kind, tokens, hard, faded };
  });
}

export const BARRIERS = Object.freeze([
  { id: 'lowvision', label: 'Low vision' },
  { id: 'screenreader', label: 'Screen reader' },
  { id: 'keyboard', label: 'Keyboard and switch' },
  { id: 'cognitive', label: 'Cognitive load' }
]);
