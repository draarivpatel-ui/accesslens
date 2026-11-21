const VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const RAW = new Set('script style iframe xmp noembed noframes noscript textarea title'.split(' '));
const HIDDEN = new Set('head script style iframe xmp noembed noframes noscript template object embed svg math canvas audio video select textarea'.split(' '));
const BLOCK = new Set('address article aside blockquote br dd div dl dt footer h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section table td th tr ul'.split(' '));
const AUTOCLOSE = new Set('dd dt li option p td th tr'.split(' '));
const LABEL_TEXT = /^(?:a|button|h[1-6]|label|title)$/;
const ENTITIES = {
  amp: '&', apos: "'", quot: '"', lt: '<', gt: '>', nbsp: ' ', ensp: ' ', emsp: ' ',
  ndash: '\u2013', mdash: '\u2014', lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d',
  bull: '\u2022', hellip: '\u2026', copy: '\u00a9', reg: '\u00ae', eacute: '\u00e9', euro: '\u20ac',
  pound: '\u00a3', cent: '\u00a2', times: '\u00d7', divide: '\u00f7', Tab: '\t', NewLine: '\n'
};
const MAX_DEPTH = 96;

function entity(matched) {
  const key = matched.slice(1, -1);
  if (Object.hasOwn(ENTITIES, key)) return ENTITIES[key];
  if (key[0] !== '#') return matched;
  const hex = key[1].toLowerCase() === 'x';
  const code = parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
  return code && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '\ufffd';
}

const entityPattern = /&(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi;
export const decodeEntities = text => text.replace(entityPattern, entity);
const tagStart = /<(\/?)([a-z][a-z0-9:_-]*)(?=[\s/>])/iy;

function readTag(source, start) {
  tagStart.lastIndex = start;
  const open = tagStart.exec(source);
  if (!open) return null;
  let p = tagStart.lastIndex;
  const limit = Math.min(source.length, start + 4096);
  const attrs = Object.create(null);
  const spans = Object.create(null);
  while (p < limit) {
    while (p < limit && /\s/.test(source[p])) p++;
    if (source[p] === '>' || source.startsWith('/>', p)) {
      return { tag: open[2].toLowerCase(), close: Boolean(open[1]), start, end: p + (source[p] === '/' ? 2 : 1), attrs, spans };
    }
    if (source[p] === '<' || p >= limit) return null;
    const from = p;
    while (p < limit && !/[\s/=< >]/.test(source[p])) p++;
    if (from === p) { p++; continue; }
    const name = source.slice(from, p).toLowerCase();
    while (p < limit && /\s/.test(source[p])) p++;
    let value = '';
    if (source[p] === '=') {
      p++;
      while (p < limit && /\s/.test(source[p])) p++;
      const quote = source[p];
      if (quote === '"' || quote === "'") {
        let finish = p + 1;
        while (finish < limit && source[finish] !== quote) finish++;
        if (finish >= limit) return null;
        value = source.slice(p + 1, finish);
        p = finish + 1;
      } else {
        const left = p;
        while (p < limit && !/[\s<>]/.test(source[p])) p++;
        value = source.slice(left, p);
      }
    }
    if (!Object.hasOwn(attrs, name)) {
      attrs[name] = decodeEntities(value);
      spans[name] = [from, p];
    }
  }
  return null;
}

export function tokenizeHTML(source) {
  const elements = [], events = [], stack = [];
  let doctype = null;
  let limited = false;
  function addText(start, end, raw = false) {
    if (end <= start) return;
    const node = stack.at(-1);
    const value = source.slice(start, end);
    if (raw && node.tag !== 'title' && node.tag !== 'textarea') return;
    const decoded = decodeEntities(value);
    for (let i = stack.length - 1; i >= 0; i--) {
      const ancestor = stack[i];
      if (LABEL_TEXT.test(ancestor.tag) && ancestor.label.length < 2048 &&
          (!node?.hidden || ancestor.tag === 'title' || !ancestor.hidden && node === ancestor)) ancestor.label += decoded.slice(0, 2048);
    }
    if (!node?.hidden && !raw) events.push({ type: 'text', node, start, end, value });
  }
  const next = /</g;
  let p = 0;
  while (p < source.length) {
    next.lastIndex = p;
    const hit = next.exec(source);
    const at = hit?.index ?? source.length;
    addText(p, at);
    if (at === source.length) break;
    if (source.startsWith('<!--', at)) {
      const end = source.indexOf('-->', at + 4);
      p = end < 0 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<!', at) || source.startsWith('<?', at)) {
      const finish = source.indexOf('>', at + 2);
      p = finish < 0 ? source.length : finish + 1;
      if (/^<!doctype\s+html\b/i.test(source.slice(at, p))) doctype ??= {start: at, end: p};
      continue;
    }
    const token = readTag(source, at);
    if (!token) {
      addText(at, at + 1);
      p = at + 1;
      continue;
    }
    p = token.end;
    const { tag, close, attrs } = token;
    if (close) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag !== tag) continue;
        if (BLOCK.has(tag) && !stack[i].hidden) events.push({type: 'break', start: token.start, end: p});
        stack.length = i;
        break;
      }
      continue;
    }
    if (stack.at(-1)?.tag === tag && AUTOCLOSE.has(tag)) stack.pop();
    if (BLOCK.has(tag) && stack.at(-1)?.tag === 'p') stack.pop();
    const parent = stack.at(-1);
    const ownHidden = Object.hasOwn(attrs, 'hidden') || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i.test(attrs.style ?? '');
    const node = { ...token, parent, label: '', hidden: Boolean(parent?.hidden || ownHidden || HIDDEN.has(tag)),
      excluded: Boolean(parent?.hidden || ownHidden) };
    elements.push(node);
    if (BLOCK.has(tag) && !node.hidden) events.push({type: 'break', start: at, end: p});
    if (tag === 'img' && !node.hidden && attrs.alt?.trim()) {
      const [start, end] = token.spans.alt;
      events.push({type: 'alt', node, start, end, value: attrs.alt});
      for (const ancestor of stack) {
        if (LABEL_TEXT.test(ancestor.tag) && ancestor.label.length < 2048) ancestor.label += ' ' + attrs.alt;
      }
    }
    if (tag === 'plaintext') break;
    if (RAW.has(tag)) {
      const closing = new RegExp(`</${tag}(?=[\\s/>])[^>]*>`, 'ig');
      closing.lastIndex = p;
      const end = closing.exec(source);
      stack.push(node);
      addText(p, end?.index ?? source.length, true);
      stack.pop();
      p = end ? closing.lastIndex : source.length;
    } else if (!VOID.has(tag)) {
      if (stack.length === MAX_DEPTH) { limited = true; break; }
      stack.push(node);
    }
  }
  return { elements, events, doctype, limited };
}

export function extractHTML(parsed) {
  const chars = [], starts = [], ends = [], blocks = [];
  let owner, blockStart = 0, pending = null;
  function emit(value, start, end) {
    for (const char of value.split('')) {
      if (/\s/u.test(char)) { pending ??= [start, end]; continue; }
      if (pending && chars.length && chars.at(-1) !== '\n') {
        chars.push(' '); starts.push(pending[0]); ends.push(pending[1]);
      }
      pending = null;
      chars.push(char); starts.push(start); ends.push(end);
    }
  }
  function flush(item) {
    pending = null;
    if (chars.length <= blockStart) return;
    const text = chars.slice(blockStart).join('');
    const level = /^h[1-6]$/.test(owner?.tag ?? '') ? Number(owner.tag[1]) : null;
    blocks.push({text, start: blockStart, end: chars.length,
      kind: level ? 'heading' : owner?.tag === 'li' ? 'bullet' : 'paragraph', ...(level ? {level} : {})});
    chars.push('\n'); starts.push(item.start); ends.push(item.end);
    blockStart = chars.length;
    owner = undefined;
  }
  for (const item of parsed.events) {
    if (item.type === 'break') { flush(item); continue; }
    let nextOwner = item.node;
    while (nextOwner && !BLOCK.has(nextOwner.tag)) nextOwner = nextOwner.parent;
    if (owner !== nextOwner && chars.length > blockStart) flush(item);
    owner = nextOwner;
    if (item.type === 'alt') {
      pending ??= [item.start, item.end];
      emit(item.value, item.start, item.end);
      pending = [item.start, item.end];
      continue;
    }
    let offset = 0;
    for (const match of item.value.matchAll(entityPattern)) {
      for (; offset < match.index; offset++) emit(item.value[offset], item.start + offset, item.start + offset + 1);
      const stop = match.index + match[0].length;
      const decoded = entity(match[0]);
      if (decoded === match[0]) continue;
      emit(decoded, item.start + offset, item.start + stop);
      offset = stop;
    }
    for (; offset < item.value.length; offset++) emit(item.value[offset], item.start + offset, item.start + offset + 1);
  }
  flush({start: 0, end: 0});
  if (chars.at(-1) === '\n') { chars.pop(); starts.pop(); ends.pop(); }
  return { text: chars.join(''), starts, ends, blocks };
}
