import { ringPoint } from '../components/OrbitSpider';
import { TextRuler } from '../lib/TextRuler';

// Everything about the landing scene that is geometry and timing, with no React
// in it: where each reply's thread runs, how big its words are, and where the
// spider is at any scroll position. pages/Home.tsx only draws what this says.

export const FONT = 'Quicksand Variable';
export const WORRY = 'my cat died this morning';

// Each reply's thread, laid out twice.
//
// wide:   the direction it leaves the spider's ring, in degrees (0 = right,
//         90 = down), running out to the screen edge. Long sentences get the
//         long diagonals.
// narrow: on a phone there is no ring and no room for steep text, so threads
//         are strung nearly level across the screen, clear of the middle.
//         [x1, y1, x2, y2] as fractions of the screen. Every end is on a
//         screen edge or on an earlier thread (marked below), never in mid-air.
const REPLIES = [
  { text: 'he will always be with you', wide: -158, narrow: [0, 0.335, 1, 0.285] },
  { text: 'i’m so sorry', wide: -80, narrow: [1, 0.12, 0.78, 0.296] }, // ends on the first thread
  { text: 'he knew he was loved', wide: 55, narrow: [0, 0.13, 0.45, 0.3125] }, // ends on the first thread
  { text: 'thinking of you tonight', wide: -22, narrow: [0, 0.665, 1, 0.72] },
  { text: 'you’re not alone', wide: 128, narrow: [1, 0.87, 0.52, 0.694] }, // ends on the thread above it
] as const;

const FIRST_REPLY = 0.3;
const REPLY_GAP = 0.12;
const WRITE = 0.075;

/** Scroll progress (0 to 1) at which things happen. */
export const TIMELINE = {
  titleOut: [0.05, 0.12],
  worryIn: [0.11, 0.18],
  /** Scrolling hurries the spider, so its ring is finished before it leaves to write. */
  ringDoneBy: [0.05, 0.24],
  /** The spider leaves its loop and walks to where the first reply starts. */
  setOut: 0.25,
  /** Then for each reply: it writes for `write`, and walks to the next for the rest of `replyGap`. */
  firstReply: FIRST_REPLY,
  replyGap: REPLY_GAP,
  write: WRITE,
  /** After the last reply it walks home to its loop. */
  homeBy: FIRST_REPLY + (REPLIES.length - 1) * REPLY_GAP + WRITE + 0.06,
  captions: [
    { text: 'someone leaves a worry.', fade: [0.12, 0.17, 0.24, 0.28], to: [0, 1, 1, 0] },
    { text: 'strangers answer.', fade: [0.3, 0.34, 0.82, 0.86], to: [0, 1, 1, 0] },
    { text: 'every kind word spins a thread.', fade: [0.88, 0.93], to: [0, 1] },
  ],
  /** The "leave yours" link follows the last caption in. */
  inviteAt: 0.93,
};

export type Point = { x: number; y: number };

export type Thread = {
  text: string;
  /** Where it is written from (the left end), where to, and the control point of the sag between. */
  a: Point;
  b: Point;
  c: Point;
  /** The same curve as an SVG path. */
  d: string;
  length: number;
  size: number;
  /** Scroll progress at which the spider starts writing it. */
  startsAt: number;
};

const lerp = (p: Point, q: Point, u: number): Point => ({ x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u });
const smooth = (u: number) => u * u * (3 - 2 * u);
const along = (from: number, to: number, p: number) => Math.min(1, Math.max(0, (p - from) / (to - from)));

const ruler = new TextRuler(FONT);

/** The scene laid out for one screen size. Build a new one when the size changes. */
export class LandingScene {
  /** Wide screens get the ring with replies radiating from it; narrow ones don't. */
  readonly wide: boolean;
  /** The loop the spider walks: roomy enough to hold two lines of title and a caption. */
  readonly rx: number;
  readonly ry: number;
  /** The spider is drawn smaller on phones. */
  readonly spiderScale: number;
  readonly threads: Thread[];

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.wide = width >= 1024;
    this.rx = Math.min(width * 0.4, 250);
    // tall enough on wide screens that the "leave yours" link fits inside the ring
    this.ry = this.wide ? Math.min(height * 0.18, 145) : Math.min(height * 0.11, 95);
    this.spiderScale = this.wide ? 1 : 0.75;
    this.threads = REPLIES.map((reply, i) => this.layThread(reply, i));
  }

  /**
   * Where the spider is on the screen at a given scroll position, given where
   * its loop would otherwise have it. It leaves the loop, writes each reply (it
   * is the tip of the sentence as the letters appear), walks to the start of
   * the next, and finally goes home.
   */
  spiderAt(progress: number, onLoop: Point): Point {
    const { threads } = this;
    const first = threads[0];
    if (!first || progress <= TIMELINE.setOut || progress >= TIMELINE.homeBy) return onLoop;
    if (progress < first.startsAt) {
      return lerp(onLoop, first.a, smooth(along(TIMELINE.setOut, first.startsAt, progress)));
    }

    const i = Math.min(threads.length - 1, Math.floor((progress - first.startsAt) / TIMELINE.replyGap));
    const thread = threads[i]!;
    const written = thread.startsAt + TIMELINE.write;
    if (progress <= written) {
      // a point on the sagging thread: the same curve the words are written along
      const u = along(thread.startsAt, written, progress);
      return lerp(lerp(thread.a, thread.c, u), lerp(thread.c, thread.b, u), u);
    }
    const next = threads[i + 1];
    if (next) return lerp(thread.b, next.a, smooth(along(written, next.startsAt, progress)));
    return lerp(thread.b, onLoop, smooth(along(written, TIMELINE.homeBy, progress)));
  }

  // A thread sags slightly between its two ends, and its sentence is sized and
  // spaced to span the whole thing.
  private layThread(reply: (typeof REPLIES)[number], i: number): Thread {
    const { width, height, wide, rx, ry } = this;
    const cx = width / 2;
    const cy = height / 2;

    let a: Point;
    let b: Point;
    if (wide) {
      const angle = (reply.wide * Math.PI) / 180;
      const out = { x: Math.cos(angle), y: Math.sin(angle) };
      const ring = ringPoint(Math.atan2(out.y / ry, out.x / rx), rx, ry);
      const from = Math.hypot(ring.x, ring.y);
      const to = Math.min(cx / Math.abs(out.x || 1e-9), cy / Math.abs(out.y || 1e-9));
      a = { x: cx + out.x * from, y: cy + out.y * from };
      b = { x: cx + out.x * to, y: cy + out.y * to };
    } else {
      const [x1, y1, x2, y2] = reply.narrow;
      a = { x: x1 * width, y: y1 * height };
      b = { x: x2 * width, y: y2 * height };
    }

    // The words stop short of each anchor: a little at a screen edge so no letter
    // is cut off, more where the anchor is another sentence so the two don't collide.
    const span = Math.hypot(b.x - a.x, b.y - a.y);
    const dir = { x: (b.x - a.x) / span, y: (b.y - a.y) / span };
    const onEdge = (p: Point) => wide || p.x < 1 || p.y < 1 || p.x > width - 1 || p.y > height - 1;
    const insetA = onEdge(a) ? 14 : 34;
    const insetB = onEdge(b) ? 14 : 34;
    a = { x: a.x + dir.x * insetA, y: a.y + dir.y * insetA };
    b = { x: b.x - dir.x * insetB, y: b.y - dir.y * insetB };
    const length = span - insetA - insetB;
    const sag = length * (wide ? 0.035 : 0.02) * (i % 2 ? 1 : -1);
    const c = { x: (a.x + b.x) / 2 - dir.y * sag, y: (a.y + b.y) / 2 + dir.x * sag };
    // Always written left to right, so the words read upright and appear in
    // reading order as the spider walks. Either end is a solid anchor to start from.
    if (a.x > b.x) [a, b] = [b, a];

    // Size the sentence to fill the thread with barely open spacing, within a
    // narrow range of sizes.
    const ems = ruler.widthInEms(reply.text);
    const size = Math.max(wide ? 20 : 15, Math.min(wide ? 30 : 20, length / (ems * 1.05)));
    // A short sentence on a long thread is written again instead of being stretched thin.
    const times = Math.max(1, Math.round(length / (ems * size * 1.3)));

    return {
      text: Array(times).fill(reply.text).join('   ·   '),
      a,
      b,
      c,
      d: `M${a.x.toFixed(1)} ${a.y.toFixed(1)}Q${c.x.toFixed(1)} ${c.y.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`,
      length,
      size,
      startsAt: TIMELINE.firstReply + i * TIMELINE.replyGap,
    };
  }
}
