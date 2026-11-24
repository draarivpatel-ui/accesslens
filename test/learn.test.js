import test from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio, hexRGB, luminance } from '../src/a11y.js';
import { colorSteps, contrastMath, fleschKincaidMath, linearize, spacingMath, suggestForeground, TARGET_MIN, targetSize } from '../src/learn.js';
import { readability } from '../src/nlp.js';
import { SPACING_MIN } from '../src/wcag-audit.js';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test('black on white is 21:1 and passes every contrast level', () => {
  const m = contrastMath('#000000', '#ffffff');
  assert.ok(close(m.ratio, 21));
  assert.ok(m.verdicts.every(v => v.pass));
});

test('equal colors are 1:1 and fail every level', () => {
  const m = contrastMath('#777777', '#777777');
  assert.ok(close(m.ratio, 1));
  assert.ok(m.verdicts.every(v => !v.pass));
});

test('#888 on white is 3.54:1: large text AA only', () => {
  const m = contrastMath('#888888', '#ffffff');
  assert.equal(m.ratio.toFixed(2), '3.54');
  assert.deepEqual(m.verdicts.map(v => v.pass), [false, true, false, false]);
});

test('drawer ratio matches the audit contrastRatio for many pairs', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const hex = () => `#${Array.from({ length: 3 }, () => Math.floor(rnd() * 256).toString(16).padStart(2, '0')).join('')}`;
  for (let i = 0; i < 200; i++) {
    const a = hex(), b = hex();
    const m = contrastMath(a, b);
    assert.ok(close(m.ratio, contrastRatio(a, b)), `${a} ${b}`);
    assert.ok(close(m.ratio, contrastMath(b, a).ratio));
  }
});

test('linearize is continuous at the 0.04045 knee and maps 0 and 1 to themselves', () => {
  assert.ok(close(linearize(0), 0));
  assert.ok(close(linearize(1), 1));
  assert.ok(Math.abs(linearize(0.04045) - linearize(0.0404500001)) < 1e-6);
});

test('colorSteps luminance equals the weighted sum and the audit luminance', () => {
  const s = colorSteps('#336699');
  assert.ok(close(s.weighted.reduce((a, b) => a + b, 0), s.L));
  assert.ok(close(s.L, luminance(hexRGB('#336699'))));
  assert.deepEqual(s.channels8, [0x33, 0x66, 0x99]);
});

test('contrastMath rejects invalid colors', () => {
  assert.equal(contrastMath('red', '#fff'), null);
  assert.equal(colorSteps('#12'), null);
});

test('suggestForeground reaches the target and keeps gray gray', () => {
  const hex = suggestForeground('#888888', '#ffffff');
  assert.equal(hex, '#767676');
  assert.ok(contrastRatio(hex, '#ffffff') >= 4.5);
  assert.ok(contrastRatio('#777777', '#ffffff') < 4.5 || hex === '#777777');
});

test('suggestForeground lightens text on a dark background', () => {
  const hex = suggestForeground('#333333', '#000000');
  assert.ok(contrastRatio(hex, '#000000') >= 4.5);
  assert.ok(luminance(hexRGB(hex)) > luminance(hexRGB('#333333')));
});

test('fleschKincaidMath reproduces the shipped grade', () => {
  const text = 'Calculate the change in mass for each bag. Compare the two changes. Write one claim about water movement.';
  const stats = readability(text);
  const m = fleschKincaidMath(stats);
  assert.ok(m.matches);
  assert.ok(close(m.terms[0] + m.terms[1] + m.terms[2], stats.fk) || stats.fk === 0);
  assert.equal(m.pass, m.grade <= 9);
});

test('fleschKincaidMath needs words and sentences', () => {
  assert.equal(fleschKincaidMath(null), null);
  assert.equal(fleschKincaidMath({ words: 0, sentences: 0 }), null);
});

test('target size: 24 px passes on size alone', () => {
  assert.deepEqual(targetSize(TARGET_MIN, 0), { pass: true, rule: 'size', pitch: 24 });
  assert.equal(targetSize(44, 0).pass, true);
});

test('target size: undersized targets pass only with 24 px pitch', () => {
  assert.equal(targetSize(20, 4).pass, true);
  assert.equal(targetSize(20, 3).pass, false);
  assert.equal(targetSize(16, 8).pass, true);
  assert.equal(targetSize(16, 8).rule, 'spacing');
});

test('target size rejects nonsense', () => {
  assert.equal(targetSize(0, 0), null);
  assert.equal(targetSize(10, -1), null);
});

test('spacing math follows SC 1.4.12 factors', () => {
  const rows = spacingMath(16);
  assert.deepEqual(rows.map(r => r.factor), [SPACING_MIN.lineHeight, SPACING_MIN.paragraphSpacing, SPACING_MIN.letterSpacing, SPACING_MIN.wordSpacing]);
  assert.ok(close(rows[0].px, 24));
  assert.ok(close(rows[2].px, 1.92));
  assert.equal(spacingMath(0), null);
});
