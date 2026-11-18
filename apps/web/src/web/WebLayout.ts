import { TextRuler } from '../lib/TextRuler';

// Where every message goes in a room's web. No React in here: given a screen
// size, the room's seed and its messages, this works out the geometry, and
// components/RoomWeb.tsx draws it.
//
// The web fills the screen and is made only of words; no two letters ever
// touch. It is built the way an orb weaver builds:
//   - a small hub ring round the room's title
//   - spokes: sentences running from the hub all the way out to the frame
//   - rings: sentences hanging between neighbouring spokes as straight
//     scallops that sag a little toward the hub, their corners on the spokes.
//     Spun from the outside in, leaving an open zone round the hub.
//
// A handful of messages (a "young" web) are spokes only, written large, like
// the landing page. Once there are more, the web grows its rings.
//
// Letters: one size for spokes, one smaller size for rings, each spread just
// enough to fill its strand. The layout tries large letters first and only
// steps down as the messages need more room, so the web always fills the
// screen. If even the smallest size can't hold every message, the oldest are
// left off the web (they are always in the full list).
//
// Ported from the design prototype; the numbers in TYPE are its tuned values.

export type Point = { x: number; y: number };

/** One run of words along one strand of silk. */
export type Run = {
  text: string;
  /** The line the words follow, in reading order. */
  points: Point[];
  d: string;
  /** Length of the line: the letters are spaced to fill exactly this. */
  length: number;
  size: number;
  weight: 400 | 500;
  kind: 'spoke' | 'ring';
  /** The message(s) whose words are in this run. */
  ids: string[];
};

/** The ring in the middle that holds the room's title. */
export type Hub = { cx: number; cy: number; rx: number; ry: number };

type Msg = { id: string; position: number; body: string };

type Type = {
  /** Screen space kept free of the web: the header at the top, the buttons at the bottom. */
  clear: { top: number; bottom: number; side: number };
  hub: number;
  spokes: number;
  spoke: { size: number; weight: 500; track: [number, number]; ideal: number };
  ring: { size: number; weight: 400; track: [number, number]; base: number };
  /** Gap between the hub ring and the first spoke letter (the spider's legs). */
  spokeStart: number;
  /** The open zone round the hub that the rings never enter. */
  freeZone: number;
  /** Range of spacing between rings, where the web is narrowest. */
  gap: [number, number];
  /** How far ring letters stop short of spoke letters. */
  knot: number;
  /** How much each ring chord sags toward the hub, as a share of its length. */
  sag: number;
  /** A web with only a few messages: spokes only, at landing-page sizes. */
  young: { size: number; min: number; track: number; upTo: number; inset: number; steep: number };
};

const TYPE: Record<'wide' | 'narrow', Type> = {
  // Base sizes are the owner's chosen scale (spokes ~28px, rings ~20px at the
  // largest step); TYPE_SCALES steps down from there only as messages need room.
  wide: {
    clear: { top: 84, bottom: 84, side: 24 },
    hub: 108,
    spokes: 11,
    spoke: { size: 18, weight: 500, track: [0.05, 0.34], ideal: 0.18 },
    ring: { size: 13, weight: 400, track: [-0.03, 0.24], base: 0.07 },
    spokeStart: 20,
    freeZone: 50,
    gap: [24, 36],
    knot: 3,
    sag: 0.085,
    young: { size: 30, min: 18, track: 0.2, upTo: 6, inset: 40, steep: 0.66 },
  },
  narrow: {
    clear: { top: 92, bottom: 96, side: 12 },
    hub: 54,
    spokes: 10,
    spoke: { size: 12, weight: 500, track: [0.03, 0.34], ideal: 0.16 },
    ring: { size: 10, weight: 400, track: [-0.03, 0.24], base: 0.06 },
    spokeStart: 14,
    freeZone: 28,
    gap: [20, 32],
    knot: 2.5,
    sag: 0.085,
    young: { size: 20, min: 13, track: 0.18, upTo: 5, inset: 10, steep: 0.92 },
  },
};
/** Letter sizes tried for a full web, as multiples of TYPE's: largest first, so the web fills the screen. */
const TYPE_SCALES = [1.55, 1.4, 1.25, 1.1, 1];
/** Web sizes tried, as shares of the whole free screen, when even the smallest letters leave the rings unfinished. */
const WEB_SCALES = [1, 0.9, 0.8, 0.7];
/** Ring messages longer than this are cut at a word. */
const MAX_CHARS = 120;
/** A spoke's text reaches at least this share of the way to the frame. */
const SPOKE_MIN = 0.84;
/** The innermost ring must be at least this full, or the web is too big for its messages. */
const LAST_RING_FILL = 0.8;
/** Steps between ring spacings tried. */
const GAP_STEP = 2;

const FONT = 'Quicksand Variable';
const rulers = { 400: new TextRuler(FONT, 400), 500: new TextRuler(FONT, 500) };

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const dist = (p: Point, q: Point) => Math.hypot(q.x - p.x, q.y - p.y);
const chars = (t: string) => [...t].length;
const ems = (text: string, weight: 400 | 500) => rulers[weight].widthInEms(text);
/** Width in px of `text` at `size`, with `track` ems added between letters. */
const widthAt = (text: string, size: number, weight: 400 | 500, track: number) =>
  (ems(text, weight) + track * (chars(text) - 1)) * size;
const pathOf = (pts: Point[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('');
/** Text along a direction reads upright: left to right, or bottom to top when nearly vertical. */
const readable = (d: Point) => (Math.abs(d.x) > 0.2 * Math.abs(d.y) ? d.x > 0 : d.y < 0);

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

function shorten(body: string, max: number): string {
  if (body.length <= max) return body;
  const cut = body.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s,.;:!?-]+$/, '')}…`;
}

function cutWord(word: string, room: number, size: number, weight: 400 | 500, track: number): string {
  let cut = word;
  while (cut.length > 1 && widthAt(`${cut}…`, size, weight, track) > room) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/**
 * Where the strand line sits within a letter: half the letter band (ascender
 * top to descender bottom), and how far below the line the baseline must go so
 * the letters are centred on it. Both in ems, measured from the font itself.
 */
function glyphMetrics() {
  const ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  if (!ctx) return { half: 0.47, dy: 0.27 };
  ctx.font = `400 100px "${FONT}"`;
  const m = ctx.measureText('bdfhklgjpqy!?');
  const asc = m.actualBoundingBoxAscent / 100;
  const desc = m.actualBoundingBoxDescent / 100;
  return { half: (asc + desc) / 2, dy: (asc - desc) / 2 };
}

/** A line of points that text can be written along, measured by distance. */
class Line {
  readonly cum: number[] = [0];

  constructor(readonly points: Point[]) {
    for (let i = 1; i < points.length; i++) this.cum.push(this.cum[i - 1]! + dist(points[i - 1]!, points[i]!));
  }

  get length() {
    return this.cum[this.cum.length - 1]!;
  }

  private indexAt(s: number) {
    let lo = 0;
    let hi = this.points.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (this.cum[m]! <= s) lo = m;
      else hi = m;
    }
    return lo;
  }

  pointAt(s: number): Point {
    const i = this.indexAt(s);
    const a = this.points[i]!;
    const b = this.points[i + 1] ?? a;
    const t = clamp((s - this.cum[i]!) / (this.cum[i + 1]! - this.cum[i]! || 1), 0, 1);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  tangentAt(s: number): Point {
    const i = Math.min(this.indexAt(s), this.points.length - 2);
    const a = this.points[i]!;
    const b = this.points[i + 1]!;
    const l = dist(a, b) || 1;
    return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
  }

  slice(from: number, to: number): Point[] {
    const out = [this.pointAt(from)];
    for (let i = this.indexAt(from) + 1; i < this.points.length && this.cum[i]! < to; i++) out.push(this.points[i]!);
    out.push(this.pointAt(to));
    return out;
  }
}

/** The point a fraction `u` (0 to 1) of the way along a line of points. */
export function pointAlong(points: Point[], u: number): Point {
  const line = new Line(points);
  return line.pointAt(clamp(u, 0, 1) * line.length);
}

type Spoke = {
  angle: number;
  u: Point;
  /** Unit normal: which side of the spoke a point is on. */
  n: Point;
  /** Distance from the centre where its letters start. */
  r0: number;
  max: number;
  min: number;
  text: string | null;
  len: number;
  ids: string[];
};

/** One scallop of a ring between two spokes, with where its letters may start and stop. */
type Chord = { line: Line; from: number; to: number; top: boolean; mid: number };

type Item = { id: string; body: string; order: number; text?: string };

type Attempt = {
  spokes: Spoke[];
  result: { parts: Run[]; fits: boolean } | null;
  omitted: Item[];
  full: boolean;
  placed: number;
  type: Type;
  scale: number;
};

export class WebLayout {
  readonly wide: boolean;
  readonly hub: Hub;
  /** Every run of words on the web: spokes first, then the rings from the outside in. */
  runs: Run[] = [];
  /** How many of the earliest messages are not on the web (they are always in the full list). */
  hidden = 0;
  /** Baseline shift (ems) that centres letters on their strand line. */
  readonly dy: number;

  private T: Type;
  private readonly base: Type;
  private readonly rnd: () => number;
  private readonly wob: [number, number, number];
  private readonly c: Point;
  private readonly rx: number;
  private readonly ry: number;
  private readonly half: number;
  private scale = 1;
  private spokes: Spoke[] = [];
  private readonly ringCache = new Map<string, Chord[][]>();

  /** The hub for a screen. The room screen uses it to place the title inside. */
  static hubFor(width: number, height: number): Hub {
    const T = width >= 1024 ? TYPE.wide : TYPE.narrow;
    const { top, bottom } = T.clear;
    return { cx: width / 2, cy: (top + height - bottom) / 2, rx: T.hub, ry: T.hub };
  }

  /** Letter size for a title so its longest word fits inside the hub, never above `max`. */
  static titleSize(title: string, hub: Hub, max: number, share: number): number {
    const widest = Math.max(...title.split(/\s+/).map((word) => ems(word, 400)), 0.1);
    return Math.max(11, Math.min(max, (hub.rx * share) / widest));
  }

  constructor(
    readonly width: number,
    readonly height: number,
    seed: number,
    messages: readonly Msg[],
  ) {
    this.wide = width >= 1024;
    this.base = this.wide ? TYPE.wide : TYPE.narrow;
    this.T = this.base;
    this.hub = WebLayout.hubFor(width, height);
    this.c = { x: this.hub.cx, y: this.hub.cy };
    const { top, bottom, side } = this.base.clear;
    // the web's frame is the whole free screen
    this.rx = width / 2 - side;
    this.ry = (height - top - bottom) / 2;

    this.rnd = seeded(seed);
    this.wob = [this.rnd() * TAU, this.rnd() * TAU, this.rnd() * TAU];
    const metrics = glyphMetrics();
    this.half = metrics.half;
    this.dy = metrics.dy;

    const msgs: Item[] = [...messages]
      .sort((p, q) => p.position - q.position)
      .map((m, order) => ({ id: m.id, body: m.body.replace(/\s+/g, ' ').trim(), order }));
    if (msgs.length === 0) return;
    if (msgs.length <= this.base.young.upTo) this.layoutYoung(msgs);
    else this.layoutWeb(msgs);
  }

  private hubRadius(a: number) {
    return this.T.hub * (1 + 0.022 * Math.sin(3 * a + 1) + 0.012 * Math.sin(5 * a));
  }

  /** Distance from the centre to the web's frame in a direction: the free screen, slightly uneven. */
  private outline(a: number) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const n = 2.25;
    const base = 1 / ((Math.abs(c) / this.rx) ** n + (Math.abs(s) / this.ry) ** n) ** (1 / n);
    const [p1, p2, p3] = this.wob;
    const uneven = 0.955 + 0.03 * Math.sin(2 * a + p1) + 0.02 * Math.sin(3 * a + p2) + 0.012 * Math.sin(5 * a + p3);
    return base * Math.min(1, uneven) * this.scale;
  }

  /** Distance from the centre to the edge of the free screen in a direction. */
  private screenEdge(a: number) {
    const { top, bottom, side } = this.T.clear;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const hx = c > 0 ? this.width - side - this.c.x : this.c.x - side;
    const hy = s > 0 ? this.height - bottom - this.c.y : this.c.y - top;
    return Math.min(hx / Math.abs(c || 1e-9), hy / Math.abs(s || 1e-9));
  }

  private makeSpoke(angle: number, outer: number): Spoke {
    const u = { x: Math.cos(angle), y: Math.sin(angle) };
    const r0 = this.hubRadius(angle) + this.T.spokeStart;
    return { angle, u, n: { x: -u.y, y: u.x }, r0, max: outer - r0, min: 0, text: null, len: 0, ids: [] };
  }

  /** A spoke's words, from the hub outward (or inward, so they stay upright). */
  private spokeRun(sp: Spoke, size: number): Run {
    const { c } = this;
    const a = { x: c.x + sp.u.x * sp.r0, y: c.y + sp.u.y * sp.r0 };
    const b = { x: c.x + sp.u.x * (sp.r0 + sp.len), y: c.y + sp.u.y * (sp.r0 + sp.len) };
    const points = readable(sp.u) ? [a, b] : [b, a];
    return { text: sp.text ?? '', points, d: pathOf(points), length: sp.len, size, weight: 500, kind: 'spoke', ids: sp.ids };
  }

  // ---------- a young web: spokes only, landing-page sizes ----------

  private layoutYoung(msgs: Item[]) {
    const T = this.T;
    const Y = T.young;
    const k = msgs.length;
    // the longest message takes the longest spoke
    const byLen = [...msgs].sort((p, q) => widthAt(q.body, 1, 500, Y.track) - widthAt(p.body, 1, 500, Y.track));
    // Evenly spaced, turned so the letters can be as large as possible without
    // any spoke getting too steep to read. Two messages make one thread
    // straight through the hub: a web's first line.
    const plan = (track: number) => {
      let best: { score: number; angles: number[]; size: number; track: number } | null = null;
      for (let i = 0; i < 360; i++) {
        const turn = (i / 360) * TAU;
        const angles = Array.from({ length: k }, (_, j) => turn + (j / k) * TAU);
        const room = angles
          .map((a) => this.screenEdge(a) - Y.inset - this.hubRadius(a) - T.spokeStart)
          .sort((p, q) => q - p);
        const size = Math.min(...byLen.map((m, j) => room[j]! / widthAt(m.body, 1, 500, track)));
        const steep = Math.max(...angles.map((a) => Math.abs(Math.sin(a))));
        const score = Math.min(size, Y.size) - 40 * Math.max(0, steep - Y.steep) + 0.001 * Math.abs(Math.cos(turn));
        if (!best || score > best.score) best = { score, angles, size, track };
      }
      return best!;
    };
    // airy letter-spacing if the messages fit at a readable size; tighter if that is what it takes
    let best = plan(Y.track);
    if (best.size < Y.min) best = plan(0.06);
    const track = best.track;
    const spokes = best.angles.map((a) => this.makeSpoke(a, this.screenEdge(a) - Y.inset));
    const free = [...spokes];
    const sizes: number[] = [];
    for (const m of byLen) {
      free.sort((p, q) => q.max - p.max);
      const sp = free.shift()!;
      const size = clamp(sp.max / widthAt(m.body, 1, 500, track), Y.min, Y.size);
      let text = m.body;
      if (widthAt(text, size, 500, track) > sp.max) {
        text = shorten(text, Math.floor((chars(text) * sp.max) / widthAt(text, size, 500, track)));
      }
      sp.text = text;
      sp.ids = [m.id];
      sizes.push(size);
    }
    // one size for every spoke, the smallest any of them needs, so they read as one family
    const size = Math.min(...sizes);
    for (const sp of spokes) {
      sp.len = Math.min(sp.max, widthAt(sp.text ?? '', size, 500, track));
      this.runs.push(this.spokeRun(sp, size));
    }
    this.spokes = spokes;
  }

  // ---------- a full web: spokes and scalloped rings ----------

  private layoutWeb(msgs: Item[]) {
    const count = Math.min(this.base.spokes, Math.max(5, Math.round(msgs.length * 0.5)));
    const turn = this.rnd() * TAU;
    // hand-spun: each spoke up to 12% of a slot off even spacing
    const angles = Array.from({ length: count }, (_, i) => turn + ((i + (this.rnd() - 0.5) * 0.24) / count) * TAU);

    // Fill the screen with the largest letters that still hold every message
    // and leave the rings complete; shrink the web only if even the smallest
    // letters can't fill it.
    let best: Attempt | null = null;
    search: for (const scale of WEB_SCALES) {
      for (const f of TYPE_SCALES) {
        this.scale = scale;
        this.T = this.scaledType(f);
        const attempt = { ...this.tryWeb(msgs, angles), type: this.T, scale };
        const better =
          !best || attempt.placed > best.placed || (attempt.placed === best.placed && attempt.full && !best.full);
        if (better) best = attempt;
        if (attempt.full && attempt.placed === msgs.length) break search;
      }
    }
    if (!best) return;
    this.scale = best.scale;
    this.T = best.type;
    this.spokes = best.spokes;
    for (const sp of best.spokes) this.runs.push(this.spokeRun(sp, this.T.spoke.size));
    if (best.result) this.runs.push(...best.result.parts);
    this.hidden = best.omitted.length;
  }

  /** TYPE with every letter size and spacing multiplied by `f`. */
  private scaledType(f: number): Type {
    const b = this.base;
    return {
      ...b,
      spoke: { ...b.spoke, size: b.spoke.size * f },
      ring: { ...b.ring, size: b.ring.size * f },
      freeZone: b.freeZone * f,
      gap: [b.gap[0] * f, b.gap[1] * f],
      knot: b.knot * f,
    };
  }

  private tryWeb(msgs: Item[], angles: number[]): Omit<Attempt, 'type' | 'scale'> {
    const T = this.T;
    const S = T.spoke;
    const spokes = angles.map((a) => this.makeSpoke(a, this.outline(a)));
    for (const sp of spokes) sp.min = sp.max * SPOKE_MIN;

    // A spoke takes a message that can fill it from hub to frame within its letter-spacing range.
    const fit = (text: string, sp: Spoke) => {
      const n = chars(text);
      if (n < 2) return null;
      const w0 = ems(text, 500) * S.size;
      const lo = w0 + S.track[0] * S.size * (n - 1);
      const hi = w0 + S.track[1] * S.size * (n - 1);
      if (hi < sp.min || lo > sp.max) return null;
      const len = clamp(hi, sp.min, sp.max); // reach the frame if possible
      const track = (len - w0) / (S.size * (n - 1));
      return { len, cost: Math.abs(track - S.ideal) + 2 * (1 - len / sp.max) };
    };
    const rings: Item[] = [];
    for (const m of msgs) {
      let best: { sp: Spoke; f: { len: number; cost: number } } | null = null;
      for (const sp of spokes) {
        if (sp.text) continue;
        const f = fit(m.body, sp);
        if (f && (!best || f.cost < best.f.cost)) best = { sp, f };
      }
      if (best) Object.assign(best.sp, { text: m.body, len: best.f.len, ids: [m.id] });
      else rings.push(m);
    }
    // any spoke still bare: give it one ring message, or two short ones joined by a ·
    for (const sp of spokes) {
      if (sp.text) continue;
      let best: { pick: number[]; text: string; len: number; cost: number } | null = null;
      for (let i = 0; i < rings.length; i++) {
        const tries = [[i]];
        for (let j = i + 1; j < rings.length; j++) tries.push([i, j]);
        for (const pick of tries) {
          const text = pick.map((x) => rings[x]!.body).join(' · ');
          const f = fit(text, sp);
          const cost = f ? f.cost + 0.25 * (pick.length - 1) : Infinity;
          if (f && (!best || cost < best.cost)) best = { pick, text, len: f.len, cost };
        }
      }
      if (best) {
        Object.assign(sp, { text: best.text, len: best.len, ids: best.pick.map((x) => rings[x]!.id) });
        [...best.pick].reverse().forEach((x) => rings.splice(x, 1));
      }
    }
    this.spokes = spokes.filter((sp) => sp.text);

    // The rest go on the rings as one stream, longest first onto the outer
    // rings (whose scallops are longest), set at the widest ring spacing that
    // still holds the whole stream.
    let stream = rings.map((m) => ({ ...m, text: shorten(m.body, MAX_CHARS) }));
    stream.sort((p, q) => widthAt(q.text, 1, 400, 0) - widthAt(p.text, 1, 400, 0) || p.order - q.order);
    const omitted: Item[] = [];
    let result: (ReturnType<WebLayout['setRings']> & { score: number }) | null = null;
    while (stream.length) {
      for (let g = T.gap[1]; g >= T.gap[0]; g -= GAP_STEP) {
        const r = this.setRings(stream, g);
        if (!r.fits) continue;
        const score = -Math.max(0, r.ringsAvail - r.ringsUsed - 1) + Math.min(r.lastFill, LAST_RING_FILL) + 0.001 * g;
        if (!result || score > result.score) result = { ...r, score };
      }
      if (result) break;
      // the oldest leave the web first (they are still in the list)
      const oldest = stream.reduce((a, b) => (b.order < a.order ? b : a));
      stream = stream.filter((m) => m !== oldest);
      omitted.push(oldest);
    }
    const full = !result || (result.ringsAvail - result.ringsUsed <= 1 && result.lastFill >= LAST_RING_FILL);
    return { spokes: this.spokes, result, omitted, full, placed: msgs.length - omitted.length };
  }

  /** The scalloped rings for a ring spacing `g`: each ring's chords in reading order. */
  private ringsFor(g: number): Chord[][] {
    const T = this.T;
    const R = T.ring;
    const sp = [...this.spokes].sort((p, q) => p.angle - q.angle);
    const { c } = this;
    const hSpoke = this.half * T.spoke.size;
    const hRing = this.half * R.size + 0.5;
    const need = hSpoke + T.knot;
    const inner = (a: number) => this.hubRadius(a) + T.freeZone;
    // rings stay inside the shortest a spoke may be, so every ring crosses every spoke
    const span = (a: number) => {
      const r0 = this.hubRadius(a) + T.spokeStart;
      return r0 + SPOKE_MIN * (this.outline(a) - r0) - (hRing + 6) - inner(a);
    };
    let spanMin = Infinity;
    for (let i = 0; i < 180; i++) spanMin = Math.min(spanMin, span((i / 180) * TAU));
    // spun from the outside in: ring 0 is the outermost, just inside the spokes' ends
    const radius = (a: number, k: number) => inner(a) + span(a) * (1 - (k * g) / spanMin);
    const ringsOut: Chord[][] = [];
    for (let k = 0; k * g <= spanMin + 0.01; k++) {
      const chords: Chord[] = [];
      for (let i = 0; i < sp.length; i++) {
        const s0 = sp[i]!;
        const s1 = sp[(i + 1) % sp.length]!;
        const a0 = s0.angle;
        const a1 = s1.angle + (i + 1 === sp.length ? TAU : 0);
        const r0 = radius(a0, k);
        const r1 = radius(a1, k);
        // a ring may only hang between two spokes that reach past it
        const over = hRing + 6;
        if (r0 + over > s0.r0 + s0.len || r1 + over > s1.r0 + s1.len) continue;
        const P0 = { x: c.x + Math.cos(a0) * r0, y: c.y + Math.sin(a0) * r0 };
        const P1 = { x: c.x + Math.cos(a1) * r1, y: c.y + Math.sin(a1) * r1 };
        const M = { x: (P0.x + P1.x) / 2, y: (P0.y + P1.y) / 2 };
        const toHub = { x: c.x - M.x, y: c.y - M.y };
        const l = Math.hypot(toHub.x, toHub.y) || 1;
        const sag = T.sag * dist(P0, P1);
        const Q = { x: M.x + (toHub.x / l) * 2 * sag, y: M.y + (toHub.y / l) * 2 * sag };
        let pts = Array.from({ length: 65 }, (_, j) => {
          const t = j / 64;
          const u = 1 - t;
          return { x: u * u * P0.x + 2 * u * t * Q.x + t * t * P1.x, y: u * u * P0.y + 2 * u * t * Q.y + t * t * P1.y };
        });
        // Each ring reads in two halves, both from the left: the top half
        // clockwise, the bottom half anticlockwise, so text never turns more
        // than 90 degrees from upright.
        const mid = Math.atan2(Math.sin((a0 + a1) / 2), Math.cos((a0 + a1) / 2));
        const top = mid < 0;
        let ends = [s0, s1];
        if (!top) {
          pts = pts.reverse();
          ends = [s1, s0];
        }
        const line = new Line(pts);
        // the knot: ring letters stop where their whole band is clear of the spoke's letters
        const side = (spk: Spoke, p: Point) => (p.x - c.x) * spk.n.x + (p.y - c.y) * spk.n.y;
        const midPt = line.pointAt(line.length / 2);
        const signs = ends.map((spk) => Math.sign(side(spk, midPt)));
        const clearAt = (e: number, s: number) => {
          const spk = ends[e]!;
          const sign = signs[e]!;
          const p = line.pointAt(s);
          const t = line.tangentAt(s);
          const nn = { x: -t.y, y: t.x };
          return Math.min(
            sign * side(spk, { x: p.x + nn.x * hRing, y: p.y + nn.y * hRing }),
            sign * side(spk, { x: p.x - nn.x * hRing, y: p.y - nn.y * hRing }),
          );
        };
        // walk in from each end in 2px steps, then back out in 0.25px steps
        let from = 0;
        let to = line.length;
        while (from < line.length && clearAt(0, from) < need) from += 2;
        while (from > 0 && clearAt(0, from - 0.25) >= need) from -= 0.25;
        while (to > from && clearAt(1, to) < need) to -= 2;
        while (to < line.length && clearAt(1, to + 0.25) >= need) to += 0.25;
        if (to - from < R.size * 2.2) continue;
        chords.push({ line, from, to, top, mid });
      }
      const over = chords.filter((h) => h.top).sort((p, q) => p.mid - q.mid);
      const under = chords.filter((h) => !h.top).sort((p, q) => q.mid - p.mid);
      ringsOut.push([...over, ...under]);
    }
    return ringsOut;
  }

  /** Sets the stream of ring messages into the rings, like justified lines in a book. */
  private setRings(stream: Item[], g: number) {
    // the rings depend only on the spokes, the sizes and the spacing: build each set once
    const key = `${this.scale}|${this.T.ring.size}|${g}|${this.spokes.map((s) => s.len.toFixed(1)).join(',')}`;
    if (!this.ringCache.has(key)) this.ringCache.set(key, this.ringsFor(g));
    const rings = this.ringCache.get(key)!;
    const R = this.T.ring;
    const W = (t: string, tr: number) => widthAt(t, R.size, 400, tr);
    type Token = { text: string; id: string | null; sep?: boolean; first?: boolean; last?: boolean };
    const tokens: Token[] = [];
    stream.forEach((m, i) => {
      if (i) tokens.push({ text: '·', id: null, sep: true });
      (m.text ?? m.body)
        .split(' ')
        .forEach((w, j, all) => tokens.push({ text: w, id: m.id, first: j === 0, last: j === all.length - 1 }));
    });
    const parts: Run[] = [];
    let i = 0;
    let ringsUsed = 0;
    let lastFill = 0;
    for (let ri = 0; ri < rings.length; ri++) {
      const ring = rings[ri]!;
      if (i >= tokens.length) break;
      ringsUsed++;
      let cap = 0;
      let used = 0;
      const widest = Math.max(...ring.map((h) => h.to - h.from), 0);
      for (let ci = 0; ci < ring.length; ci++) {
        const ch = ring[ci]!;
        const avail = ch.to - ch.from;
        cap += avail;
        if (i >= tokens.length) continue;
        const nextCh = ring[ci + 1] ?? rings[ri + 1]?.[0];
        const line: Token[] = [];
        while (i < tokens.length) {
          const tok = tokens[i]!;
          if (!line.length && tok.sep) {
            i++; // a spoke already separates them
            continue;
          }
          if (tok.sep && nextCh) {
            // A message that would fit whole in the next scallop starts there
            // rather than being split across a spoke, if this one is mostly full.
            let j = i + 1;
            const msg: string[] = [];
            while (j < tokens.length && !tokens[j]!.sep) msg.push(tokens[j++]!.text);
            const lineText = line.map((t) => t.text).join(' ');
            const whole = msg.join(' ');
            if (
              W(`${lineText} · ${whole}`, R.track[0]) > avail &&
              W(whole, R.track[0]) <= nextCh.to - nextCh.from &&
              W(lineText, R.track[1] * 0.8) >= avail
            ) {
              break;
            }
          }
          const cand = [...line, tok].map((t) => t.text).join(' ');
          if (W(cand, R.track[0]) <= avail) {
            line.push(tok);
            i++;
            continue;
          }
          if (!line.length && W(tok.text, R.track[0]) > widest) {
            // one unbroken word longer than any scallop on this ring: cut it, and end that message here
            line.push({ ...tok, text: cutWord(tok.text, avail, R.size, 400, R.track[0]) });
            const id = tok.id;
            i++;
            while (i < tokens.length && tokens[i]!.id === id) i++;
          }
          break;
        }
        // never strand a message's short first or last word alone across a spoke
        const content = line.filter((t) => !t.sep).length;
        if (i < tokens.length && content >= 2) {
          const end = line[line.length - 1]!;
          const next = tokens[i]!;
          if (end.first && !end.last && chars(end.text) <= 3) {
            line.pop();
            i--;
          } else if (next.last && !next.first && chars(next.text) <= 3 && end.id === next.id) {
            line.pop();
            i--;
          }
        }
        // a lone short word that starts a message ("the" of "the money") waits for the next scallop
        if (i < tokens.length && line.length === 1 && line[0]!.first && !line[0]!.last && chars(line[0]!.text) <= 3) {
          line.pop();
          i--;
        }
        if (!line.length) continue;
        const text = line.map((t) => t.text).join(' ');
        const n = chars(text);
        const w0 = W(text, 0);
        const justified = i < tokens.length && (avail - w0) / (R.size * Math.max(1, n - 1)) <= R.track[1];
        const length = justified ? avail : Math.min(avail, W(text, R.base));
        const points = ch.line.slice(ch.from, ch.from + length);
        const ids = [...new Set(line.map((t) => t.id).filter((id): id is string => id !== null))];
        parts.push({ text, points, d: pathOf(points), length, size: R.size, weight: 400, kind: 'ring', ids });
        used += length;
      }
      lastFill = cap ? used / cap : 0;
    }
    const ringsAvail = rings.filter((r) => r.length > 0).length;
    return { fits: i >= tokens.length, parts, ringsUsed, ringsAvail, lastFill };
  }
}
