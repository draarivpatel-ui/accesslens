import { words } from './nlp.js';

export function sourceSpan(map, start, end) {
  if (start === end || !map) return { sourceStart: start, sourceEnd: end };
  return { sourceStart: map.starts[start] ?? 0, sourceEnd: map.ends[end - 1] ?? 0 };
}

export function makeCards(ranked, terms, map) {
  const cards = [];
  const used = new Set();
  for (const line of ranked) {
    if (cards.length >= 8) break;
    const tokens = words(line.text);
    if (tokens.length < 4) continue;
    const inLine = terms.filter(term => term.start >= line.start && term.end <= line.end);
    const term = inLine.find(t => t.explanation && !used.has(t.text.toLowerCase()));
    const anchor = term ?? [...tokens].filter(w => w.text.length >= 4 && !/^\d+$/.test(w.text))
      .sort((a, b) => b.text.length - a.text.length || a.start - b.start)[0];
    if (!anchor) continue;
    const offset = term ? term.start - line.start : anchor.start;
    const front = line.text.slice(0, offset) + '[...]' + line.text.slice(offset + anchor.text.length);
    if (!used.has(front)) {
      cards.push({kind: 'cloze', front, back: anchor.text, ...sourceSpan(map, line.start, line.end)});
      used.add(front);
    }
    if (term && cards.length < 8) {
      cards.push({kind: 'concept', front: `What does ${term.text} mean here?`, back: term.explanation,
        ...sourceSpan(map, term.start, term.end)});
      used.add(term.text.toLowerCase());
    }
  }
  return cards;
}

export function sm2(prior, grade, now = new Date()) {
  if (!Number.isInteger(grade) || grade < 0 || grade > 5) throw new RangeError('Rate the card from 0 to 5.');
  const state = prior ?? { repetitions: 0, interval: 0, ease: 2.5 };
  const ease = Math.max(1.3, state.ease + 0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02));
  const repetitions = grade < 3 ? 0 : state.repetitions + 1;
  const interval = repetitions <= 1 ? 1 : repetitions === 2 ? 6 : Math.max(1, Math.round(state.interval * state.ease));
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() + interval);
  return { repetitions, interval, ease, due: date.toISOString().slice(0, 10) };
}
