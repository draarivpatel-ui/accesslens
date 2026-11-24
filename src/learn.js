// "How WCAG 2.2 math works": step-by-step numbers for the learning drawer,
// computed with the same functions the audit ships. Pure functions, no DOM.
import { hexRGB, luminance, contrastRatio } from './a11y.js';
import { CONTRAST_AA, CONTRAST_AA_LARGE, CONTRAST_AAA, CONTRAST_AAA_LARGE, READING_LEVEL_MAX_GRADE, SPACING_MIN } from './wcag-audit.js';

export const TARGET_MIN = 24; // SC 2.5.8 Target Size (Minimum), CSS pixels

export const linearize = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

export function colorSteps(hex) {
  const srgb = hexRGB(hex);
  if (!srgb) return null;
  const linear = srgb.map(linearize);
  return { hex: hex.toLowerCase(), channels8: srgb.map(c => Math.round(c * 255)), srgb, linear,
    weighted: [0.2126 * linear[0], 0.7152 * linear[1], 0.0722 * linear[2]], L: luminance(srgb) };
}

export function contrastMath(foreground, background) {
  const fg = colorSteps(foreground), bg = colorSteps(background);
  if (!fg || !bg) return null;
  const lighter = Math.max(fg.L, bg.L), darker = Math.min(fg.L, bg.L);
  const ratio = (lighter + 0.05) / (darker + 0.05);
  return {
    fg, bg, lighter, darker, ratio, check: contrastRatio(foreground, background),
    verdicts: [
      { sc: '1.4.3 Contrast (Minimum)', level: 'AA', text: 'Body text', min: CONTRAST_AA, pass: ratio >= CONTRAST_AA },
      { sc: '1.4.3 Contrast (Minimum)', level: 'AA', text: 'Large text', min: CONTRAST_AA_LARGE, pass: ratio >= CONTRAST_AA_LARGE },
      { sc: '1.4.6 Contrast (Enhanced)', level: 'AAA', text: 'Body text', min: CONTRAST_AAA, pass: ratio >= CONTRAST_AAA },
      { sc: '1.4.6 Contrast (Enhanced)', level: 'AAA', text: 'Large text', min: CONTRAST_AAA_LARGE, pass: ratio >= CONTRAST_AAA_LARGE }
    ]
  };
}

// Darkest or lightest step of the foreground that reaches a target ratio, keeping its hue.
export function suggestForeground(foreground, background, target = CONTRAST_AA) {
  const fg = hexRGB(foreground), bg = hexRGB(background);
  if (!fg || !bg) return null;
  const towardBlack = luminance(bg) > 0.18;
  for (let step = 0; step <= 100; step++) {
    const t = step / 100;
    const mixed = fg.map(c => towardBlack ? c * (1 - t) : c + (1 - c) * t);
    const hex = `#${mixed.map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`;
    if (contrastRatio(hex, background) >= target) return hex;
  }
  return null;
}

export function fleschKincaidMath(stats) {
  if (!stats || !stats.words || !stats.sentences) return null;
  const wps = stats.words / stats.sentences;
  const spw = stats.syllables / stats.words;
  const terms = [0.39 * wps, 11.8 * spw, -15.59];
  const raw = terms[0] + terms[1] + terms[2];
  const grade = Math.max(0, raw);
  return { words: stats.words, sentences: stats.sentences, syllables: stats.syllables, wps, spw, terms, grade,
    max: READING_LEVEL_MAX_GRADE, pass: grade <= READING_LEVEL_MAX_GRADE, matches: stats.fk === null ? false : Math.abs(stats.fk - grade) < 1e-9 };
}

// SC 2.5.8: a target passes at 24 by 24 CSS px, or when a 24 px circle centered
// on it does not overlap the neighbor's circle (the spacing exception). For a row
// of equal targets that means center-to-center distance (size + gap) of 24 px or more.
export function targetSize(size, gap = 0) {
  const s = Number(size), g = Number(gap);
  if (!(s > 0) || !(g >= 0)) return null;
  if (s >= TARGET_MIN) return { pass: true, rule: 'size', pitch: s + g };
  return { pass: s + g >= TARGET_MIN, rule: 'spacing', pitch: s + g };
}

export function spacingMath(fontPx = 16) {
  const f = Number(fontPx);
  if (!(f > 0)) return null;
  return [
    { label: 'Line height', factor: SPACING_MIN.lineHeight, px: f * SPACING_MIN.lineHeight },
    { label: 'Paragraph spacing', factor: SPACING_MIN.paragraphSpacing, px: f * SPACING_MIN.paragraphSpacing },
    { label: 'Letter spacing', factor: SPACING_MIN.letterSpacing, px: f * SPACING_MIN.letterSpacing },
    { label: 'Word spacing', factor: SPACING_MIN.wordSpacing, px: f * SPACING_MIN.wordSpacing }
  ];
}
