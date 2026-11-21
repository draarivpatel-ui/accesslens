# AccessLens design system

Mode: Operate. The visitor is at a desk doing a task: paste a document, read a verdict, compare an edit, build a deck. Familiarity and precision outrank expression; the world carries the surface through materials, not decoration.

## World

An editorial proofreading desk. Warm ruled paper under dense ink, petrol blue for structure and actions, acid yellow used the way a highlighter is used: sparingly, on the thing being marked. The small lens-and-check linework mark is the only icon; it appears at the brand and beside the readout, the two places the tool inspects the page.

## Palette

| Token | Value | Job |
| --- | --- | --- |
| `--paper` | `#f7f4eb` | page ground, ruled stock |
| `--paper-raised` | `#fbf9f1` | cards, papers, fields |
| `--ink` | `#14232b` | text, strong rules, mark linework |
| `--petrol` | `#174962` | actions, links, badges, section labels, status |
| `--petrol-deep` | `#0e3547` | pressed state on primary |
| `--acid` | `#e9ef74` | highlighter only: selection, checked example chip, the ruled line in the mark |
| `--brick` | `#8f2f1f` | errors and over-limit warnings only |
| `--muted` | `#41535c` | secondary text on paper |

Strategy: Restrained. Neutral paper and ink with petrol doing the work; acid is a marker, not a field.

## Type

- Display and long-form reading: `Iowan Old Style`, then Georgia. Document text, paper columns, flashcards and headings are set in the serif because the product is about prose.
- UI labels, controls, hints: Verdana at a tight scale; the smallest functional text is 0.75 rem and visual micro-labels (badges, section eyebrows, offsets) floor at 0.8 rem.
- Mono (`ui-monospace` stack) only for measurement: stat values, source offsets, `kbd`.

## Composition

- Top utility line: brand mark left, section jump links right. The `h1` stands alone; no kicker, no helper line.
- Desktop: a two-column desk, Source (3fr) beside the Analysis board (2fr), so the readout sits level with the editor it describes.
- Below the desk: Comparison as two ruled paper columns (Original against Reading copy), then the Study deck, then Help as a single `details`.
- Mobile (under 920 px): one column; controls wrap; papers stack; nothing scrolls sideways.

## Materials

- Paper columns carry real ruled lines (`repeating-linear-gradient` at the text line-height, `1lh`-aligned via `--rule-gap`) and a petrol margin rule, like a proof sheet.
- The editor textarea is itself ruled stock; the caret is petrol and selection renders as an acid highlight.
- Cards and fields are flat paper with hairline ink rules. Depth comes from paper layers, not shadows.

## Motion and chrome

- One brief reveal on `h1` and the desk, gated behind `prefers-reduced-motion: no-preference`. No other animation, no smooth scrolling.
- Browser chrome is themed: acid `::selection`, petrol caret, thin petrol scrollbars, petrol `:focus-visible` ring (2.5 px, offset).

## Controls and states

- One primary action (`Run checks`, petrol fill); everything else is a petrol outline. Disabled state is a faded hairline, never a hidden control.
- Examples are real radio inputs inside a fieldset, styled as chips; the checked chip is the acid highlight.
- Idle states are serif italic lines that teach the next step; `role="status"` announces every run, repair, grade and export.
- Errors are explicit text in the status strip (`--brick`), naming the failure and the next step.

## Invariants

- No hero, no emojis, no long dashes in copy, no network fonts, no external requests.
- No `innerHTML`; DOM is built from fixed tags with `textContent`. `copy.html` is exported for download only, never rendered into the page.
- Interactive targets stay at least 24 px tall; every control is a native element.
