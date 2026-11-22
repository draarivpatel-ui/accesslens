// In-page self-tests. The panel runs the same math the studio ships: FIPS 180-4
// SHA-256 known answers, WCAG relative luminance, readability determinism, the
// remediation non-worsening invariant, CSV formula safety and tamper detection.
import { contrastRatio } from './a11y.js';
import { certificateJSON, canonicalJSON, csv, verifyCertificate } from './exports.js';
import { readability } from './nlp.js';
import { presets } from './presets.js';
import { buildReadingCopy, inspectDocument } from './remediate.js';
import { sha256hex } from './sha256.js';
import {
  COPY_THEME, DYSLEXIA_SPACING, compareReports, encodeLensHash, fogFromStats,
  parseLensHash, readingLevelSummary, semanticTree, sentenceHistogram,
  textSpacingAudit, wcagContrast
} from './wcag-audit.js';

const ISSUED = '2026-01-01T00:00:00.000Z';
const probe = () => inspectDocument('Bring a clean ruler to class.');

export const selfTests = [
  { id: 'sha256-empty', name: 'SHA-256 empty message matches FIPS 180-4',
    run: () => sha256hex('') === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  { id: 'sha256-abc', name: 'SHA-256 of "abc" matches the FIPS known answer',
    run: () => sha256hex('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' },
  { id: 'sha256-56byte', name: 'SHA-256 of the 56-byte FIPS message matches',
    run: () => sha256hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq') === '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1' },
  { id: 'sha256-million', name: 'SHA-256 of one million "a" characters matches',
    run: () => sha256hex('a'.repeat(1000000)) === 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0' },
  { id: 'contrast-max', name: 'Black on white computes exactly 21.0:1',
    run: () => contrastRatio('#000', '#fff') === 21 },
  { id: 'contrast-aa-edge', name: '#767676 on white crosses the 4.5:1 AA line',
    run: () => { const ratio = contrastRatio('#767676', '#fff'); return ratio > 4.5 && ratio < 4.6; } },
  { id: 'contrast-copy-aaa', name: 'The reading copy palette clears the 7:1 AAA level',
    run: () => wcagContrast(COPY_THEME.ink, COPY_THEME.background)?.aaa === true },
  { id: 'spacing-1412', name: 'The dyslexia profile clears every 1.4.12 spacing minimum',
    run: () => textSpacingAudit(DYSLEXIA_SPACING).pass === true },
  { id: 'spacing-catches-low', name: 'The 1.4.12 audit rejects cramped spacing',
    run: () => textSpacingAudit({ letterSpacing: 0.02, wordSpacing: 0.05, lineHeight: 1.1, paragraphSpacing: 0.5 }).pass === false },
  { id: 'fk-deterministic', name: 'Readability estimates are deterministic and bounded',
    run: () => {
      const text = 'The cat sat on the mat today.';
      const first = readability(text), second = readability(text);
      return first.fk === second.fk && first.fk >= 0 && readability('').fk === null;
    } },
  { id: 'smog-window', name: 'SMOG stays silent below its 30-sentence window',
    run: () => readability('Very short. '.repeat(29).trim()).smog === null
      && readability('Education helps. '.repeat(30).trim()).smog > 8 },
  { id: 'fog-equation', name: 'Gunning Fog follows the published equation',
    run: () => {
      const stats = readability('Education helps. '.repeat(30).trim());
      return Math.abs(fogFromStats(stats) - 0.4 * (stats.words / stats.sentences + 100 * stats.polysyllables / stats.words)) < 1e-12;
    } },
  { id: 'histogram-flags', name: 'The histogram flags sentences over 25 words',
    run: () => {
      const hist = sentenceHistogram(`${'word '.repeat(20)}. ${'long '.repeat(30)}. Short one.`);
      return hist.overLimit === 1 && hist.bins.reduce((sum, bin) => sum + bin.count, 0) === hist.sentences;
    } },
  { id: 'csv-formula', name: 'CSV cells resist spreadsheet formula injection',
    run: () => csv([['=SUM(A1:A2)']]).startsWith('"' + "'") },
  { id: 'canonical-sorted', name: 'Canonical JSON sorts keys for a stable fingerprint',
    run: () => canonicalJSON({ b: 1, a: 2 }) === '{"a":2,"b":1}' },
  { id: 'certificate-verifies', name: 'A signed certificate verifies intact',
    run: () => verifyCertificate(certificateJSON(probe(), null, ISSUED)).ok === true },
  { id: 'certificate-tamper-payload', name: 'Editing the payload breaks certificate verification',
    run: () => {
      const doc = JSON.parse(certificateJSON(probe(), null, ISSUED));
      doc.payload.issued = 'tampered';
      return verifyCertificate(JSON.stringify(doc)).ok === false;
    } },
  { id: 'certificate-tamper-fp', name: 'A flipped fingerprint nibble fails verification',
    run: () => {
      const doc = JSON.parse(certificateJSON(probe(), null, ISSUED));
      doc.fingerprint = (doc.fingerprint[0] === 'a' ? 'b' : 'a') + doc.fingerprint.slice(1);
      return verifyCertificate(JSON.stringify(doc)).ok === false;
    } },
  { id: 'lens-hash', name: 'Lens hash bookmarks round-trip a preset id',
    run: () => parseLensHash(encodeLensHash('club'))?.preset === 'club' && parseLensHash('#nope=1') === null },
  { id: 'outline-nests', name: 'The reader outline nests headings by level',
    run: () => {
      const tree = semanticTree([
        { kind: 'heading', level: 1, text: 'Title', start: 0, end: 5 },
        { kind: 'paragraph', text: 'Intro text', start: 6, end: 16 },
        { kind: 'heading', level: 2, text: 'Part', start: 17, end: 21 }
      ]);
      return tree.outline.length === 1 && tree.outline[0].children.length === 2 && tree.headings === 2;
    } },
  { id: 'reading-level', name: 'The 3.1.5 signal rejects estimates above grade 9',
    run: () => readingLevelSummary([8.5, null]) === true && readingLevelSummary([8.5, 10.2]) === false },
  { id: 'nonworsening', name: 'The reading copy never adds audit findings',
    run: () => presets.every(preset => {
      const before = inspectDocument(preset.source, preset.mode);
      return buildReadingCopy(before).report.issues.length <= before.issues.length;
    }) },
  { id: 'comparator-delta', name: 'The comparator reports a real before-after delta',
    run: () => {
      const club = presets.find(p => p.id === 'club');
      const before = inspectDocument(club.source, club.mode);
      const { rows } = compareReports(before, buildReadingCopy(before).report);
      const fk = rows.find(row => row.key === 'fk');
      return rows.length >= 8 && typeof fk.delta === 'number' && fk.delta < 0;
    } }
];

export function runSelfTests() {
  return selfTests.map(({ id, name, run }) => {
    try {
      return { id, name, pass: run() === true };
    } catch (err) {
      return { id, name, pass: false, detail: err.message };
    }
  });
}
