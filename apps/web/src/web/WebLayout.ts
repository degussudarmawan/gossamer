import { TextRuler } from '../lib/TextRuler';

// Where every message goes in a room's web. No React in here: given a screen
// size, the room's seed and its messages, this works out the geometry, and
// components/RoomWeb.tsx draws it.
//
// The web fills the screen and is made only of words; no two letters ever
// touch. It is built the way an orb weaver builds:
//   - a small hub ring round the room's title
//   - spokes: strands running from the hub out to the frame
//   - rings: strands hanging between neighbouring spokes as straight
//     scallops that sag a little toward the hub, their corners on the spokes.
//     Spun from the outside in, leaving an open zone round the hub.
//
// Two rules:
//   - One message, one strand. A message is never broken across two strands.
//     A long one gets smaller letters, down to a readable minimum; one that is
//     still too long is cut short with "…" (it is always whole in the list). A
//     strand with room left over takes a later message that fits, after a "·".
//   - The shape never changes as messages arrive. The spokes, the rings and the
//     letter sizes depend only on the screen and the room, and messages are
//     placed in the order they were written, each in the first strand that
//     holds it, so a new message never moves an old one. The first messages
//     become the spokes; later ones fill the rings from the outside in. When
//     the web is full, the newest message takes over the strand that has gone
//     longest without a new one.
//
// The geometry is from the design prototype; the numbers in TYPE are its tuned values.

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

type Kind = 'spoke' | 'ring';

/** Letters on one kind of strand: full size, the smallest a long message may shrink to, and letter-spacing in ems. */
type Letters = { size: number; min: number; weight: 400 | 500; track: [number, number]; ideal: number };

type Type = {
  /** Screen space kept free of the web: the header at the top, the buttons at the bottom. */
  clear: { top: number; bottom: number; side: number };
  hub: number;
  spokes: number;
  spoke: Letters;
  ring: Letters;
  /** Letters reach their largest when the frame's shorter half is at least this many px. */
  fullAt: number;
  /** Gap between the hub ring and the first spoke letter (the spider's legs). */
  spokeStart: number;
  /** The open zone round the hub that the rings never enter. */
  freeZone: number;
  /** Least spacing between rings, where the web is narrowest. */
  gap: number;
  /** How far ring letters stop short of spoke letters. */
  knot: number;
  /** How much each ring chord sags toward the hub, as a share of its length. */
  sag: number;
};

const TYPE: Record<'wide' | 'narrow', Type> = {
  // At their largest (×1.55) these are the owner's chosen sizes: spokes ~28px, rings ~20px.
  wide: {
    clear: { top: 84, bottom: 84, side: 24 },
    hub: 108,
    spokes: 11,
    spoke: { size: 18, min: 14, weight: 500, track: [0.05, 0.34], ideal: 0.18 },
    ring: { size: 13, min: 10, weight: 400, track: [-0.03, 0.24], ideal: 0.07 },
    fullAt: 348,
    spokeStart: 20,
    freeZone: 50,
    gap: 28,
    knot: 3,
    sag: 0.085,
  },
  narrow: {
    clear: { top: 92, bottom: 96, side: 12 },
    hub: 54,
    spokes: 10,
    spoke: { size: 12, min: 10, weight: 500, track: [0.03, 0.34], ideal: 0.16 },
    ring: { size: 10, min: 8, weight: 400, track: [-0.03, 0.24], ideal: 0.06 },
    fullAt: 212,
    spokeStart: 14,
    freeZone: 28,
    gap: 24,
    knot: 2.5,
    sag: 0.085,
  },
};
/** Letter sizes, as multiples of TYPE's: the largest, and the smallest (on small screens). */
const SCALE: [number, number] = [1, 1.55];
/** Messages longer than this are cut at a word. */
const MAX_CHARS = 120;
/** Rings stay inside this share of each spoke's length. */
const RING_REACH = 0.84;
/** A message that can be spread to this share of its strand is spread to the end; a shorter one leaves room for another. */
const FILL = 0.8;

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

/**
 * As much of `body` as `fits`, cut after a word and ended with …. If not even
 * the first word fits: cut inside it, or with `wholeWords`, null.
 */
function cutToFit(body: string, fits: (text: string) => boolean, wholeWords: boolean): string | null {
  if (fits(body)) return body;
  let text = '';
  for (const word of body.split(' ')) {
    const next = text ? `${text} ${word}` : word;
    if (!fits(`${next}…`)) break;
    text = next;
  }
  if (text) return `${text.replace(/[\s,.;:!?-]+$/, '')}…`;
  if (wholeWords) return null;
  let cut = body;
  while (cut.length > 1 && !fits(`${cut}…`)) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/** TYPE with every letter size and spacing multiplied by `f`. */
function scaled(T: Type, f: number): Type {
  return {
    ...T,
    spoke: { ...T.spoke, size: T.spoke.size * f, min: T.spoke.min * f },
    ring: { ...T.ring, size: T.ring.size * f, min: T.ring.min * f },
    freeZone: T.freeZone * f,
    gap: T.gap * f,
    knot: T.knot * f,
  };
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
  /** Room for letters, from r0 out to the frame. */
  max: number;
};

/** One scallop of a ring between two spokes, with where its letters may start and stop. */
type Chord = { line: Line; from: number; to: number; top: boolean; mid: number };

type Item = { id: string; body: string; order: number };

/** One message's words on a strand. */
type Piece = { id: string; order: number; text: string; start: number; len: number };

/** A spoke, or one scallop of a ring: somewhere one or more whole messages can go. */
type Strand = {
  kind: Kind;
  /** The line its words follow: out from the hub for a spoke, in reading order for a ring. */
  line: Line;
  /** Where letters may start along the line, and how much room there is from there. */
  from: number;
  room: number;
  /** A spoke pointing left reads in toward the hub, so its letters stay upright. */
  inward: boolean;
  angle: number;
  /** For a ring, how far in it is: 0 the outermost, 1 the innermost. 0 for a spoke. */
  depth: number;
  /** Letter size, set by the first message it holds. */
  size: number;
  pieces: Piece[];
};

/** How far apart two directions are, in radians (0 to π). */
const apart = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

export class WebLayout {
  readonly wide: boolean;
  readonly hub: Hub;
  /** Every run of words on the web, one per message on it, in the order they were written. */
  runs: Run[] = [];
  /** How many messages are not on the web (they are always in the full list). */
  hidden = 0;
  /** Baseline shift (ems) that centres letters on their strand line. */
  readonly dy: number;

  private readonly T: Type;
  private readonly rnd: () => number;
  private readonly wob: [number, number, number];
  private readonly c: Point;
  private readonly rx: number;
  private readonly ry: number;
  private readonly half: number;
  /** Spokes first, then the rings from the outside in: the order strands are filled. */
  private strands: Strand[] = [];

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
    const base = this.wide ? TYPE.wide : TYPE.narrow;
    this.hub = WebLayout.hubFor(width, height);
    this.c = { x: this.hub.cx, y: this.hub.cy };
    const { top, bottom, side } = base.clear;
    // the web's frame is the whole free screen
    this.rx = width / 2 - side;
    this.ry = (height - top - bottom) / 2;
    // letters as large as the screen allows, the same however many messages there are
    this.T = scaled(base, clamp((SCALE[1] * Math.min(this.rx, this.ry)) / base.fullAt, SCALE[0], SCALE[1]));

    this.rnd = seeded(seed);
    this.wob = [this.rnd() * TAU, this.rnd() * TAU, this.rnd() * TAU];
    const metrics = glyphMetrics();
    this.half = metrics.half;
    this.dy = metrics.dy;

    const msgs: Item[] = [...messages]
      .sort((p, q) => p.position - q.position)
      .map((m, order) => ({ id: m.id, body: m.body.replace(/\s+/g, ' ').trim(), order }))
      .filter((m) => m.body.length > 0);
    if (msgs.length === 0 || this.rx <= 0 || this.ry <= 0) return;

    this.strands = this.frame();
    for (const m of msgs) this.place(m);
    const placed = this.strands
      .flatMap((st) => st.pieces.map((p) => ({ st, p })))
      .sort((a, b) => a.p.order - b.p.order);
    this.runs = placed.map(({ st, p }) => this.runFor(st, p));
    this.hidden = msgs.length - placed.length;
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
    return base * Math.min(1, uneven);
  }

  private makeSpoke(angle: number): Spoke {
    const u = { x: Math.cos(angle), y: Math.sin(angle) };
    const r0 = this.hubRadius(angle) + this.T.spokeStart;
    return { angle, u, n: { x: -u.y, y: u.x }, r0, max: this.outline(angle) - r0 };
  }

  // ---------- the frame: every strand there will ever be, before any words ----------

  /**
   * The spokes, evenly spaced but hand-spun (each up to 12% of a slot off),
   * and the rings hung between them. Each spoke is laid out at its full
   * length, so the rings never depend on how much of a spoke has words yet.
   */
  private frame(): Strand[] {
    const T = this.T;
    const count = T.spokes;
    const turn = this.rnd() * TAU;
    const spokes = Array.from({ length: count }, (_, i) =>
      this.makeSpoke(turn + ((i + (this.rnd() - 0.5) * 0.24) / count) * TAU),
    );
    const { c } = this;
    const strands: Strand[] = spokes.map((sp) => {
      const at = (r: number) => ({ x: c.x + sp.u.x * r, y: c.y + sp.u.y * r });
      const line = new Line([at(sp.r0), at(sp.r0 + sp.max)]);
      return { kind: 'spoke', line, from: 0, room: sp.max, inward: !readable(sp.u), angle: sp.angle, depth: 0, size: 0, pieces: [] };
    });
    const rings = this.ringsFor(spokes);
    rings.forEach((ring, k) => {
      const depth = rings.length > 1 ? k / (rings.length - 1) : 0;
      for (const ch of ring) {
        strands.push({ kind: 'ring', line: ch.line, from: ch.from, room: ch.to - ch.from, inward: false, angle: ch.mid, depth, size: 0, pieces: [] });
      }
    });
    // a strand too short for even one small word holds nothing
    return strands.filter((st) => st.room > this.T[st.kind].size * 2.2);
  }

  // ---------- placing messages, in the order they were written ----------

  private place(m: Item) {
    const text = shorten(m.body, MAX_CHARS);
    const T = this.T;

    // The first messages are the spokes: each takes a bare spoke that suits its
    // length, well away from the spokes already written, so a young web is balanced.
    const bare = this.strands.filter((st) => st.kind === 'spoke' && st.pieces.length === 0);
    if (bare.length > 0) {
      const S = T.spoke;
      const written = this.strands.filter((st) => st.kind === 'spoke' && st.pieces.length > 0);
      const away = (st: Strand) => (written.length ? Math.min(...written.map((w) => apart(st.angle, w.angle))) : Math.PI);
      const farthest = Math.max(...bare.map(away)) || 1;
      let best: { st: Strand; cost: number } | null = null;
      for (const st of bare) {
        const size = this.sizeFor(st, text);
        let cost: number;
        if (size) {
          const fit = this.fitOn(st, text, size)!;
          // fill the spoke, at full size
          cost = 2 * (1 - fit.len / st.room) + 3 * (1 - size / S.size);
        } else {
          // too long for it even small: the less is cut, the better
          cost = 6 + widthAt(text, S.min, S.weight, S.track[0]) / st.room;
        }
        cost += 1.5 * (1 - away(st) / farthest) + 0.5 * Math.max(0, Math.abs(Math.sin(st.angle)) - 0.8);
        if (!best || cost < best.cost) best = { st, cost };
      }
      this.putFitting(best!.st, m, text);
      return;
    }

    // Then the free strand that suits it best: one it fills well (so long
    // strands are kept for long messages), at full size if it can be, and the
    // outer rings before the inner. A spoke with room left counts too.
    let best: { st: Strand; size: number; cost: number } | null = null;
    for (const st of this.strands) {
      const size = st.pieces.length ? st.size : this.sizeFor(st, text);
      const fit = size ? this.fitOn(st, text, size) : null;
      if (!size || !fit) continue;
      const left = (st.room - fit.start - fit.len) / st.room;
      const cost = 2 * (1 - size / T[st.kind].size) + left + 0.6 * st.depth;
      if (!best || cost < best.cost) best = { st, size, cost };
    }
    if (best) return this.put(best.st, m, text, best.size);

    // Too long for any free strand. While the web still has room, the longest
    // empty strand takes it if all but its last few words fit.
    const empty = this.strands.filter((st) => st.pieces.length === 0);
    const longestEmpty = empty.reduce<Strand | null>((a, st) => (!a || st.room > a.room ? st : a), null);
    const cutFor = (st: Strand, wholeWords: boolean) => {
      const K = T[st.kind];
      return cutToFit(text, (t) => widthAt(t, K.min, K.weight, K.track[0]) <= st.room, wholeWords);
    };
    if (longestEmpty) {
      const cut = cutFor(longestEmpty, true);
      if (cut && chars(cut) >= 0.75 * chars(text)) return this.put(longestEmpty, m, cut, T[longestEmpty.kind].min);
    }

    // Otherwise it takes over the strand that has gone longest without a new
    // message, among those that can hold it whole: the web is full, or showing
    // it whole is worth more than its oldest message.
    const latest = (st: Strand) => Math.max(-1, ...st.pieces.map((p) => p.order));
    let stalest: Strand | null = null;
    for (const st of this.strands) {
      if (this.sizeFor(st, text) && (!stalest || latest(st) < latest(stalest))) stalest = st;
    }
    if (stalest) {
      stalest.pieces = [];
      stalest.size = 0;
      return this.putFitting(stalest, m, text);
    }

    // Too long for any strand at all: cut to fit one of the longer strands, so
    // as much of it shows as can. An empty one if there is one, otherwise the stalest.
    const longest = Math.max(...this.strands.map((st) => st.room));
    let target: Strand | null = null;
    for (const st of this.strands) {
      if (st.room >= 0.6 * longest && (!target || latest(st) < latest(target))) target = st;
    }
    if (!target) return;
    target.pieces = [];
    target.size = 0;
    this.put(target, m, cutFor(target, false)!, T[target.kind].min);
  }

  /** The largest letter size (no smaller than the minimum) at which `text` fits an empty strand, or null. */
  private sizeFor(st: Strand, text: string): number | null {
    const K = this.T[st.kind];
    const size = Math.min(K.size, st.room / widthAt(text, 1, K.weight, K.track[0]));
    return size >= K.min ? size : null;
  }

  /**
   * Where `text` would go on a strand at a letter size: after whatever it
   * already holds, following a "·". Spread to the strand's end if it nearly
   * reaches it, otherwise at its natural spacing, leaving room for another.
   * Null if it doesn't fit.
   */
  private fitOn(st: Strand, text: string, size: number) {
    const K = this.T[st.kind];
    const last = st.pieces[st.pieces.length - 1];
    const used = last ? last.start + last.len : 0;
    // the · sits next to the message before, which for an inward spoke is at the end of the reading
    const words = last ? (st.inward ? `${text} ·` : `· ${text}`) : text;
    const gap = last ? (ems(' ', K.weight) + K.ideal) * size : 0;
    const room = st.room - used - gap;
    // (a hair of tolerance: a size worked out to fill the strand exactly may round up)
    if (widthAt(words, size, K.weight, K.track[0]) > room + 0.01) return null;
    const spread = widthAt(words, size, K.weight, K.track[1]);
    const len = Math.min(room, spread >= room * FILL ? spread : widthAt(words, size, K.weight, K.ideal));
    return { text: words, start: used + gap, len };
  }

  private put(st: Strand, m: Item, text: string, size: number) {
    const fit = this.fitOn(st, text, size);
    if (!fit) return;
    st.size = size;
    st.pieces.push({ id: m.id, order: m.order, ...fit });
  }

  /** Puts a message on an empty strand as large as it fits, cut short if it is too long even at the smallest size. */
  private putFitting(st: Strand, m: Item, text: string) {
    const size = this.sizeFor(st, text);
    if (size) return this.put(st, m, text, size);
    const K = this.T[st.kind];
    this.put(st, m, cutToFit(text, (t) => widthAt(t, K.min, K.weight, K.track[0]) <= st.room, false)!, K.min);
  }

  /** One message's words on its strand, in reading order. */
  private runFor(st: Strand, p: Piece): Run {
    const K = this.T[st.kind];
    const points = st.line.slice(st.from + p.start, st.from + p.start + p.len);
    if (st.inward) points.reverse();
    return { text: p.text, points, d: pathOf(points), length: p.len, size: st.size, weight: K.weight, kind: st.kind, ids: [p.id] };
  }

  /** The scalloped rings, outermost first: each ring's chords in reading order. */
  private ringsFor(spokes: Spoke[]): Chord[][] {
    const T = this.T;
    const R = T.ring;
    const sp = [...spokes].sort((p, q) => p.angle - q.angle);
    const { c } = this;
    const hSpoke = this.half * T.spoke.size;
    const hRing = this.half * R.size + 0.5;
    const need = hSpoke + T.knot;
    const inner = (a: number) => this.hubRadius(a) + T.freeZone;
    // rings stay well inside the spokes' ends, so every ring crosses every spoke
    const span = (a: number) => {
      const r0 = this.hubRadius(a) + T.spokeStart;
      return r0 + RING_REACH * (this.outline(a) - r0) - (hRing + 6) - inner(a);
    };
    let spanMin = Infinity;
    for (let i = 0; i < 180; i++) spanMin = Math.min(spanMin, span((i / 180) * TAU));
    if (!(spanMin > 0)) return [];
    // As many rings as fit at least `gap` apart where the web is narrowest,
    // spread evenly from just inside the spokes' ends in to the open zone.
    const count = Math.floor(spanMin / T.gap) + 1;
    const radius = (a: number, k: number) => inner(a) + span(a) * (count > 1 ? 1 - k / (count - 1) : 1);
    const ringsOut: Chord[][] = [];
    for (let k = 0; k < count; k++) {
      const chords: Chord[] = [];
      for (let i = 0; i < sp.length; i++) {
        const s0 = sp[i]!;
        const s1 = sp[(i + 1) % sp.length]!;
        const a0 = s0.angle;
        const a1 = s1.angle + (i + 1 === sp.length ? TAU : 0);
        // a chord between spokes this far apart would cut across the hub
        if (a1 - a0 > TAU / 4) continue;
        const r0 = radius(a0, k);
        const r1 = radius(a1, k);
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
}
