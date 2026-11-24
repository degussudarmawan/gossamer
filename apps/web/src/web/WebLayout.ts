import { ringPoint } from '../components/OrbitSpider';
import { dotPath, isInk, smoothPath, unwrap, type Ink } from '../lib/ink';
import { InkPhrase, TextPhrase, ems, type InkShape, type Phrase } from './Phrase';

// Where every message goes in a room's web. No React in here: given a screen
// size, the room's seed and its messages, this works out the geometry, and
// components/RoomWeb.tsx draws it.
//
// The web fills the screen and is made only of words; no two letters ever
// touch. It takes its look from the landing page: a wide oval round a large
// title, and light letters spaced well apart. It is built the way an orb weaver builds:
//   - an oval hub ring round the room's title (the loop the spider walks)
//   - spokes: strands running from the hub right out to the screen's edge (no
//     margin), each bowed slightly, like the landing page's threads
//   - strandies (the "rings" in the code): strands of words between neighbouring
//     spokes that sag toward the hub, as an orb web's spiral threads do, their
//     corners on the spokes. One or two per space, every gap at least 2/5 of the
//     space and different from space to space; a second sits near or past the
//     edge and runs off it.
//   Words too long for what shows of their strand run on off the screen.
//
// Two rules:
//   - One message, one strand. A message is never broken across two strands.
//     One too long for what shows of its strand runs on off the screen (it is
//     always whole in the list); only past MAX_CHARS is it cut short with "…". A
//     strand with room left on the screen takes a later message, after a "·".
//   - The shape never changes as messages arrive. The spokes, the strandies and the
//     letter sizes depend only on the screen and the room, and messages are
//     placed in the order they were written, each in the first strand that
//     holds it, so a new message never moves an old one. The first messages
//     become the spokes; later ones fill the rings from the outside in. When
//     the web is full, the newest message takes over the strand that has gone
//     longest without a new one.
//
// A handwritten note follows the same rules in the writer's own hand: its pad's
// lines joined into one, sized like the typed letters, and bent along its strand
// (see web/Phrase.ts and runsFor).
//
// The geometry is from the design prototype; the numbers in TYPE are its tuned values.

export type Point = { x: number; y: number };

/** One run of words along one strand of silk. */
export type Run = {
  /** Typed words, written along `d`. Empty for handwriting. */
  text: string;
  /**
   * Handwriting: the writer's strokes already bent along the strand (an SVG path in screen
   * px), the pen's width, and how far the ink goes from the strand either way.
   */
  ink?: { d: string; pen: number; reach: number };
  /** The line the words follow, in reading order. */
  points: Point[];
  d: string;
  /** Length of the line: the letters are spaced to fill exactly this. */
  length: number;
  size: number;
  weight: 400 | 500;
  kind: 'spoke' | 'ring';
  /**
   * Which way its strand lies from the hub, in radians clockwise from the right: a
   * spoke's own direction, or the middle of a strandie's two spokes. The same for
   * every run on one strand, so the order they're written in can follow the web.
   */
  angle: number;
  /** For a strandie, 0 the outermost to 1 the innermost; 0 for a spoke. */
  depth: number;
  /** The message(s) whose words are in this run. */
  ids: string[];
};

/** The ring in the middle that holds the room's title. */
export type Hub = { cx: number; cy: number; rx: number; ry: number };

/** A message as the room has it. With `ink`, `body` is only its caption, which isn't on the web. */
type Msg = { id: string; position: number; body: string; ink?: Ink | null };

type Kind = 'spoke' | 'ring';

/** Letters on one kind of strand: full size, the smallest a long message may shrink to, and letter-spacing in ems. */
type Letters = { size: number; min: number; weight: 400 | 500; track: [number, number]; ideal: number };

type Type = {
  /**
   * Screen space kept free of the web at the edges. None: the owner wants the web on
   * the whole screen, running under the header and the buttons, with words running off
   * the edge (what to do about those is planned separately).
   */
  clear: { top: number; bottom: number; side: number };
  /**
   * The hub: an oval like the landing page's. Its half-width is `share` of the
   * screen width, kept between `min` and `max`; its half-height is `aspect` of that.
   */
  hub: { share: number; min: number; max: number; aspect: number };
  spokes: number;
  spoke: Letters;
  ring: Letters;
  /** Letters reach their largest when the frame's shorter half is at least this many px. */
  fullAt: number;
  /** Gap between the hub ring and the first spoke letter (the spider's legs). */
  spokeStart: number;
  /**
   * Where the strandies go in each space between two neighbouring spokes, as shares of
   * the space's depth (from the spokes' start at the hub out to the screen's edge). The
   * owner's rule: every gap, hub to first strandie and strandie to strandie, is at least
   * 2/5 of the space, and the gaps differ from space to space.
   *   first:    the range the first strandie is drawn from (so the hub gap is ≥ 2/5)
   *   gap:      least share between the first and a second strandie
   *   reach:    how far out a second may go (past 1 is past the edge; it runs off)
   *   minShown: a strandie showing less than this many px on the screen is left out,
   *             so only a big space gets a second one
   */
  strandie: { first: [number, number]; gap: number; reach: number; minShown: number };
  /** How far each ring strand sags toward the hub between its two spokes, as a share of its length. */
  sag: number;
  /** How far ring letters stop short of spoke letters. */
  knot: number;
  /**
   * How far each spoke bows to one side, like the landing page's threads: the
   * curve's control point sits this share of the spoke's length off the straight
   * line (so the middle of the spoke is half that off). Neighbours bow opposite ways.
   */
  bow: number;
};

// Wide screens follow the owner's mockup: the landing page's five long rays out to
// the very edges of the screen, bowed a little, and between each pair of rays one or
// two "strandies", strands of words that sag toward the title, as the spiral threads
// of an orb web do between its spokes. They are spread well apart, at least 2/5 of
// the space each, so a second one sits out near or past the edge and runs off it.
// Everything is in large light letters spaced well apart, all close to one size:
// spokes ~30px at their largest (×1.55), strandies nearly as large. The landing's
// threads measure 0.22–0.33em between letters. A message too long for what shows of
// its strand runs on off the screen (it is always whole in the list).
const TYPE: Record<'wide' | 'narrow', Type> = {
  wide: {
    clear: { top: 0, bottom: 0, side: 0 },
    hub: { share: 0.15, min: 150, max: 230, aspect: 0.6 },
    spokes: 5,
    spoke: { size: 19, min: 16.5, weight: 400, track: [0.16, 0.45], ideal: 0.28 },
    ring: { size: 16.5, min: 14.5, weight: 400, track: [0.14, 0.4], ideal: 0.24 },
    fullAt: 348,
    spokeStart: 20,
    strandie: { first: [0.45, 0.6], gap: 0.4, reach: 1.3, minShown: 260 },
    sag: 0.09,
    // strands stop well short of each ray, so every crossing has air round it (~30px)
    knot: 20,
    bow: 0.035,
  },
  // Phones keep nearly the old small hub: the screen is too narrow for the
  // landing's oval (the landing draws no ring on phones at all), and every
  // pixel it takes comes off the sideways spokes. They share the light weight
  // and the rule that letters are never squeezed.
  narrow: {
    clear: { top: 0, bottom: 0, side: 0 },
    hub: { share: 0.15, min: 54, max: 64, aspect: 0.95 },
    spokes: 10,
    spoke: { size: 12, min: 10, weight: 400, track: [0.06, 0.36], ideal: 0.18 },
    ring: { size: 10, min: 8, weight: 400, track: [0.03, 0.26], ideal: 0.12 },
    fullAt: 212,
    spokeStart: 14,
    strandie: { first: [0.45, 0.6], gap: 0.4, reach: 1.2, minShown: 110 },
    sag: 0.085,
    knot: 5,
    bow: 0.02,
  },
};
/** Letter sizes, as multiples of TYPE's: the largest, and the smallest (on small screens). */
const SCALE: [number, number] = [1, 1.55];
/** Messages longer than this are cut at a word. */
const MAX_CHARS = 120;
/**
 * How far past the screen's edge a spoke goes on, off the screen, for words that run
 * off it. Enough for the longest message (MAX_CHARS) at the smallest letters.
 */
const SPILL = 2400;
/**
 * The whole web turned this far to the left (anticlockwise), on top of each room's own
 * seeded starting angle: the owner asked for it turned 40° left. Screen angles run
 * clockwise (y points down), so left is negative.
 */
const TURN = (-40 * Math.PI) / 180;
/**
 * A strandie's second line, for a message too long for one, runs alongside the first,
 * this many letter sizes from it, on the side the letters' feet face (the owner's picture).
 */
const LINE_GAP = 1.3;
/** A message that can be spread to this share of its strand is spread to the end; a shorter one leaves room for another. */
const FILL = 0.8;

const FONT = 'Quicksand Variable';

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const dist = (p: Point, q: Point) => Math.hypot(q.x - p.x, q.y - p.y);
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
function cutToFit(body: Phrase, fits: (text: Phrase) => boolean, wholeWords: boolean): Phrase | null {
  if (fits(body)) return body;
  let words = 0;
  for (let k = 1; k <= body.words; k++) {
    if (!fits(body.slice(0, k).ellipsis())) break;
    words = k;
  }
  if (words) return body.slice(0, words).ellipsis(true);
  if (wholeWords) return null;
  let cut = body;
  for (let next = cut.shorter(); next && !fits(cut.ellipsis()); next = cut.shorter()) cut = next;
  return cut.ellipsis();
}

/** TYPE with every letter size and spacing multiplied by `f`. */
function scaled(T: Type, f: number): Type {
  return {
    ...T,
    spoke: { ...T.spoke, size: T.spoke.size * f, min: T.spoke.min * f },
    ring: { ...T.ring, size: T.ring.size * f, min: T.ring.min * f },
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

/** Handwriting segments longer than this (px) are split, so they follow the strand's curve. */
const BEND_STEP = 6;

/**
 * Handwriting laid out flat (see InkShape) bent onto a strand, the way typed letters
 * follow a <textPath>: along the line of points (in reading order) for x, and off it
 * toward the letters' feet for y. Returns one SVG path for all its strokes and dots.
 */
function bend(points: Point[], shape: InkShape): { d: string; pen: number; reach: number } {
  const line = new Line(points);
  const onLine = (p: Point): Point => {
    const q = line.pointAt(p.x);
    const t = line.tangentAt(p.x);
    return { x: q.x - t.y * p.y, y: q.y + t.x * p.y };
  };
  const parts: string[] = [];
  for (const stroke of shape.strokes) {
    const fine: Point[] = [];
    stroke.forEach((p, i) => {
      const prev = stroke[i - 1];
      const steps = prev ? Math.ceil(dist(prev, p) / BEND_STEP) : 0;
      for (let k = 1; k < steps; k++) {
        fine.push({ x: prev!.x + ((p.x - prev!.x) * k) / steps, y: prev!.y + ((p.y - prev!.y) * k) / steps });
      }
      fine.push(p);
    });
    parts.push(smoothPath(fine.map(onLine)));
  }
  for (const dot of shape.dots) parts.push(dotPath(onLine(dot), shape.dot));
  return { d: parts.join(''), pen: shape.pen, reach: shape.reach };
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
  /** How far the curve's control point sits off the straight line, along `n`. Its middle is half this off. */
  bend: number;
};

/**
 * How far a bowed spoke sits to the side of its straight line (along its normal),
 * at distance `r` out along it. The spoke is a quadratic curve whose control point
 * is beside its midpoint, so going out along it is even and the bow is 2t(1 − t).
 */
function bowAt(sp: Spoke, r: number): number {
  const t = sp.max > 0 ? clamp((r - sp.r0) / sp.max, 0, 1) : 0;
  return 2 * t * (1 - t) * sp.bend;
}

/** The point on a bowed spoke at distance `r` out along it, from centre `c`. */
function onSpoke(sp: Spoke, c: Point, r: number): Point {
  const off = bowAt(sp, r);
  return { x: c.x + sp.u.x * r + sp.n.x * off, y: c.y + sp.u.y * r + sp.n.y * off };
}

/**
 * A line words can go along: where its letters may start and stop, and how much of that
 * shows on the screen from the start (the rest runs off the edge).
 */
type Track = { line: Line; from: number; to: number; shown: number };

/** One strandie between two spokes, and the second line alongside it, if there's room for one. */
type Chord = Track & { second: Track | null; top: boolean; mid: number };

type Item = { id: string; phrase: Phrase; order: number };

/**
 * Where a message's words go on a strand: the words, where they start and how long they
 * run; on a strandie, perhaps going on on its second line.
 */
type Fit = { text: Phrase; start: number; len: number; text2?: Phrase; start2?: number; len2?: number };

/** One message's words on a strand. */
type Piece = Fit & { id: string; order: number };

/** A spoke, or one scallop of a ring: somewhere one or more whole messages can go. */
type Strand = {
  kind: Kind;
  /** The line its words follow: out from the hub for a spoke, in reading order for a ring. */
  line: Line;
  /** Where letters may start along the line, and how much room there is from there on the screen. */
  from: number;
  room: number;
  /** How much further the line goes on past `room`, off the screen: words may run on into it. */
  spill: number;
  /** A strandie's second line, for a message too long for one: the same three measures. */
  line2: Line | null;
  from2: number;
  room2: number;
  spill2: number;
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
    const { share, min, max, aspect } = T.hub;
    const rx = clamp(width * share, min, max);
    // never taller than a fifth of the free height, so a short screen keeps room for the web
    const ry = Math.min(rx * aspect, (height - top - bottom) * 0.2);
    return { cx: width / 2, cy: (top + height - bottom) / 2, rx, ry };
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
    const metrics = glyphMetrics();
    this.half = metrics.half;
    this.dy = metrics.dy;

    const msgs: Item[] = [...messages]
      .sort((p, q) => p.position - q.position)
      .map((m, order) => ({ id: m.id, phrase: this.phraseOf(m), order }))
      .filter((m): m is Item => m.phrase !== null);
    if (msgs.length === 0 || this.rx <= 0 || this.ry <= 0) return;

    this.strands = this.frame();
    for (const m of msgs) this.place(m);
    const placed = this.strands
      .flatMap((st) => st.pieces.map((p) => ({ st, p })))
      .sort((a, b) => a.p.order - b.p.order);
    this.runs = placed.flatMap(({ st, p }) => this.runsFor(st, p));
    this.hidden = msgs.length - placed.length;
  }

  /**
   * What goes on the web for a message: its handwriting if it has any, otherwise its
   * words (cut at MAX_CHARS). Null for a message with neither.
   */
  private phraseOf(m: Msg): Phrase | null {
    if (isInk(m.ink)) {
      const line = unwrap(m.ink);
      return line.words.length > 0 ? new InkPhrase(line) : null;
    }
    const body = m.body.replace(/\s+/g, ' ').trim();
    return body.length > 0 ? new TextPhrase(shorten(body, MAX_CHARS)) : null;
  }

  /** Distance from the centre to the hub ring in direction `a`: the same wobbly oval the spider walks. */
  private hubRadius(a: number) {
    const { rx, ry } = this.hub;
    // the loop is drawn from its own parameter, not from the direction, so convert
    const p = ringPoint(Math.atan2(Math.sin(a) / ry, Math.cos(a) / rx), rx, ry);
    return Math.hypot(p.x, p.y);
  }

  /**
   * Distance from the centre to the edge of the screen in a direction: the spokes run
   * right out to it, as the landing page's threads do, with no margin.
   */
  private outline(a: number) {
    const c = Math.abs(Math.cos(a)) || 1e-9;
    const s = Math.abs(Math.sin(a)) || 1e-9;
    return Math.min(this.rx / c, this.ry / s);
  }

  /** A spoke in a direction, bowing to the side `side` (1 or −1) by the type's `bow`. */
  private makeSpoke(angle: number, side: number): Spoke {
    const u = { x: Math.cos(angle), y: Math.sin(angle) };
    const r0 = this.hubRadius(angle) + this.T.spokeStart;
    const max = this.outline(angle) - r0;
    return { angle, u, n: { x: -u.y, y: u.x }, r0, max, bend: this.T.bow * Math.max(0, max) * side };
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
    const turn = this.rnd() * TAU + TURN;
    const spokes = Array.from({ length: count }, (_, i) =>
      this.makeSpoke(turn + ((i + (this.rnd() - 0.5) * 0.24) / count) * TAU, i % 2 ? 1 : -1),
    );
    const { c } = this;
    const strands: Strand[] = spokes.map((sp) => {
      // the bowed line, out from the hub to the screen's edge, then straight on past it
      // for words that run off
      const pts = Array.from({ length: 33 }, (_, j) => onSpoke(sp, c, sp.r0 + (sp.max * j) / 32));
      pts.push(onSpoke(sp, c, sp.r0 + sp.max + SPILL));
      return {
        kind: 'spoke',
        line: new Line(pts),
        from: 0,
        room: sp.max,
        spill: SPILL,
        line2: null,
        from2: 0,
        room2: 0,
        spill2: 0,
        inward: !readable(sp.u),
        angle: sp.angle,
        depth: 0,
        size: 0,
        pieces: [],
      };
    });
    const rings = this.ringsFor(spokes);
    rings.forEach((ring, k) => {
      const depth = rings.length > 1 ? k / (rings.length - 1) : 0;
      for (const ch of ring) {
        strands.push({
          kind: 'ring',
          line: ch.line,
          from: ch.from,
          room: ch.shown,
          spill: ch.to - ch.from - ch.shown,
          line2: ch.second?.line ?? null,
          from2: ch.second?.from ?? 0,
          room2: ch.second?.shown ?? 0,
          spill2: ch.second ? ch.second.to - ch.second.from - ch.second.shown : 0,
          inward: false,
          angle: ch.mid,
          depth,
          size: 0,
          pieces: [],
        });
      }
    });
    // a strand too short for even one small word holds nothing
    return strands.filter((st) => st.room > this.T[st.kind].size * 2.2);
  }

  // ---------- placing messages, in the order they were written ----------

  private place(m: Item) {
    const text = m.phrase;
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
          // fill what shows of the spoke, at full size; running off the screen counts against it
          cost = 2 * Math.abs(1 - fit.len / st.room) + 3 * (Math.max(0, fit.len - st.room) / st.room) + 3 * (1 - size / S.size);
        } else {
          // too long for it even small: the less is cut, the better
          cost = 6 + text.width(S.min, S.weight, S.track[0]) / (st.room + st.spill);
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
      // Room left over on the screen, and how far it would run off the screen. A
      // message that goes on to a strandie's second line has filled its first.
      const used = fit.text2 ? st.room : fit.start + fit.len;
      const left = Math.max(0, st.room - used) / st.room;
      const off =
        Math.max(0, used - st.room) / st.room + (fit.len2 && st.room2 ? Math.max(0, fit.len2 - st.room2) / st.room2 : 0);
      const cost = 2 * (1 - size / T[st.kind].size) + left + 3 * off + 0.6 * st.depth;
      if (!best || cost < best.cost) best = { st, size, cost };
    }
    if (best) return this.put(best.st, m, text, best.size);

    // Too long for any free strand. While the web still has room, the longest
    // empty strand takes it if all but its last few words fit.
    const empty = this.strands.filter((st) => st.pieces.length === 0);
    const longestEmpty = empty.reduce<Strand | null>((a, st) => (!a || st.room > a.room ? st : a), null);
    // as much as fits the (empty) strand at the smallest size, on one line or two
    const cutFor = (st: Strand, wholeWords: boolean) =>
      cutToFit(text, (t) => this.fitOn(st, t, T[st.kind].min) !== null, wholeWords);
    if (longestEmpty) {
      const cut = cutFor(longestEmpty, true);
      if (cut && cut.amount >= 0.75 * text.amount) return this.put(longestEmpty, m, cut, T[longestEmpty.kind].min);
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

  /**
   * The largest letter size (no smaller than the minimum) at which `text` fits an empty
   * strand, counting what runs off the screen, or null.
   */
  private sizeFor(st: Strand, text: Phrase): number | null {
    const K = this.T[st.kind];
    if (st.kind === 'ring') {
      // the largest size, in small steps down to the smallest, at which it fits on one line or two
      const empty = { ...st, pieces: [] };
      const step = (K.size - K.min) / 8 || 1;
      for (let size = K.size; size >= K.min - 0.01; size -= step) if (this.fitOn(empty, text, size)) return size;
      return null;
    }
    const size = Math.min(K.size, (st.room + st.spill) / text.width(1, K.weight, K.track[0]));
    return size >= K.min ? size : null;
  }

  /**
   * Where `text` would go on a strand at a letter size: after whatever it
   * already holds, following a "·". Spread to the end of what shows if it nearly
   * reaches it, otherwise at its natural spacing, leaving room for another. Too long
   * for what shows, it runs on off the screen at its tightest, if the strand goes on
   * that far. Null if it doesn't fit.
   */
  private fitOn(st: Strand, text: Phrase, size: number): Fit | null {
    const K = this.T[st.kind];
    const last = st.pieces[st.pieces.length - 1];
    // a strandie whose message went on to its second line is full
    if (last?.text2 !== undefined) return null;
    const used = last ? last.start + last.len : 0;
    // the · sits next to the message before, which for an inward spoke is at the end of the reading
    const words = last ? text.dotted(st.inward) : text;
    const gap = last ? (ems(' ', K.weight) + K.ideal) * size : 0;
    const room = st.room - used - gap;
    // once the words have reached the edge, a further message would be off the screen
    if (room <= 0) return null;
    const tight = words.width(size, K.weight, K.track[0]);
    // (a hair of tolerance: a size worked out to fill the strand exactly may round up)
    if (tight > room + 0.01) {
      // On an empty strandie, rather than running off, it breaks after a word and goes on on the second line.
      if (!last && st.line2 && st.room2 > 0) {
        const wrapped = this.wrap(st, text, size);
        if (wrapped) return wrapped;
      }
      if (tight > room + st.spill + 0.01) return null;
      return { text: words, start: used + gap, len: tight };
    }
    const spread = words.width(size, K.weight, K.track[1]);
    const len = Math.min(room, spread >= room * FILL ? spread : words.width(size, K.weight, K.ideal));
    return { text: words, start: used + gap, len };
  }

  /**
   * A message too long for an empty strandie's line, wrapped as in the owner's picture:
   * it breaks after the last word that fits and goes on on the second line alongside,
   * both lines starting at the strandie's start (the owner asked for no centring). A
   * nearly full line is spread to fill it. Too long even for two lines, the second runs
   * off the screen if it goes on past it. Null if it can't be wrapped (one long word, or
   * too long anyway).
   */
  private wrap(st: Strand, text: Phrase, size: number): Fit | null {
    const K = this.T[st.kind];
    const w = (t: Phrase, track: number) => t.width(size, K.weight, track);
    const lay = (t: Phrase, room: number) => {
      const spread = w(t, K.track[1]);
      return Math.min(room, spread >= room * FILL ? spread : w(t, K.ideal));
    };
    const words = text.words;
    let cut = 0;
    for (let k = 1; k < words && w(text.slice(0, k), K.track[0]) <= st.room + 0.01; k++) cut = k;
    if (cut === 0) return null;
    const first = text.slice(0, cut);
    const rest = text.slice(cut, words);
    const len = lay(first, st.room);
    const tight2 = w(rest, K.track[0]);
    if (tight2 <= st.room2 + 0.01) return { text: first, start: 0, len, text2: rest, start2: 0, len2: lay(rest, st.room2) };
    if (tight2 <= st.room2 + st.spill2 + 0.01) return { text: first, start: 0, len, text2: rest, start2: 0, len2: tight2 };
    return null;
  }

  private put(st: Strand, m: Item, text: Phrase, size: number) {
    const fit = this.fitOn(st, text, size);
    if (!fit) return;
    st.size = size;
    st.pieces.push({ id: m.id, order: m.order, ...fit });
  }

  /**
   * Puts a message on an empty strand as large as it fits (running off the screen if it
   * must), cut short only if it is too long even for that at the smallest size.
   */
  private putFitting(st: Strand, m: Item, text: Phrase) {
    const size = this.sizeFor(st, text);
    if (size) return this.put(st, m, text, size);
    const K = this.T[st.kind];
    this.put(st, m, cutToFit(text, (t) => this.fitOn(st, t, K.min) !== null, false)!, K.min);
  }

  /** One message's words on its strand, in reading order: one run, or two on a strandie's two lines. */
  private runsFor(st: Strand, p: Piece): Run[] {
    const K = this.T[st.kind];
    const run = (line: Line, from: number, text: Phrase, start: number, len: number): Run => {
      const points = line.slice(from + start, from + start + len);
      if (st.inward) points.reverse();
      return {
        text: text.text,
        ...(text.ink ? { ink: bend(points, text.ink(st.size)) } : {}),
        points,
        d: pathOf(points),
        length: len,
        size: st.size,
        weight: K.weight,
        kind: st.kind,
        angle: st.angle,
        depth: st.depth,
        ids: [p.id],
      };
    };
    const runs = [run(st.line, st.from, p.text, p.start, p.len)];
    if (p.text2 !== undefined && st.line2) runs.push(run(st.line2, st.from2, p.text2, p.start2 ?? 0, p.len2 ?? 0));
    return runs;
  }

  /**
   * The strandies, outermost first. In each space between two neighbouring spokes: the
   * first at 45–60% of the way out and, where the space is big enough to show it, a
   * second at least 2/5 further out, near or past the screen's edge. Each sags toward
   * the hub, as an orb web's spiral threads do. Each list is in reading order.
   */
  private ringsFor(spokes: Spoke[]): Chord[][] {
    const T = this.T;
    const R = T.ring;
    const S = T.strandie;
    const sp = [...spokes].sort((p, q) => p.angle - q.angle);
    const { c } = this;
    const hSpoke = this.half * T.spoke.size;
    const hRing = this.half * R.size + 0.5;
    const need = hSpoke + T.knot;
    /** A letter centred here is wholly on the screen. */
    const onScreen = (p: Point) => Math.abs(p.x - c.x) <= this.rx - hRing && Math.abs(p.y - c.y) <= this.ry - hRing;
    // Which side of a spoke a point is on, and how far: measured from the bowed
    // spoke at that distance out, not from its straight line.
    const side = (spk: Spoke, p: Point) => {
      const along = (p.x - c.x) * spk.u.x + (p.y - c.y) * spk.u.y;
      return (p.x - c.x) * spk.n.x + (p.y - c.y) * spk.n.y - bowAt(spk, along);
    };

    /** The strandie between two spokes with its corners `p` of the way out along each, or null. */
    const strandie = (s0: Spoke, s1: Spoke, a0: number, a1: number, p: number): Chord | null => {
      // the corners sit on the (bowed) spokes, or where they would be past the edge;
      // the strand sags toward the hub between them
      const P0 = onSpoke(s0, c, s0.r0 + p * s0.max);
      const P1 = onSpoke(s1, c, s1.r0 + p * s1.max);
      const M = { x: (P0.x + P1.x) / 2, y: (P0.y + P1.y) / 2 };
      const toHub = { x: c.x - M.x, y: c.y - M.y };
      const l = Math.hypot(toHub.x, toHub.y) || 1;
      const sag = T.sag * dist(P0, P1);
      const Q = { x: M.x + (toHub.x / l) * 2 * sag, y: M.y + (toHub.y / l) * 2 * sag };
      const steps = Math.max(48, Math.ceil(dist(P0, P1) / 6));
      let pts = Array.from({ length: steps + 1 }, (_, j) => {
        const t = j / steps;
        const u = 1 - t;
        return { x: u * u * P0.x + 2 * u * t * Q.x + t * t * P1.x, y: u * u * P0.y + 2 * u * t * Q.y + t * t * P1.y };
      });
      // Strandies read in two halves, both from the left: the top half clockwise,
      // the bottom half anticlockwise, so text never turns more than 90 degrees
      // from upright (the owner chose readable over the mockup's upside-down bottom).
      const mid = Math.atan2(Math.sin((a0 + a1) / 2), Math.cos((a0 + a1) / 2));
      const top = mid < 0;
      let ends = [s0, s1];
      if (!top) {
        pts = pts.reverse();
        ends = [s1, s0];
      }
      /** Where along a line words may go, or null: the same rules for both of a strandie's lines. */
      const track = (line: Line, minShown: number): Track | null => {
        // the knot: letters stop where their whole band is clear of the spoke's letters
        const midPt = line.pointAt(line.length / 2);
        const signs = ends.map((spk) => Math.sign(side(spk, midPt)));
        const clearAt = (e: number, s: number) => {
          const spk = ends[e]!;
          const sign = signs[e]!;
          const q = line.pointAt(s);
          const t = line.tangentAt(s);
          const nn = { x: -t.y, y: t.x };
          return Math.min(
            sign * side(spk, { x: q.x + nn.x * hRing, y: q.y + nn.y * hRing }),
            sign * side(spk, { x: q.x - nn.x * hRing, y: q.y - nn.y * hRing }),
          );
        };
        // walk in from each end in 2px steps, then back out in 0.25px steps
        let from = 0;
        let to = line.length;
        while (from < line.length && clearAt(0, from) < need) from += 2;
        while (from > 0 && clearAt(0, from - 0.25) >= need) from -= 0.25;
        while (to > from && clearAt(1, to) < need) to -= 2;
        while (to < line.length && clearAt(1, to + 0.25) >= need) to += 0.25;
        if (to - from < R.size * 2.2) return null;
        // Its words start where it comes onto the screen, so every message begins
        // where it can be read; past where it leaves the screen they run off.
        while (from < to && !onScreen(line.pointAt(from))) from += 2;
        let shownTo = from;
        while (shownTo < to && onScreen(line.pointAt(shownTo))) shownTo += 2;
        const shown = Math.min(shownTo, to) - from;
        if (shown < minShown) return null;
        // never nearer the hub than the spokes' own letters
        for (let s = from; s <= to; s += 4) {
          const q = line.pointAt(s);
          if (dist(q, c) - this.hubRadius(Math.atan2(q.y - c.y, q.x - c.x)) < T.spokeStart + hRing) return null;
        }
        return { line, from, to, shown };
      };

      const line = new Line(pts);
      const first = track(line, S.minShown);
      if (!first) return null;
      // The second line, for a message too long for one: alongside the first, a line's
      // height away on the side the letters' feet face, so it reads as the next line
      // (toward the hub above it, away from it below).
      const gap = LINE_GAP * R.size;
      const below = line.points.map((q, j) => {
        const t = line.tangentAt(line.cum[j]!);
        return { x: q.x - t.y * gap, y: q.y + t.x * gap };
      });
      const second = track(new Line(below), R.size * 3);
      return { ...first, second, top, mid };
    };

    const outer: Chord[] = [];
    const inner: Chord[] = [];
    for (let i = 0; i < sp.length; i++) {
      const s0 = sp[i]!;
      const s1 = sp[(i + 1) % sp.length]!;
      const a0 = s0.angle;
      const a1 = s1.angle + (i + 1 === sp.length ? TAU : 0);
      // Where this space's strandies go, different in every space. Drawn for every
      // space whether used or not, so the web depends only on the screen and the seed.
      const p1 = S.first[0] + this.rnd() * (S.first[1] - S.first[0]);
      const p2 = p1 + S.gap + this.rnd() * Math.max(0, S.reach - p1 - S.gap);
      // spokes this far apart leave strands too long to read as one
      if (a1 - a0 > TAU / 3) continue;
      const first = strandie(s0, s1, a0, a1, p1);
      if (first) inner.push(first);
      // the second only where enough of it shows: a big space
      const second = strandie(s0, s1, a0, a1, p2);
      if (second) outer.push(second);
    }
    const inReadingOrder = (list: Chord[]) => [
      ...list.filter((h) => h.top).sort((p, q) => p.mid - q.mid),
      ...list.filter((h) => !h.top).sort((p, q) => q.mid - p.mid),
    ];
    return [inReadingOrder(outer), inReadingOrder(inner)];
  }
}
