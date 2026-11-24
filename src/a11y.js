import { decodeEntities, tokenizeHTML } from './tokenize.js';

export const RULES = Object.freeze({
  language: ['Missing or invalid page language', '3.1.1 A', 'wcag'],
  'page-title': ['Missing page title', '2.4.2 A', 'wcag'],
  'heading-order': ['Skipped heading level', '1.3.1 A (signal)', 'signal'],
  'empty-heading': ['Empty heading', '2.4.6 AA (signal)', 'signal'],
  'image-alt': ['Missing image alternative', '1.1.1 A', 'wcag'],
  'link-purpose': ['Unclear link purpose', '2.4.4 A (signal)', 'signal'],
  'input-label': ['Control has no detectable label', '4.1.2 A (signal)', 'signal'],
  'button-name': ['Button has no detectable name', '4.1.2 A (signal)', 'signal'],
  'frame-title': ['Frame has no detectable title', '4.1.2 A (signal)', 'signal'],
  contrast: ['Low inline text contrast', '1.4.3 AA (signal)', 'signal'],
  'caps-block': ['Long all-caps block', 'Reading heuristic', 'ergonomic'],
  'tiny-text': ['Tiny inline text', 'Reading heuristic', 'ergonomic']
});

export function hexRGB(value) {
  if (!/^#(?:[a-f0-9]{3}|[a-f0-9]{6})$/i.test(value)) return null;
  const hex = value.slice(1);
  const full = hex.length === 3 ? [...hex].map(ch => ch + ch).join('') : hex;
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255);
}

export function luminance(rgb) {
  const [r, g, b] = rgb.map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(foreground, background) {
  const fg = hexRGB(foreground), bg = hexRGB(background);
  if (!fg || !bg) return null;
  const a = luminance(fg), b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function declarations(raw = '') {
  const result = new Map();
  const put = (key, value, important) => { if (!result.get(key)?.important || important) result.set(key, {value, important}); };
  for (const entry of raw.split(';')) {
    const colon = entry.indexOf(':');
    if (colon < 0) continue;
    const key = entry.slice(0, colon).trim().toLowerCase();
    const value = entry.slice(colon + 1).trim().toLowerCase();
    const important = /!\s*important$/.test(value);
    const v = value.replace(/\s*!\s*important$/, '');
    if (key === 'font') {
      const size = v.match(/(?:\d+(?:\.\d+)?|\.\d+)(?:px|pt)\b/)?.[0];
      if (size) put('font-size', size, important);
      put('font-weight', v.match(/\b(?:bold|bolder|lighter|normal|[1-9]00)\b/)?.[0] ?? 'normal', important);
      put('font', v, important);
      continue;
    }
    const keys = key === 'background' ? ['background-color', 'background-image'] : [key];
    for (const prop of keys) {
      const resolved = key === 'background' && prop === 'background-image' && !/(?:url|gradient|image-set|image|element|paint|cross-fade)\s*\(/.test(v) ? 'none' : v;
      put(prop, resolved, important);
    }
  }
  return key => result.get(key)?.value;
}

function sizePx(size) {
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)(?:px|pt)$/.test(size ?? '')) return null;
  const value = parseFloat(size);
  return size.endsWith('pt') ? value * 4 / 3 : value;
}

function hasName(node, ids) {
  if (node.attrs['aria-label']?.trim()) return true;
  return (node.attrs['aria-labelledby'] ?? '').trim().split(/\s+/).some(id => ids.get(id)?.trim());
}

function within(node, tag) {
  for (let parent = node.parent; parent; parent = parent.parent) if (parent.tag === tag) return parent;
  return null;
}

// Shared name context for the audit and the handoff simulations. Referenced
// text may be hidden, and includes nested text and image alternatives.
export function nameContext(parsed) {
  const ids = new Map();
  const idOwners = new Map();
  const labels = new Map();
  for (const node of parsed.elements) {
    if (node.attrs.id && !ids.has(node.attrs.id)) {
      ids.set(node.attrs.id, node.label);
      idOwners.set(node.attrs.id, node);
    }
    if (node.tag === 'label' && node.attrs.for && !node.hidden && node.label.trim()) {
      labels.set(node.attrs.for, node.label);
    }
  }
  for (const event of parsed.events ?? []) {
    if (event.type === 'text') {
      const text = decodeEntities(event.value);
      for (let node = event.node; node; node = node.parent) {
        if (node.attrs.id && !node.label && text.trim() && node === idOwners.get(node.attrs.id) && !event.aria && (!event.hidden || node.hidden)) {
          ids.set(node.attrs.id, (ids.get(node.attrs.id) ?? '') + text);
        }
      }
    } else if (event.type === 'alt') {
      for (let node = event.node; node; node = node.parent) {
        if (node.attrs.id && !node.label && event.value.trim() && node === idOwners.get(node.attrs.id) && !event.aria) {
          ids.set(node.attrs.id, ((ids.get(node.attrs.id) ?? '') + ' ' + event.value).trim());
        }
      }
    }
  }
  return { ids, labels };
}

export function accessibleName(node, { ids, labels }) {
  const a = node.attrs;
  const normalize = value => (value ?? '').replace(/\s+/g, ' ').trim();
  const referenced = normalize((a['aria-labelledby'] ?? '').trim().split(/\s+/).map(id => ids.get(id) ?? '').join(' '));
  if (referenced) return referenced;
  if (normalize(a['aria-label'])) return normalize(a['aria-label']);
  if (['input', 'button', 'select', 'textarea'].includes(node.tag)) {
    const label = within(node, 'label');
    const labeled = normalize(labels.get(a.id)) || (label && !label.attrs.for ? normalize(label.label) : '');
    if (labeled) return labeled;
  }
  let native = ['img', 'area'].includes(node.tag) ? a.alt : '';
  if (node.tag === 'input') {
    const kind = (a.type ?? '').trim().toLowerCase();
    if (['button', 'submit', 'reset', 'image'].includes(kind)) {
      native = kind === 'image' ? a.alt : a.value ?? (kind === 'button' ? '' : kind);
    }
  }
  return normalize(native) || normalize(node.label) || normalize(a.title);
}

function validLanguage(text) {
  if (!text?.trim()) return false;
  try { return new Intl.Locale(text.trim()).language !== 'und'; }
  catch { return false; }
}

function diagnostic(id, detail, location) {
  const [label, criterion, kind] = RULES[id];
  return { id, label, criterion, kind, detail, start: location?.start ?? 0, end: location?.end ?? 0 };
}

export function capsDiagnostic(text, start = 0, end = text.length) {
  const letters = text.match(/\p{L}/gu) ?? [];
  const caps = letters.filter(ch => /\p{Lu}/u.test(ch)).length;
  return letters.length >= 18 && caps / letters.length >= 0.95 && text.trim().split(/\s+/).length >= 4
    ? diagnostic('caps-block', 'Long uppercase passages can be harder to scan.', { start, end }) : null;
}

export function auditHTML(source, parsed = tokenizeHTML(source)) {
  const issues = [];
  const add = (id, detail, location) => issues.push(diagnostic(id, detail, location));
  const root = parsed.elements.find(node => node.tag === 'html' && !node.parent);
  const title = parsed.elements.find(node => node.tag === 'title' && Boolean(within(node, 'head')));
  if (!validLanguage(root?.attrs.lang)) add('language', 'Supply a valid language tag on the HTML element.', root ?? parsed.doctype);
  if ((root || parsed.doctype || parsed.elements.some(e => e.tag === 'head' || e.tag === 'body')) && !title?.label.trim()) {
    add('page-title', 'Give the document a non-empty title in its head.', title ?? root ?? parsed.doctype);
  }

  const { ids, labels } = nameContext(parsed);
  const ownText = new Map();
  const CAPS_TAGS = /^(?:p|div|section|article|li|h[1-6])$/;
  const subtree = new Map();
  for (const event of parsed.events) {
    if (event.type === 'text') {
      const text = decodeEntities(event.value);
      if (event.node && text.trim() && !event.hidden) {
        ownText.set(event.node, (ownText.get(event.node) ?? '') + text);
        for (let n = event.node; n; n = n.parent) if (CAPS_TAGS.test(n.tag)) subtree.set(n, (subtree.get(n) ?? '') + text);
      }
    }
  }
  const styleCache = new Map();
  let lastHeading = 0;
  for (const node of parsed.elements) {
    const { tag, attrs, parent } = node;
    if ((node.hidden && !['iframe', 'select', 'textarea', 'object', 'embed'].includes(tag)) || node.excluded || node.aria) continue;
    const attrib = key => Object.hasOwn(attrs, key);
    const accessible = hasName(node, ids);
    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      if (level > lastHeading + 1) add('heading-order', lastHeading ? `Heading level ${lastHeading} jumps to ${level}.` : `The first heading is level ${level}, not level 1.`, node);
      if (!node.label.trim() && !accessible && !attrs.title?.trim()) add('empty-heading', 'Add a heading that identifies the following section.', node);
      lastHeading = level;
    }
    if (tag === 'img' && !attrib('alt') && !accessible && !/^(?:presentation|none)$/i.test(attrs.role ?? '')) {
      add('image-alt', 'Provide meaningful alternative text, or an empty alt attribute for a decorative image.', node);
    }
    if ((tag === 'a' || tag === 'area') && attrib('href')) {
      const name = (attrs['aria-label']?.trim() || (tag === 'area' ? attrs.alt?.trim() : node.label.trim()) || attrs.title?.trim() || '').replace(/\s+/g, ' ');
      const referenced = !attrs['aria-label']?.trim() && accessible;
      if (!referenced && (!name || /^(?:click(?: here)?|here|read more|more|learn more|link|details|go)[.!: ]*$/i.test(name))) {
        add('link-purpose', 'Use link text that describes the destination. Surrounding context may also supply the purpose.', node);
      }
    }
    const kind = attrs.type?.trim().toLowerCase();
    const buttonInput = tag === 'input' && ['button', 'submit', 'reset', 'image'].includes(kind);
    if (['input', 'select', 'textarea'].includes(tag) && !(tag === 'input' && kind === 'hidden') && !buttonInput &&
        !accessible && !attrs.title?.trim() && !labels.has(attrs.id) && !(within(node, 'label')?.label.trim() && !within(node, 'label')?.attrs.for)) {
      add('input-label', 'Associate a visible label with this control.', node);
    }
    if ((tag === 'button' || buttonInput) && !accessible && !attrs.title?.trim()) {
      const name = tag === 'button' ? node.label : kind === 'image' ? attrs.alt : attrs.value ?? (kind === 'button' ? '' : kind);
      if (!name?.trim()) add('button-name', 'Name the action this button performs.', node);
    }
    if (['iframe', 'object', 'embed'].includes(tag) && !attrs.title?.trim() && !accessible) add('frame-title', 'Describe the purpose of the embedded content.', node);

    const style = declarations(attrs.style);
    const inherited = styleCache.get(parent) ?? {};
    const factor = style('font') === undefined;
    const solidBackground = hexRGB(style('background-color') ?? '');
    const image = style('background-image');
    const settings = {
      color: style('color') ?? inherited.color,
      background: style('background-color') === 'transparent' ? inherited.background : style('background-color') ?? inherited.background,
      image: image && image !== 'none' ? true : !solidBackground && inherited.image,
      opaque: inherited.opaque !== false && (!style('opacity') || Number(style('opacity')) === 1),
      size: style('font-size') ?? (factor ? inherited.size : undefined),
      weight: style('font-weight') ?? (factor ? inherited.weight : undefined),
      origin: style('color') || style('background-color') || style('font-size') || style('font-weight') ? node : inherited.origin
    };
    styleCache.set(node, settings);
    const px = sizePx(settings.size);
    if (style('font-size') !== undefined && px !== null && px < 12) add('tiny-text', `${px.toFixed(1)} px is below the studio's 12 px review threshold.`, node);
    const text = ownText.get(node);
    if (!text || !settings.origin) continue;
    if (settings.opaque && !settings.image) {
      const ratio = contrastRatio(settings.color ?? '', settings.background ?? '');
      const threshold = px !== null && (px >= 24 || (px >= 56 / 3 && (settings.weight === 'bold' || Number(settings.weight) >= 700))) ? 3 : 4.5;
      if (ratio !== null && ratio < threshold && !issues.some(issue => issue.id === 'contrast' && issue.start === settings.origin.start)) {
        add('contrast', `${ratio.toFixed(2)}:1 is below ${threshold}:1 for this inline style.`, settings.origin);
      }
    }
  }
  for (const node of parsed.elements) {
    if (node.hidden || !/^(?:p|div|section|article|li|h[1-6])$/.test(node.tag)) continue;
    const issue = capsDiagnostic(node.label || subtree.get(node) || '', node.start, node.end);
    if (issue) issues.push(issue);
  }
  return issues.sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : Number(a.id > b.id)));
}
