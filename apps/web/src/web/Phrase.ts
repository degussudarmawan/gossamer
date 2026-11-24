import type { InkLine, InkPoint } from '../lib/ink';
import { TextRuler } from '../lib/TextRuler';

// What one strand of the web carries for one message: typed words in the web's
// font, or the writer's own handwriting. WebLayout places both by the same rules
// (sizes, running off the screen, wrapping, cutting short, the "·" between two
// messages on one strand) by asking a Phrase how wide it is and for parts of it.
// Only drawing them differs: typed words go along a <textPath>, handwriting is
// bent along the strand (WebLayout.runsFor).

export type Weight = 400 | 500;

export interface Phrase {
  /** The words as written along the strand. Empty for handwriting, which is drawn instead. */
  readonly text: string;
  /** How many words it has, for breaking it between two lines or cutting it after a word. */
  readonly words: number;
  /** How much of the message it holds, to compare a shortened one with the whole. */
  readonly amount: number;
  /** Width in px at letter size `size`, with `track` ems between letters (handwriting keeps its own spacing). */
  width(size: number, weight: Weight, track: number): number;
  /** Words `i` to `j` (not including `j`). */
  slice(i: number, j: number): Phrase;
  /** Ended with "…", to show it was cut short; `trim` first drops a trailing comma, full stop or the like. */
  ellipsis(trim?: boolean): Phrase;
  /** With the "·" that follows the message before it on the strand: before its words, or after them (`after`) on a strand read inward. */
  dotted(after: boolean): Phrase;
  /** A little shorter, cut inside its words (for one word too long for any strand), or null when it can't be. */
  shorter(): Phrase | null;
  /** Handwriting only: its strokes at a letter size (see InkShape). */
  ink?(size: number): InkShape;
}

/**
 * Handwriting laid out flat at a letter size, in px: x along the strand from where it
 * starts, y off the strand (positive toward the letters' feet). WebLayout bends it
 * onto the strand.
 */
export type InkShape = {
  strokes: InkPoint[][];
  dots: InkPoint[];
  pen: number;
  dot: number;
  /** How far the ink goes from the strand, either way, pen included. */
  reach: number;
};

const FONT = 'Quicksand Variable';
const rulers = { 400: new TextRuler(FONT, 400), 500: new TextRuler(FONT, 500) };
const chars = (t: string) => [...t].length;
/** Width of `text` in ems, in the web's font. */
export const ems = (text: string, weight: Weight) => rulers[weight].widthInEms(text);

/** Typed words: exactly the string handling the web has always had. */
export class TextPhrase implements Phrase {
  constructor(readonly text: string) {}

  get words() {
    return this.text.split(' ').length;
  }

  get amount() {
    return chars(this.text);
  }

  width(size: number, weight: Weight, track: number) {
    return (ems(this.text, weight) + track * (chars(this.text) - 1)) * size;
  }

  slice(i: number, j: number) {
    return new TextPhrase(this.text.split(' ').slice(i, j).join(' '));
  }

  ellipsis(trim = false) {
    return new TextPhrase(`${trim ? this.text.replace(/[\s,.;:!?-]+$/, '') : this.text}…`);
  }

  dotted(after: boolean) {
    return new TextPhrase(after ? `${this.text} ·` : `· ${this.text}`);
  }

  shorter() {
    return this.text.length > 1 ? new TextPhrase(this.text.slice(0, -1)) : null;
  }
}

/** How handwriting is sized against typed letters. All in letter sizes (the strand's font size). */
const INK = {
  /**
   * The writer's small letters (a, e, o) are drawn this tall, about as tall as the typed
   * small letters, so every hand reads about as large as the typed words however big it
   * was written on the pad.
   */
  small: 0.5,
  /**
   * How far the writing may reach above or below the strand (a tall h, a long tail)
   * before the whole note is drawn smaller. The reveal widens to match (RoomWeb).
   */
  reach: 1.6,
  /** The pen: one thickness for every note, a little finer than the typed letters. */
  pen: 0.055,
  /** The "·" between two messages: its width, and the space between it and the writing. */
  dot: 0.12,
  dotSpace: 0.35,
  /** The "…" of a note cut short: space before it, then three dots this far apart. */
  ellipsisSpace: 0.15,
  ellipsisStep: 0.15,
  /** Radius of a mark's dot. */
  mark: 0.035,
  /** Where the "…" sits below the middle of the writing (on about its baseline). */
  baseline: 0.2,
};

type Marks = { dot?: 'before' | 'after'; ellipsis?: boolean };

/**
 * Words of a handwritten note, along one line (see unwrap in lib/ink.ts). Its width
 * at a letter size is fixed, since handwriting can't be letter-spaced: the writer's
 * small letters are drawn INK.small letter sizes tall, smaller only if a stroke would
 * reach more than INK.reach above or below the strand.
 */
export class InkPhrase implements Phrase {
  readonly text = '';

  constructor(
    private readonly line: InkLine,
    private readonly from = 0,
    private readonly to = line.words.length,
    /** How much of the words shows, in lines from their start, once cut inside a word. */
    private readonly upTo = Infinity,
    private readonly marks: Marks = {},
  ) {}

  private with(changes: { from?: number; to?: number; upTo?: number; marks?: Marks }) {
    return new InkPhrase(
      this.line,
      changes.from ?? this.from,
      changes.to ?? this.to,
      changes.upTo ?? this.upTo,
      changes.marks ?? this.marks,
    );
  }

  /** Letter sizes per line of the pad: how much the writing is scaled. */
  private get scale() {
    const { small, above, below } = this.line;
    return Math.min(INK.small / Math.max(small, 1e-6), INK.reach / Math.max(above, below, 1e-6));
  }

  /** Where its words start, and how far they go, in lines. */
  private get start() {
    return this.line.words[this.from]?.from ?? 0;
  }

  private get span() {
    const last = this.line.words[this.to - 1];
    return last ? Math.min(this.upTo, last.to - this.start) : 0;
  }

  private get before() {
    return this.marks.dot === 'before' ? INK.dot + INK.dotSpace : 0;
  }

  private get after() {
    return (
      (this.marks.dot === 'after' ? INK.dotSpace + INK.dot : 0) +
      (this.marks.ellipsis ? INK.ellipsisSpace + 2 * INK.ellipsisStep + INK.dot : 0)
    );
  }

  get words() {
    return this.to - this.from;
  }

  get amount() {
    return this.span * this.scale + (this.marks.ellipsis ? INK.dot : 0);
  }

  /** The marks (before, after) are in letter sizes; the writing is in lines, scaled. */
  width(size: number) {
    return (this.before + this.span * this.scale + this.after) * size;
  }

  slice(i: number, j: number) {
    return this.with({ from: this.from + i, to: this.from + j, upTo: Infinity, marks: {} });
  }

  ellipsis() {
    return this.with({ marks: { ...this.marks, ellipsis: true } });
  }

  dotted(after: boolean) {
    return this.with({ marks: { ...this.marks, dot: after ? 'after' : 'before' } });
  }

  shorter() {
    // a tenth of a line at a time, never down to nothing
    const next = this.span - 0.1;
    return next > 0.3 ? this.with({ upTo: next }) : null;
  }

  ink(size: number): InkShape {
    // px per line of the pad
    const px = this.scale * size;
    const start = this.before * size;
    const end = this.start + this.span;
    const strokes: InkPoint[][] = [];
    for (const word of this.line.words.slice(this.from, this.to)) {
      for (const stroke of word.strokes) {
        // past where a cut inside a word falls, the stroke is left out, and a stroke
        // crossing it is broken there
        let piece: InkPoint[] = [];
        for (const p of stroke) {
          if (p.x > end + 1e-9) {
            if (piece.length) strokes.push(piece);
            piece = [];
            continue;
          }
          piece.push({ x: start + (p.x - this.start) * px, y: p.y * px });
        }
        if (piece.length) strokes.push(piece);
      }
    }
    // the marks, in letter sizes
    const dots: InkPoint[] = [];
    const markAt = (x: number, y: number) => dots.push({ x: x * size, y: y * size });
    if (this.marks.dot === 'before') markAt(INK.dot / 2, 0);
    let x = this.before + this.span * this.scale;
    if (this.marks.dot === 'after') {
      markAt(x + INK.dotSpace + INK.dot / 2, 0);
      x += INK.dotSpace + INK.dot;
    }
    if (this.marks.ellipsis) {
      for (let k = 0; k < 3; k++) markAt(x + INK.ellipsisSpace + INK.dot / 2 + k * INK.ellipsisStep, INK.baseline);
    }
    const reach = Math.max(this.line.above, this.line.below) * px + INK.pen * size;
    return { strokes, dots, pen: INK.pen * size, dot: INK.mark * size, reach };
  }
}
