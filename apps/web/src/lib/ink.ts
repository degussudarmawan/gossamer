// A handwritten note: the writer's pen strokes, kept as they were drawn on a ruled
// pad. No React in here. The format is the contract with the backend, described in
// docs/handoffs/handwritten-notes-api.md; the backend stores it as it comes.
//
// Every number is in hundredths of one ruled line's height, so a note keeps its
// shape whatever size it is drawn at: on the pad, in the list, or along a strand
// of the room's web (see web/Phrase.ts).

export type Ink = {
  v: 1;
  /** Ruled lines on the pad. */
  lines: number;
  /** How wide the pad was. */
  width: number;
  /** One flat [x0, y0, x1, y1, …] list per pen stroke, pen down to pen up. */
  strokes: number[][];
};

export type InkPoint = { x: number; y: number };

/** One ruled line, in ink units. */
export const LINE = 100;

/** What the backend accepts. The pad never makes anything outside these. */
export const INK_LIMITS = {
  lines: 3,
  width: { min: 100, max: 2000 },
  strokes: 400,
  /** Numbers in one stroke (two per point). */
  perStroke: 2000,
  /** Numbers in all the strokes together. */
  numbers: 8000,
} as const;

/** How thick the pen is, in lines. The same everywhere a note is drawn. */
export const PEN = 0.05;

const isWhole = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** Whether a value is ink the screens can draw. Anything else from the server is ignored. */
export function isInk(value: unknown): value is Ink {
  if (typeof value !== 'object' || value === null) return false;
  const ink = value as Partial<Ink>;
  if (ink.v !== 1 || !isWhole(ink.lines, 1, INK_LIMITS.lines)) return false;
  if (!isWhole(ink.width, INK_LIMITS.width.min, INK_LIMITS.width.max)) return false;
  const { strokes } = ink;
  if (!Array.isArray(strokes) || strokes.length < 1 || strokes.length > INK_LIMITS.strokes) return false;
  let total = 0;
  const bottom = ink.lines * LINE;
  for (const stroke of strokes) {
    if (!Array.isArray(stroke) || stroke.length < 2 || stroke.length > INK_LIMITS.perStroke || stroke.length % 2) return false;
    total += stroke.length;
    for (let i = 0; i < stroke.length; i += 2) {
      if (!isWhole(stroke[i], 0, ink.width) || !isWhole(stroke[i + 1], 0, bottom)) return false;
    }
  }
  return total <= INK_LIMITS.numbers;
}

/** How many numbers a set of strokes takes, to keep within INK_LIMITS. */
export const inkSize = (strokes: readonly number[][]) => strokes.reduce((n, s) => n + s.length, 0);

/** A stroke's points, from its flat list. */
export function pointsOf(stroke: readonly number[]): InkPoint[] {
  const points: InkPoint[] = [];
  for (let i = 0; i + 1 < stroke.length; i += 2) points.push({ x: stroke[i]!, y: stroke[i + 1]! });
  return points;
}

/** How far `p` is from the segment a–b. */
function offSegment(p: InkPoint, a: InkPoint, b: InkPoint) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * A finished stroke, ready to keep: fewer points where the line is nearly straight
 * (Ramer–Douglas–Peucker, `tolerance` units), whole numbers, as a flat list, split
 * into pieces if it is still longer than one stroke may be. A tap becomes a dot.
 */
export function finishStroke(points: readonly InkPoint[], tolerance = 1.5): number[][] {
  if (points.length === 0) return [];
  const keep = Array.from({ length: points.length }, () => false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [from, to] = stack.pop()!;
    let far = -1;
    let most = tolerance;
    for (let i = from + 1; i < to; i++) {
      const d = offSegment(points[i]!, points[from]!, points[to]!);
      if (d > most) {
        most = d;
        far = i;
      }
    }
    if (far > 0) {
      keep[far] = true;
      stack.push([from, far], [far, to]);
    }
  }
  const flat: number[] = [];
  points.forEach((p, i) => {
    if (!keep[i]) return;
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    if (flat.length && flat[flat.length - 2] === x && flat[flat.length - 1] === y) return;
    flat.push(x, y);
  });
  // a tap: one point, kept as two so it is still a stroke
  if (flat.length === 2) flat.push(flat[0]!, flat[1]!);
  const pieces: number[][] = [];
  const most = INK_LIMITS.perStroke;
  // each piece starts where the last one ended, so the line doesn't break
  for (let i = 0; i < flat.length - 2 || pieces.length === 0; i += most - 2) pieces.push(flat.slice(i, i + most));
  return pieces;
}

const num = (v: number, places: number) => +v.toFixed(places);

/**
 * An SVG path through a stroke's points, smoothed by curving through the middle of
 * each segment. A stroke that stays on one spot is a dot (a round-capped line too
 * short to see), so taps show.
 */
export function smoothPath(points: readonly InkPoint[], places = 2): string {
  const f = (p: InkPoint) => `${num(p.x, places)} ${num(p.y, places)}`;
  const first = points[0];
  if (!first) return '';
  const moves = points.some((p) => p.x !== first.x || p.y !== first.y);
  if (!moves) return `M${f(first)}h0.01`;
  if (points.length === 2) return `M${f(first)}L${f(points[1]!)}`;
  let d = `M${f(first)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    const q = points[i + 1]!;
    d += `Q${f(p)} ${f({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 })}`;
  }
  return `${d}L${f(points[points.length - 1]!)}`;
}

/** A round dot centred on `p`, as an SVG subpath (drawn with the pen, it is filled in). */
export const dotPath = (p: InkPoint, r: number, places = 2) =>
  `M${num(p.x - r, places)} ${num(p.y, places)}a${num(r, places)} ${num(r, places)} 0 1 0 ${num(2 * r, places)} 0a${num(r, places)} ${num(r, places)} 0 1 0 ${num(-2 * r, places)} 0`;

/** A word of handwriting along an unwrapped line: where it starts and ends, and its strokes. */
export type InkWord = { from: number; to: number; strokes: InkPoint[][] };

/**
 * A note's handwriting as one line, the way it goes along a strand of the web. All
 * in lines (1 = one ruled line's height): x from 0 along the line, y from the middle
 * of its ordinary letters (negative is up).
 */
export type InkLine = {
  words: InkWord[];
  /**
   * How tall the writer's small letters are (a, e, o, w): how big they write. The web
   * sizes every note by this, so writing big or small on the pad comes out about the
   * same size, whatever letters the note happens to have.
   */
  small: number;
  /** How far the writing reaches above and below its middle. */
  above: number;
  below: number;
};

/** Strokes smaller than this (in lines) both ways are dots: they don't say how big someone writes. */
const DOT = 0.12;
/** Space put between the pad's rows of writing when they are joined into one, in small letters. */
const JOIN = 1;
/** A gap at least this wide (in small letters) between strokes is taken as a space between words. */
const WORD_GAP = 0.6;
/** Rows of writing are at least this far apart (in median strokes, and never less than ROW_MIN lines). */
const ROW_GAP = 0.6;
const ROW_MIN = 0.35;

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/**
 * The pad's rows of writing joined end to end into one. Rows are found from the writing
 * itself, not from the ruled lines, since people write across them: strokes whose middles
 * sit close together up and down are one row, and a dot goes with the row it is nearest.
 * Each row is lifted or lowered so its ordinary letters sit on one shared middle, and the
 * rows follow each other left to right with a space between.
 */
export function unwrap(ink: Ink): InkLine {
  type Placed = { points: InkPoint[]; minX: number; maxX: number; minY: number; maxY: number; mid: number; dot: boolean };
  const placed: Placed[] = ink.strokes.map((s) => {
    const points = pointsOf(s).map((p) => ({ x: p.x / LINE, y: p.y / LINE }));
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    return { points, minX, maxX, minY, maxY, mid: (minY + maxY) / 2, dot: maxX - minX < DOT && maxY - minY < DOT };
  });
  if (placed.length === 0) return { words: [], small: 1, above: 0, below: 0 };

  // How tall strokes are. Dots and flat strokes (a t's cross) say nothing about it. The
  // small letters are the shorter strokes: a quarter of the way up the heights, leaving
  // out slivers under a third of the median.
  const heights = placed.map((p) => p.maxY - p.minY).filter((h) => h >= DOT);
  const typical = heights.length ? median(heights) : DOT;
  const letters = heights.filter((h) => h >= 0.3 * typical).sort((a, b) => a - b);
  const small = letters.length ? letters[Math.floor(0.25 * letters.length)]! : typical;

  // rows: strokes sorted by their middles, split wherever two middles are far apart
  const body = placed.filter((p) => !p.dot);
  const sorted = [...(body.length ? body : placed)].sort((p, q) => p.mid - q.mid);
  const split = Math.max(ROW_MIN, ROW_GAP * typical);
  const rows: Placed[][] = [];
  sorted.forEach((p, i) => {
    if (i === 0 || p.mid - sorted[i - 1]!.mid > split) rows.push([]);
    rows[rows.length - 1]!.push(p);
  });
  // each dot joins the row whose writing it is nearest, up and down
  for (const dot of body.length ? placed.filter((p) => p.dot) : []) {
    const away = (row: Placed[]) => {
      const top = Math.min(...row.map((p) => p.minY));
      const bottom = Math.max(...row.map((p) => p.maxY));
      return dot.mid < top ? top - dot.mid : dot.mid > bottom ? dot.mid - bottom : 0;
    };
    rows.reduce((best, row) => (away(row) < away(best) ? row : best)).push(dot);
  }

  // the rows end to end, each on a shared middle: the middle of its ordinary strokes
  const strokes: { points: InkPoint[]; minX: number; maxX: number }[] = [];
  let cursor = 0;
  for (const row of rows) {
    const ordinary = row.filter((p) => p.maxY - p.minY >= DOT);
    const middle = median((ordinary.length ? ordinary : row).map((p) => p.mid));
    const left = Math.min(...row.map((p) => p.minX));
    const dx = (strokes.length ? cursor + JOIN * small : 0) - left;
    for (const p of row) {
      strokes.push({ points: p.points.map((q) => ({ x: q.x + dx, y: q.y - middle })), minX: p.minX + dx, maxX: p.maxX + dx });
    }
    cursor = Math.max(...row.map((p) => p.maxX)) + dx;
  }
  strokes.sort((p, q) => p.minX - q.minX);
  const ys = strokes.flatMap((s) => s.points.map((p) => p.y));

  // words: strokes whose spans along the line overlap or nearly touch
  const words: InkWord[] = [];
  for (const s of strokes) {
    const last = words[words.length - 1];
    if (last && s.minX - last.to < WORD_GAP * small) {
      last.to = Math.max(last.to, s.maxX);
      last.strokes.push(s.points);
    } else {
      words.push({ from: s.minX, to: s.maxX, strokes: [s.points] });
    }
  }
  return { words, small, above: Math.max(0, -Math.min(...ys)), below: Math.max(0, Math.max(...ys)) };
}
