import { ringPoint } from '../components/OrbitSpider';
import { TextRuler } from '../lib/TextRuler';

// Where every message goes in a room's web. No React in here: given a screen
// size, the room's seed and its messages, this works out the geometry, and
// components/RoomWeb.tsx draws it.
//
// The web is an orb web, and there is no silk in it except words:
//   - radial threads: sentences running straight out from the hub (the ring
//     round the room's title) toward the edge of the web
//   - the spiral: one continuous strand of sentences winding outward across
//     the radials, sagging a little between each pair like real silk
//
// It is built the way an orb weaver builds: the first messages become the
// radials, spread round the hub; after that, messages go onto the spiral. The
// spiral only ever crosses radials that already reach that far, so whenever it
// needs one to be longer, the next message extends that radial outward
// instead. The web therefore grows from the middle as messages arrive, and is
// always one connected web, never loose arcs.
//
// Everything comes from the room's seed and the messages in order, so every
// member sees the same web, and a new message never moves the ones before it
// (unless the web is full and has to be written smaller).

export type Point = { x: number; y: number };

export type Thread = {
  id: string;
  /** The words drawn: the message, shortened if it is long. */
  text: string;
  /** The line the words follow, in reading order. */
  points: Point[];
  d: string;
  size: number;
  /** Radials are the web's frame; the spiral is the finer silk between them. */
  kind: 'radial' | 'spiral';
};

/** The ring in the middle that holds the room's title. */
export type Hub = { cx: number; cy: number; rx: number; ry: number };

type Msg = { id: string; position: number; body: string };

const FONT = 'Quicksand Variable';
export const WEIGHT = { radial: 500, spiral: 400 } as const;
/** Extra space between letters, in ems: the airy, spread-out look of the landing page. */
export const LETTER_SPACING = 0.05;
const rulers = { radial: new TextRuler(FONT, WEIGHT.radial), spiral: new TextRuler(FONT, WEIGHT.spiral) };

/** Width in pixels of a piece of text drawn on a strand. */
const measure = (kind: Thread['kind'], text: string, size: number) =>
  (rulers[kind].widthInEms(text) + LETTER_SPACING * text.length) * size;

/**
 * Letter sizes to try, largest first. A room with a few messages is written
 * as large as the landing page; the letters only get smaller as the web
 * fills up and needs the room.
 */
const SIZES = {
  wide: [30, 28, 26, 24, 22, 20, 18, 17, 16, 15, 14, 13, 12],
  narrow: [20, 19, 18, 17, 16, 15, 14, 13, 12, 11],
};
/** Messages are cut to this many characters at most on the web; the full text is in the list. */
const MAX_CHARS = 60;
/**
 * A size is only used if no message has to be cut shorter than this. At the
 * smallest size, cuts may go down to SMALLEST_CUT so everything still shows.
 */
const SHORTEST_CUT = 26;
const SMALLEST_CUT = 14;

/** Space kept free of the web for the header (top) and buttons (bottom). */
const KEEP_CLEAR = { top: 84, bottom: 104, side: 18 };

// Small seeded generator: the same seed always gives the same numbers.
function seeded(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
const distance = (p: Point, q: Point) => Math.hypot(q.x - p.x, q.y - p.y);
const pathOf = (points: Point[]) =>
  points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('');

/** The point a fraction `u` (0 to 1) of the way along a line of points. */
export function pointAlong(points: Point[], u: number): Point {
  const strand = new Strand(points);
  return strand.pointAt(clamp(u, 0, 1) * strand.length);
}

/** One message on one line, cut at a word and ended with … if it runs past `maxChars`. */
function shorten(body: string, maxChars: number): string {
  const line = body.replace(/\s+/g, ' ').trim();
  if (line.length <= maxChars) return line;
  const cut = line.slice(0, maxChars);
  const space = cut.lastIndexOf(' ');
  return `${(space > maxChars / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:!?-]+$/, '')}…`;
}

/** A line of points that text can be written along, measured by distance. */
class Strand {
  /** Distance from the start to each point. */
  readonly cum: number[] = [0];

  constructor(readonly points: Point[]) {
    for (let i = 1; i < points.length; i++) this.cum.push(this.cum[i - 1]! + distance(points[i - 1]!, points[i]!));
  }

  get length() {
    return this.cum[this.cum.length - 1]!;
  }

  /** Index of the last point at or before distance `s`. */
  private indexAt(s: number) {
    let lo = 0;
    let hi = this.points.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid]! <= s) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  pointAt(s: number): Point {
    if (this.points.length === 1) return this.points[0]!;
    const i = this.indexAt(s);
    const a = this.points[i]!;
    const b = this.points[i + 1] ?? a;
    const step = this.cum[i + 1]! - this.cum[i]! || 1;
    const t = clamp((s - this.cum[i]!) / step, 0, 1);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  /** The stretch between two distances, following every bend in between. */
  slice(from: number, to: number): Point[] {
    const out = [this.pointAt(from)];
    for (let i = this.indexAt(from) + 1; i < this.points.length && this.cum[i]! < to; i++) out.push(this.points[i]!);
    out.push(this.pointAt(to));
    return out;
  }
}

/** Where the spiral crosses a radial: which radial, how far along the spiral, how far out along the radial. */
type Crossing = { radial: number; s: number; reach: number };

export class WebLayout {
  readonly wide: boolean;
  readonly hub: Hub;
  /** One per message on the web, in the order they were written. */
  readonly threads: Thread[];
  /** How many of the earliest messages didn't fit (they are still in the full list). */
  readonly hidden: number;

  private readonly angles: number[];
  private readonly radials: Strand[];
  private readonly wobble: [number, number, number];

  /** The hub for a screen. The room screen uses it to place the title inside. */
  static hubFor(width: number, height: number): Hub {
    const top = KEEP_CLEAR.top;
    const bottom = height - KEEP_CLEAR.bottom;
    // The landing page's ring on wide screens. A phone is too narrow for that
    // and still have silk beside it, so there the ring is small and round.
    const wide = width >= 1024;
    const small = Math.min(width * 0.19, 80);
    return {
      cx: width / 2,
      cy: (top + bottom) / 2,
      rx: wide ? Math.min(width * 0.4, 250) : small,
      ry: wide ? Math.min(height * 0.18, 145) : small,
    };
  }

  /** Letter size for a title so its longest word fits inside the ring, never above `max`. */
  static titleSize(title: string, hub: Hub, max: number): number {
    const widest = Math.max(...title.split(/\s+/).map((word) => rulers.spiral.widthInEms(word)), 0.1);
    return Math.max(12, Math.min(max, (hub.rx * 1.45) / widest));
  }

  constructor(
    readonly width: number,
    readonly height: number,
    readonly seed: number,
    messages: readonly Msg[],
  ) {
    this.wide = width >= 1024;
    this.hub = WebLayout.hubFor(width, height);

    // the web's outline and its radials come from the seed alone
    const rnd = seeded(seed);
    this.wobble = [rnd() * TAU, rnd() * TAU, rnd() * TAU];
    // fewer, longer spokes than a dense real web, as in the design study: more room for the silk between them
    const count = this.wide ? 8 + Math.floor(rnd() * 3) : 7 + Math.floor(rnd() * 2);
    const turn = rnd() * TAU;
    // unevenly spaced, like a hand-built web, but never two radials almost on top of each other
    this.angles = Array.from({ length: count }, (_, i) => turn + ((i + (rnd() - 0.5) * 0.55) / count) * TAU);
    const { cx, cy } = this.hub;
    this.radials = this.angles.map((a) => {
      const dir = { x: Math.cos(a), y: Math.sin(a) };
      const out = this.edge(a);
      const start = this.hubRadius(a) + 3;
      return new Strand([
        { x: cx + dir.x * start, y: cy + dir.y * start },
        { x: cx + dir.x * out, y: cy + dir.y * out },
      ]);
    });

    const ordered = [...messages].sort((p, q) => p.position - q.position);
    // Write as large as the web allows. If even the smallest size can't hold
    // every message, show the most recent ones that fit.
    const sizes = this.wide ? SIZES.wide : SIZES.narrow;
    const smallest = sizes[sizes.length - 1]!;
    let threads: Thread[] | null = null;
    for (const size of sizes) {
      threads = this.weave(ordered, size, size === smallest ? SMALLEST_CUT : SHORTEST_CUT);
      if (threads) break;
    }
    let hidden = 0;
    if (!threads) {
      let fit = 0;
      let best: Thread[] = [];
      let tooMany = ordered.length;
      while (tooMany - fit > 1) {
        const tryCount = (fit + tooMany) >> 1;
        const attempt = this.weave(ordered.slice(-tryCount), smallest, SMALLEST_CUT);
        if (attempt) [fit, best] = [tryCount, attempt];
        else tooMany = tryCount;
      }
      threads = best;
      hidden = ordered.length - fit;
    }
    this.threads = threads;
    this.hidden = hidden;
  }

  /**
   * Distance from the hub's centre to the edge of the web in a direction: an
   * oval that fills the free part of the screen, made irregular so the outline
   * looks spun rather than drawn with a compass.
   */
  private edge(angle: number): number {
    const { cx, cy } = this.hub;
    const halfWidth = cx - KEEP_CLEAR.side;
    const halfHeight = cy - KEEP_CLEAR.top;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    // the whole free screen, as on the landing page, where strands run right out to the edges
    const oval = 1 / Math.hypot(c / halfWidth, s / halfHeight);
    const [p1, p2, p3] = this.wobble;
    const uneven = 1 + 0.06 * Math.sin(2 * angle + p1) + 0.045 * Math.sin(3 * angle + p2) + 0.03 * Math.sin(5 * angle + p3);
    const box = Math.min(halfWidth / Math.abs(c || 1e-9), halfHeight / Math.abs(s || 1e-9));
    return Math.max(this.hubRadius(angle) + 40, Math.min(oval * uneven, box));
  }

  /** Distance from the centre to the drawn hub ring in a direction. */
  private hubRadius(angle: number): number {
    const { rx, ry } = this.hub;
    const p = ringPoint(Math.atan2(Math.sin(angle) / ry, Math.cos(angle) / rx), rx, ry);
    return Math.hypot(p.x, p.y);
  }

  /**
   * The spiral for a given letter size: one strand winding outward from just
   * outside the hub, crossing every radial on every turn. Turns are spaced
   * generously, a little unevenly. Between radials each stretch curves round
   * the hub like a ring of the web, then sags a little, by a different amount
   * each time, so no two stretches have quite the same curve.
   */
  private spiral(size: number): { strand: Strand; crossings: Crossing[] } {
    const rnd = seeded(this.seed ^ 0x2545f491);
    const { cx, cy } = this.hub;
    const count = this.angles.length;
    const span = this.angles.map((a) => this.edge(a) - this.hubRadius(a)); // hub ring to edge, per radial
    const tightest = Math.min(...span);

    // Work in fractions of each radial's length, so the spiral takes the web's oval shape.
    const newGap = () => (size * (2.7 + rnd() * 0.9)) / tightest;
    const last = 1 - (size * 1.1) / tightest;
    let u = (size * 2.6) / tightest; // the open ring between hub and spiral that real webs have
    let gap = newGap();
    const first = Math.floor(rnd() * count);

    const marks: { radial: number; angle: number; u: number; at: Point; reach: number }[] = [];
    for (let k = 0; ; k++) {
      const j = (first + k) % count;
      if (k > 0 && j === first) gap = newGap(); // each turn gets its own spacing
      const here = u + (rnd() - 0.5) * 0.16 * gap;
      if (here > last) break;
      const a = this.angles[j]! + TAU * Math.floor((first + k) / count); // keeps increasing round the turns
      const hub = this.hubRadius(a);
      const out = hub + span[j]! * here;
      marks.push({ radial: j, angle: a, u: here, at: { x: cx + Math.cos(a) * out, y: cy + Math.sin(a) * out }, reach: out - hub - 3 });
      const next = this.angles[(j + 1) % count]! + (j + 1 === count ? TAU : 0);
      u += gap * ((next - this.angles[j]!) / TAU);
    }

    const points: Point[] = marks.length ? [marks[0]!.at] : [];
    const markIndex = [0];
    for (let k = 1; k < marks.length; k++) {
      const from = marks[k - 1]!;
      const to = marks[k]!;
      const p = from.at;
      const q = to.at;
      const chord = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      // where the ring of the web would pass, halfway round between the two radials
      const midAngle = (from.angle + to.angle) / 2;
      const ringOut = this.hubRadius(midAngle) + (this.edge(midAngle) - this.hubRadius(midAngle)) * ((from.u + to.u) / 2);
      const onRing = { x: cx + Math.cos(midAngle) * ringOut, y: cy + Math.sin(midAngle) * ringOut };
      // the silk sags from that ring part of the way toward the straight line
      const slack = 0.15 + rnd() * 0.35;
      const middle = { x: onRing.x + (chord.x - onRing.x) * slack, y: onRing.y + (chord.y - onRing.y) * slack };
      // a quadratic curve through p and q whose midpoint is `middle`
      const ctrl = { x: 2 * middle.x - chord.x, y: 2 * middle.y - chord.y };
      const steps = Math.max(4, Math.ceil(distance(p, q) / 5));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const w = 1 - t;
        points.push({
          x: w * w * p.x + 2 * w * t * ctrl.x + t * t * q.x,
          y: w * w * p.y + 2 * w * t * ctrl.y + t * t * q.y,
        });
      }
      markIndex.push(points.length - 1);
    }
    const strand = new Strand(points);
    const crossings = marks.map((m, k) => ({ radial: m.radial, s: strand.cum[markIndex[k]!]!, reach: m.reach }));
    return { strand, crossings };
  }

  /**
   * Lays every message onto the web at one letter size, or returns null if
   * they don't all fit without cutting any message shorter than `shortestCut`
   * characters.
   */
  private weave(messages: Msg[], size: number, shortestCut: number): Thread[] | null {
    if (messages.length === 0) return [];
    const { strand: spiral, crossings } = this.spiral(size);
    const count = this.radials.length;
    const between = size * 1.2; // space between one message and the next on the same strand
    const pastCrossing = size; // how far a radial must reach beyond where the spiral meets it
    const start = size * 0.3;
    const filled = this.radials.map(() => start);
    let spiralFilled = 0;

    // The message as it fits into `room` pixels: whole if it can be, otherwise
    // cut at a word with …, or null if that would leave too little of it.
    const fitted = (body: string, room: number, kind: Thread['kind']): string | null => {
      const whole = shorten(body, MAX_CHARS);
      const wholeWidth = measure(kind, whole, size);
      if (wholeWidth <= room) return whole;
      const floor = Math.min(shortestCut, whole.length);
      let max = Math.floor(room / (wholeWidth / whole.length)) - 1; // first guess from the average letter
      while (max >= floor) {
        const cut = shorten(whole, max);
        if (cut.length - 1 >= floor && measure(kind, cut, size) <= room) return cut;
        max -= 2;
      }
      return null;
    };

    // The first messages start radials, spread evenly round the hub rather
    // than side by side: each one a fixed stride round from the last.
    let stride = Math.max(1, Math.round(count * 0.382));
    while (gcd(stride, count) !== 1) stride++;

    const threads: Thread[] = [];
    const write = (m: Msg, text: string, points: Point[], kind: Thread['kind']) => {
      // always readable left to right, so no message hangs upside down
      if (points[points.length - 1]!.x < points[0]!.x) points.reverse();
      threads.push({ id: m.id, text, points, d: pathOf(points), size, kind });
    };
    const onRadial = (m: Msg, j: number): boolean => {
      const text = fitted(m.body, this.radials[j]!.length - filled[j]!, 'radial');
      if (!text) return false;
      const width = measure('radial', text, size);
      write(m, text, this.radials[j]!.slice(filled[j]!, filled[j]! + width), 'radial');
      filled[j]! += width + between;
      return true;
    };
    const canExtend = (m: Msg, j: number) => fitted(m.body, this.radials[j]!.length - filled[j]!, 'radial') !== null;
    const shortestFirst = (js: number[]) => [...js].sort((a, b) => filled[a]! - filled[b]!);

    for (const [n, m] of messages.entries()) {
      // The spider spins the radials first. If this message won't fit on any
      // unused radial, the letters are too big: try a smaller size. Only at
      // the smallest size may an early message go to the spiral instead.
      if (n < count) {
        const unused = Array.from({ length: count }, (_, k) => ((n + k) * stride) % count).filter(
          (j) => filled[j] === start && canExtend(m, j),
        );
        // of the radials it fits, take the one furthest round from those already spun, so a young web stays balanced
        const used = this.radials.map((_, j) => j).filter((j) => filled[j] !== start);
        const apart = (j: number) =>
          Math.min(
            Infinity,
            ...used.map((k) => {
              const d = Math.abs(this.angles[j]! - this.angles[k]!) % TAU;
              return Math.min(d, TAU - d);
            }),
          );
        const best = unused.reduce<number | null>((a, j) => (a === null || apart(j) > apart(a) ? j : a), null);
        if (best !== null && onRadial(m, best)) continue;
        if (shortestCut !== SMALLEST_CUT) return null;
      }

      const text = fitted(m.body, spiral.length - spiralFilled, 'spiral');
      if (text) {
        const width = measure('spiral', text, size);
        // radials this stretch of spiral would cross that don't yet reach it, and could
        const short: number[] = [];
        for (const c of crossings) {
          if (c.s < spiralFilled - between) continue;
          if (c.s > spiralFilled + width + between) break;
          if (filled[c.radial]! < c.reach + pastCrossing && canExtend(m, c.radial)) short.push(c.radial);
        }
        if (short.length > 0 && onRadial(m, shortestFirst(short)[0]!)) continue;
        write(m, text, spiral.slice(spiralFilled, spiralFilled + width), 'spiral');
        spiralFilled += width + between;
        continue;
      }

      // the spiral is full: lengthen whichever radial is shortest and still has room
      if (!shortestFirst(this.radials.map((_, j) => j)).some((j) => onRadial(m, j))) return null;
    }
    return threads;
  }
}
