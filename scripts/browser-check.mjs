// AccessLens browser smoke check. Ordinary integration verification, not an
// evaluation or scoring harness: it starts an ephemeral server and a throwaway
// headless Chrome profile, drives the page over CDP with real input events,
// asserts layout and core controls at 1280x800 and 390x844, and captures
// docs/desktop.png and docs/remediation.png. Node standard library only.
import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DOCS = join(ROOT, 'docs');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

class CDP {
  static connect(url) {
    const ws = new WebSocket(url);
    return new Promise((res, rej) => {
      ws.addEventListener('open', () => res(new CDP(ws)), { once: true });
      ws.addEventListener('error', () => rej(new Error(`WebSocket failed: ${url}`)), { once: true });
    });
  }
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', e => this._onMessage(e));
    ws.addEventListener('close', () => {
      for (const p of this.pending.values()) p.reject(new Error('Chrome disconnected'));
      this.pending.clear();
    });
    ws.addEventListener('error', () => {
      for (const p of this.pending.values()) p.reject(new Error('Chrome socket error'));
      this.pending.clear();
    });
  }
  _onMessage(e) {
    const m = JSON.parse(e.data);
    if (m.id !== undefined) {
      const p = this.pending.get(m.id);
      if (p) {
        this.pending.delete(m.id);
        if (m.error) p.reject(new Error(`${m.error.message} (${m.error.code})`));
        else p.resolve(m.result);
      }
      return;
    }
    for (const key of [`${m.sessionId || ''}:${m.method}`, `*:${m.method}`]) {
      for (const fn of this.handlers.get(key) || []) fn(m.params || {}, m.sessionId);
    }
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after 10s`));
      }, 10000);
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: err => { clearTimeout(timer); reject(err); }
      });
    });
  }
  on(method, fn, sessionId) {
    const key = `${sessionId || ''}:${method}`;
    if (!this.handlers.has(key)) this.handlers.set(key, []);
    this.handlers.get(key).push(fn);
  }
  once(method, sessionId, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const key = `${sessionId || ''}:${method}`;
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), timeout);
      const fn = params => {
        clearTimeout(timer);
        const list = this.handlers.get(key) || [];
        this.handlers.set(key, list.filter(f => f !== fn));
        resolve(params);
      };
      this.on(method, fn, sessionId);
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

let server, chrome, cdp, profile, sid;
const errors = [];
const requests = [];

async function evaluate(expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sid);
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'page evaluation failed');
  }
  return r.result.value;
}

async function waitFor(expression, label, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(expression)) return;
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function rectOf(selector) {
  const rect = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, right: r.right, width: r.width, height: r.height };
  })()`);
  if (!rect) throw new Error(`no element for ${selector}`);
  return rect;
}

async function click(selector) {
  const r = await rectOf(selector);
  for (const [type, opts] of [
    ['mouseMoved', {}],
    ['mousePressed', { button: 'left', clickCount: 1 }],
    ['mouseReleased', { button: 'left', clickCount: 1 }]
  ]) {
    await cdp.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, ...opts }, sid);
  }
  return r;
}

async function key(keyName, code, vk, text) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }, sid);
  if (text) await cdp.send('Input.dispatchKeyEvent', { type: 'char', text, key: keyName }, sid);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }, sid);
}

async function capture(file) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sid);
  await writeFile(join(DOCS, file), Buffer.from(data, 'base64'));
  console.log(`wrote docs/${file}`);
}

async function navigate(url) {
  const loaded = cdp.once('Page.loadEventFired', sid, 15000);
  await cdp.send('Page.navigate', { url }, sid);
  await loaded;
  await sleep(350);
}

async function startServer() {
  server = spawn(process.execPath, [join(ROOT, 'scripts', 'serve.mjs')], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let errBuf = '';
  server.stderr.on('data', d => { errBuf += d; });
  return new Promise((res, rej) => {
    let buf = '';
    const timer = setTimeout(() => rej(new Error(`server did not print a URL. stderr: ${errBuf}`)), 8000);
    server.stdout.on('data', d => {
      buf += d;
      const m = buf.match(/http:\/\/127\.0\.0\.1:\d+\//);
      if (m) { clearTimeout(timer); res(m[0]); }
    });
    server.on('exit', code => rej(new Error(`server exited with ${code}. stderr: ${errBuf}`)));
  });
}

async function startChrome() {
  if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}`);
  profile = await mkdtemp(join(tmpdir(), 'accesslens-check-'));
  chrome = spawn(CHROME, [
    '--headless=new',
    '--mute-audio',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-crash-restore-bubble',
    '--disable-background-networking',
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    'about:blank'
  ], { stdio: 'ignore' });
  for (let i = 0; i < 200; i++) {
    try {
      const text = await readFile(join(profile, 'DevToolsActivePort'), 'utf8');
      const [port, path] = text.trim().split('\n');
      if (port && path) return `ws://127.0.0.1:${port}${path}`;
    } catch { /* not written yet */ }
    await sleep(100);
  }
  throw new Error('Chrome DevToolsActivePort never appeared');
}

async function cleanup() {
  try { cdp?.close(); } catch {}
  try { chrome?.kill('SIGTERM'); } catch {}
  try { server?.kill('SIGTERM'); } catch {}
  if (chrome) setTimeout(() => { try { chrome.kill('SIGKILL'); } catch {} }, 1500).unref();
  if (profile) await rm(profile, { recursive: true, force: true }).catch(() => {});
}

async function main() {
  const origin = await startServer();
  console.log(`server: ${origin}`);
  const wsUrl = await startChrome();
  console.log('chrome: headless profile', profile);

  cdp = await CDP.connect(wsUrl);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: sid } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));

  cdp.on('Runtime.exceptionThrown', p => {
    errors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || 'uncaught exception');
  }, sid);
  cdp.on('Runtime.consoleAPICalled', p => {
    if (p.type === 'error') errors.push(`console.error: ${(p.args || []).map(a => a.value ?? a.description ?? '').join(' ')}`);
  }, sid);
  cdp.on('Log.entryAdded', p => {
    const entry = p.entry;
    if (entry && entry.level === 'error') {
      errors.push(`[log] ${entry.source || 'browser'}: ${entry.text || ''}${entry.url ? ` ${entry.url}` : ''}`);
    }
  }, sid);
  cdp.on('Network.requestWillBeSent', p => requests.push(p.request?.url || ''), sid);

  await cdp.send('Page.enable', {}, sid);
  await cdp.send('Runtime.enable', {}, sid);
  await cdp.send('Network.enable', {}, sid);
  await cdp.send('Log.enable', {}, sid);

  // Desktop pass: 1280x800.
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, sid);
  await navigate(origin);
  await waitFor(`document.querySelectorAll('#examples .chip').length > 0`, 'example picker to render');
  check('csp meta includes require-trusted-types-for',
    await evaluate(`document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content.includes("require-trusted-types-for 'script'") === true`));
  check('1280x800: no horizontal scrollbar',
    await evaluate(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`));
  check('document loads with real content',
    await evaluate(`document.getElementById('document').value.trim().length > 50`));
  check('four example choices render', await evaluate(`document.querySelectorAll('#examples .chip').length === 4`),
    `${await evaluate(`document.querySelectorAll('#examples .chip').length`)} found`);
  check('key command toggle defaults off', await evaluate(`document.getElementById('keys').checked === false`));

  // Keyboard guard: r must do nothing while the toggle is off.
  await click('h1');
  await key('r', 'KeyR', 82);
  await sleep(300);
  check('r with toggle off does not run', await evaluate(`document.getElementById('repair').disabled === true`));

  // Real click on Run checks; the default biology example fills the board.
  await click('#run');
  await waitFor(`document.getElementById('repair').disabled === false`, 'analysis to finish');
  check('biology board renders readout and language evidence',
    await evaluate(`document.querySelectorAll('#readout .group').length >= 4 && document.querySelector('#language-evidence .language-finding') !== null`),
    `${await evaluate(`document.querySelectorAll('#issues .issue').length`)} findings`);
  check('key points carry a finite TextRank score', await evaluate(`(() => {
    const d = document.querySelector('#language-evidence .language-finding .issue-detail');
    return !!d && d.textContent.startsWith('TextRank ') && Number.isFinite(parseFloat(d.textContent.slice(9)));
  })()`));
  check('bundle export is an explicit enabled action',
    await evaluate(`document.getElementById('export-bundle').disabled === false`));

  // Editing the source invalidates results.
  await click('#document');
  await key('x', 'KeyX', 88, 'x');
  await sleep(300);
  check('editing the source clears results and exports',
    await evaluate(`document.getElementById('repair').disabled === true && document.querySelectorAll('#issues .issue').length === 0 && document.getElementById('export-audit').disabled === true`));

  // Turn on key commands; r inside the textarea must be swallowed by the guard.
  await click('#keys');
  check('key command toggle turns on', await evaluate(`document.getElementById('keys').checked === true`));
  await click('#document');
  const lenBefore = await evaluate(`document.getElementById('document').value.length`);
  await key('r', 'KeyR', 82, 'r');
  await sleep(300);
  const lenAfter = await evaluate(`document.getElementById('document').value.length`);
  check('r inside the editor types text instead of running',
    lenAfter === lenBefore + 1 && await evaluate(`document.getElementById('repair').disabled === true`),
    `${lenBefore} -> ${lenAfter}`);

  // From the page body, r runs and e focuses the editor.
  await click('h1');
  await key('r', 'KeyR', 82);
  await waitFor(`document.getElementById('repair').disabled === false`, 'keyboard run');
  check('r from the page body runs checks', true);
  await click('h1');
  await key('e', 'KeyE', 69);
  await sleep(250);
  check('e from the page body focuses the editor',
    await evaluate(`document.activeElement === document.getElementById('document')`));

  // Load the club HTML example and audit it.
  await click('#examples .chip:has(input[value="club"])');
  await sleep(300);
  check('club example loads HTML mode',
    await evaluate(`document.getElementById('mode').value === 'html' && document.getElementById('document').value.includes('<html')`));
  await click('#run');
  await waitFor(`document.getElementById('repair').disabled === false`, 'club analysis');
  const clubIssues = await evaluate(`document.querySelectorAll('#issues .issue').length`);
  check('club source flags 13 issues', clubIssues === 13, `${clubIssues} found`);
  check('club run yields source language evidence',
    await evaluate(`document.querySelector('#language-evidence .language-finding') !== null`));

  // Evidence button selects the exact nonempty source range.
  const range = await evaluate(`(() => {
    const t = document.querySelector('#issues .issue .offset').textContent;
    const [a, b] = t.split('..').map(Number);
    return { a, b };
  })()`);
  await click('#issues .issue .evidence');
  await sleep(200);
  check('evidence selects the exact source range and focuses the editor',
    await evaluate(`document.activeElement === document.getElementById('document') && document.getElementById('document').selectionStart === ${range.a} && document.getElementById('document').selectionEnd === ${range.b}`),
    `${range.a}..${range.b}`);

  // Build the reading copy; both paper columns fill from blocks, never copy.html.
  await click('#repair');
  await waitFor(`document.querySelectorAll('#after p, #after li, #after h4, #after h5, #after h6').length > 0`, 'reading copy to render');
  check('comparison renders original and reading copy',
    await evaluate(`document.querySelectorAll('#before p, #before li, #before h4, #before h5, #before h6').length > 0`));
  const summary = await evaluate(`document.getElementById('comparison-summary').textContent`);
  check('before/after delta summary', summary.includes('6.40 to 2.73') && summary.includes('13 to 0') && summary.includes('Estimated time'), summary);

  // Exercise the study card reveal as a real toggle.
  await click('#card-reveal');
  await sleep(200);
  check('card reveal shows the answer and enables grading',
    await evaluate(`document.getElementById('card-back').hidden === false && document.getElementById('card-grade').disabled === false`));
  await click('#card-reveal');
  await sleep(200);
  check('card reveal toggles back to hidden answer and disabled grading',
    await evaluate(`document.getElementById('card-back').hidden === true && document.getElementById('card-grade').disabled === true`));

  // Spacing toggle re-rules the papers.
  await click('#spacing');
  const roomy = await evaluate(`document.getElementById('comparison').classList.contains('roomy')`);
  await click('#spacing');
  check('spacing toggle switches the paper columns', roomy === true);

  // No request may leave the page.
  const bad = requests.filter(u => u && !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:') && !u.startsWith('devtools:'));
  check('no external requests', bad.length === 0, bad.slice(0, 3).join(', '));

  await mkdir(DOCS, { recursive: true });
  await evaluate(`window.scrollTo(0, 0)`);
  await sleep(300);
  await capture('desktop.png');
  await evaluate(`document.getElementById('comparison').scrollIntoView({ block: 'start' })`);
  await sleep(300);
  await capture('remediation.png');

  // Mobile pass: 390x844.
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, sid);
  await navigate(origin);
  await waitFor(`document.querySelectorAll('#examples .chip').length > 0`, 'mobile render');
  check('390x844: no horizontal scrollbar',
    await evaluate(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`));
  const runRect = await rectOf('#run');
  check('mobile Run checks control is reachable',
    runRect.width > 0 && runRect.height >= 24 && runRect.left >= -1 && runRect.right <= 391,
    `${Math.round(runRect.width)}x${Math.round(runRect.height)} at ${Math.round(runRect.left)}`);
  await click('#run');
  await waitFor(`document.getElementById('repair').disabled === false`, 'mobile run');
  check('click at mobile viewport runs checks', true);
  const valueBefore = await evaluate(`document.getElementById('document').value`);
  await click('#examples .chip:nth-of-type(2)');
  await sleep(300);
  const valueAfter = await evaluate(`document.getElementById('document').value`);
  check('mobile example switch loads a different document and clears results',
    valueAfter !== valueBefore && await evaluate(`document.getElementById('repair').disabled === true`));

  const badMobile = requests.filter(u => u && !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:') && !u.startsWith('devtools:'));
  check('no external requests after mobile pass', badMobile.length === 0, badMobile.slice(0, 3).join(', '));
  check('no console errors or exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
}

try {
  await main();
} catch (err) {
  check('run completed', false, [err.message, ...errors.slice(0, 3)].join(' | '));
} finally {
  await cleanup();
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
