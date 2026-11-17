import { ringPoint } from '../components/OrbitSpider';
import { TextRuler } from '../lib/TextRuler';

// Where every message goes in a room's web. No React in here: given a screen
// size, the room's seed and its messages, this works out the geometry, and
// components/RoomWeb.tsx draws it.
//
// The web is made only of words, and no two words ever overlap.
//
// Shape (the owner's design study, at the landing page's proportions):
//   - a hub: the ring round the room's title
//   - spokes: straight strands from the hub toward the edge of the screen,
//     each carrying one message
//   - rings round the hub, crossing every spoke. A ring is one continuous
//     strand of sentences: a message flows along it across as many spokes as
//     it needs, leaving a small even gap (a knot) wherever it meets a spoke.
//     Each ring is written as two halves, over the top and under the bottom,
//     both left to right, so sentences always read in order.
//
// Nothing overlaps because of how it is laid out, not by luck:
//   - ring letters stop short of every spoke by more than half the tallest
//     letter a spoke can carry
//   - rings are further apart than two lines of ring letters
//   - spokes start clear of the hub ring and the spider walking it
//
// Letter size: a spoke follows the landing page (its length ÷ the text's width
// in ems × 1.05, within a range set by the screen, letters spread to fill it).
// Rings use one steady, smaller size, so the spokes read as the web's frame
// and long messages stay calm. A spoke only takes a message that fits on it
// whole; anything longer goes to the rings. Only messages over MAX_CHARS are
// cut, at a word, with …; the full message is always in the list.
//
// Messages are placed in order, so a new message never moves an earlier one.
// When the web is full, the oldest messages leave in batches of CHUNK, so the
// web rearranges only once every few messages rather than every time.

export type Point = { x: number; y: number };

/** One run of words on one stretch of silk. */
export type Part = {
  text: string;
  /** The line the words follow, left to right. */
  points: Point[];
  d: string;
  /** Length of the line: the letters are spaced to fill exactly this. */
  length: number;
};

export type Thread = {
  id: string;
  /** A spoke message is one part; a ring message may run over several stretches. */
  parts: Part[];
  size: number;
  kind: 'spoke' | 'ring';
};

/** The ring in the middle that holds the room's title. */
export type Hub = { cx: number; cy: number; rx: number; ry: number };

type Msg = { id: string; position: number; body: string };

const FONT = 'Quicksand Variable';
export const WEIGHT = { spoke: 500, ring: 400 } as const;
const rulers = { spoke: new TextRuler(FONT, WEIGHT.spoke), ring: new TextRuler(FONT, WEIGHT.ring) };

/**
 * Space kept free of the web: the header at the top, and on phones the
 * buttons at the bottom. On wide screens the buttons sit inside the ring, as
 * on the landing page, so the web can reach almost to the bottom edge.
 */
const keepClear = (wide: boolean) => ({ top: 84, bottom: wide ? 30 : 104, side: 16 });

/**
 * Type and spacing per screen.
 *   spoke    letter range for spokes (the landing page's sizes)
 *   ring     the one letter size for rings, always below the smallest spoke
 *   nominal  the spoke size a message is matched against when choosing its spoke
 *   ringGap  distance between rings where the web is narrowest
 *   spokeStart  gap between the hub ring and the start of every spoke (room for the spider's legs)
 *   firstRing   gap between the hub ring and the first ring's letters
 */
const TYPE = {
  wide: { spoke: { min: 22, max: 30 }, ring: 18, nominal: 26, ringGap: 46, spokeStart: 28, firstRing: 30 },
  narrow: { spoke: { min: 16, max: 20 }, ring: 14.5, nominal: 18, ringGap: 38, spokeStart: 22, firstRing: 24 },
};
/** How far spoke letters may be spread past their natural width to fill the spoke. */
const SPOKE_SPREAD = 1.8;
/** Glyphs reach about this far either side of the strand line, in ems (the text sits centred on it). */
const HALF_HEIGHT = 0.62;
/** Messages longer than this are cut at a word on the web. */
const MAX_CHARS = 60;
/** When the web is full, the oldest messages leave this many at a time. */
const CHUNK = 4;
/** How square the web's outline is: 2 is an oval; higher reaches further into the corners. */
const OUTLINE_SQUARENESS = 2.6;
/** On a phone, a spoke steeper than this only takes short messages: long vertical text is hard to read. */
const STEEP = Math.sin((55 * Math.PI) / 180);
const STEEP_MAX_CHARS = 30;
/** Ring letters may be spread up to this much past their natural width, so each stretch is filled without holes. */
const RING_SPREAD = 1.25;

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
const distance = (p: Point, q: Point) => Math.hypot(q.x - p.x, q.y - p.y);
const pathOf = (points: Point[]) =>
  points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('');
/** Pointing left to right, so words drawn along it are upright. */
const leftToRight = (points: Point[]) =>
  points[points.length - 1]!.x < points[0]!.x ? [...points].reverse() : points;

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

/** The point a fraction `u` (0 to 1) of the way along a line of points. */
export function pointAlong(points: Point[], u: number): Point {
  const strand = new Strand(points);
  return strand.pointAt(clamp(u, 0, 1) * strand.length);
}

/** The message on one line, cut back to the last whole word with … if it runs past `maxChars`. */
function shorten(body: string, maxChars: number): string {
  const line = body.replace(/\s+/g, ' ').trim();
  if (line.length <= maxChars) return line;
  const cut = line.slice(0, maxChars);
  const space = cut.lastIndexOf(' ');
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s,.;:!?-]+$/, '')}…`;
}

/** One unbroken word too wide for any stretch: cut at a letter, with …, to fit `room` pixels. */
function cutWord(word: string, room: number, size: number): string {
  let cut = word;
  while (cut.length > 1 && rulers.ring.widthInEms(`${cut}…`) * size > room) cut = cut.slice(0, -1);
  return `${cut}…`;
}

type Spoke = { angle: number; strand: Strand };
/** Half a ring (over the top, or under the bottom): its stretches between spokes, left to right. */
type Track = Strand[];

export class WebLayout {
  readonly wide: boolean;
  readonly hub: Hub;
  /** One per message on the web, in the order they were written. */
  readonly threads: Thread[];
  /** How many of the earliest messages aren't on the web (they are still in the full list). */
  readonly hidden: number;

  private readonly type: (typeof TYPE)['wide'];
  private readonly wobble: [number, number, number];
  private readonly spokes: Spoke[];
  /** Ring halves from the inside out: ring 1 top, ring 1 bottom, ring 2 top, … */
  private readonly tracks: Track[];

  /** The ring for a screen: the landing page's on wide screens, small and round on a phone. */
  static hubFor(width: number, height: number): Hub {
    const wide = width >= 1024;
    const clear = keepClear(wide);
    const top = clear.top;
    const bottom = height - clear.bottom;
    const small = Math.min(width * 0.17, 80);
    return {
      cx: width / 2,
      cy: (top + bottom) / 2,
      rx: wide ? Math.min(width * 0.4, 250) : small,
      ry: wide ? Math.min(height * 0.18, 145) : small,
    };
  }

  /** Letter size for a title so its longest word fits inside the ring, never above `max`. */
  static titleSize(title: string, hub: Hub, max: number, share: number): number {
    const widest = Math.max(...title.split(/\s+/).map((word) => rulers.ring.widthInEms(word)), 0.1);
    return Math.max(12, Math.min(max, (hub.rx * share) / widest));
  }

  constructor(
    readonly width: number,
    readonly height: number,
    seed: number,
    messages: readonly Msg[],
  ) {
    this.wide = width >= 1024;
    this.hub = WebLayout.hubFor(width, height);
    this.type = this.wide ? TYPE.wide : TYPE.narrow;

    const rnd = seeded(seed);
    this.wobble = [rnd() * TAU, rnd() * TAU, rnd() * TAU];
    // Enough spokes to read as a web, few enough that the ring between two of them holds a phrase.
    const count = this.wide ? 7 + Math.floor(rnd() * 3) : 5 + Math.floor(rnd() * 2);
    const turn = rnd() * TAU;
    // unevenly spaced, as in a hand-spun web, but never two spokes nearly together
    const angles = Array.from({ length: count }, (_, i) => turn + ((i + (rnd() - 0.5) * 0.5) / count) * TAU);
    this.spokes = angles.map((a) => ({ angle: a, strand: this.spokeStrand(a) }));
    this.tracks = this.ringTracks(angles, rnd);

    // Lay out every message; if they don't all fit, drop the oldest CHUNK and try again.
    const ordered = [...messages].sort((p, q) => p.position - q.position);
    let start = 0;
    let threads = this.place(ordered);
    while (!threads && start < ordered.length) {
      start = Math.min(ordered.length, start + CHUNK);
      threads = this.place(ordered.slice(start));
    }
    this.threads = threads ?? [];
    this.hidden = start;
  }

  // ---------- the shape ----------

  /** Distance from the centre to the drawn hub ring in a direction. */
  private hubRadius(angle: number): number {
    const { rx, ry } = this.hub;
    const p = ringPoint(Math.atan2(Math.sin(angle) / ry, Math.cos(angle) / rx), rx, ry);
    return Math.hypot(p.x, p.y);
  }

  /**
   * Distance from the centre to the outline of the web in a direction: a
   * rounded rectangle filling the free part of the screen, made a little
   * irregular so it looks spun rather than drawn, never past the free area.
   */
  private edge(angle: number): number {
    const { cx, cy } = this.hub;
    const clear = keepClear(this.wide);
    const halfWidth = cx - clear.side;
    const halfHeight = cy - clear.top;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const n = OUTLINE_SQUARENESS;
    const oval = 1 / ((Math.abs(c) / halfWidth) ** n + (Math.abs(s) / halfHeight) ** n) ** (1 / n);
    const [p1, p2, p3] = this.wobble;
    const uneven = 1 + 0.05 * Math.sin(2 * angle + p1) + 0.04 * Math.sin(3 * angle + p2) + 0.025 * Math.sin(5 * angle + p3);
    const box = Math.min(halfWidth / Math.abs(c || 1e-9), halfHeight / Math.abs(s || 1e-9));
    return Math.max(this.hubRadius(angle) + 40, Math.min(oval * Math.min(uneven, 1), box));
  }

  /** A point a fraction `u` of the way from the hub ring (0) to the outline (1), in a direction. */
  private at(angle: number, u: number): Point {
    const { cx, cy } = this.hub;
    const hub = this.hubRadius(angle);
    const r = hub + (this.edge(angle) - hub) * u;
    return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
  }

  /** A spoke: from clear of the hub ring (and the spider) to just inside the outline. */
  private spokeStrand(angle: number): Strand {
    const { cx, cy } = this.hub;
    const dir = { x: Math.cos(angle), y: Math.sin(angle) };
    const from = this.hubRadius(angle) + this.type.spokeStart;
    const to = this.edge(angle) - 6;
    return new Strand([
      { x: cx + dir.x * from, y: cy + dir.y * from },
      { x: cx + dir.x * to, y: cy + dir.y * to },
    ]);
  }

  /** The rings, from the inside out, each split into its top and bottom halves. */
  private ringTracks(angles: number[], rnd: () => number): Track[] {
    const { ring, ringGap, firstRing, spoke } = this.type;
    const count = angles.length;
    const tightest = Math.min(
      ...Array.from({ length: 72 }, (_, i) => this.edge((i / 72) * TAU) - this.hubRadius((i / 72) * TAU)),
    );
    // how far ring letters stop short of each spoke: more than half a spoke's tallest letter
    const knot = spoke.max * HALF_HEIGHT + 6;
    const lastAllowed = 1 - (ring * HALF_HEIGHT + 6) / tightest;

    const tracks: Track[] = [];
    for (let u = (firstRing + ring * HALF_HEIGHT) / tightest; u <= lastAllowed; ) {
      const top: { mid: number; strand: Strand }[] = [];
      const bottom: { mid: number; strand: Strand }[] = [];
      for (let j = 0; j < count; j++) {
        const a0 = angles[j]!;
        const a1 = angles[(j + 1) % count]! + (j + 1 === count ? TAU : 0);
        // the ring's own curve, sagging a little toward the straight line
        const slack = 0.06 + rnd() * 0.16;
        const p0 = this.at(a0, u);
        const p1 = this.at(a1, u);
        const steps = 48;
        const points = Array.from({ length: steps + 1 }, (_, i) => {
          const t = i / steps;
          const onRing = this.at(a0 + (a1 - a0) * t, u);
          const straight = { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t };
          return { x: onRing.x + (straight.x - onRing.x) * slack, y: onRing.y + (straight.y - onRing.y) * slack };
        });
        const whole = new Strand(leftToRight(points));
        if (whole.length - 2 * knot < ring * 2.5) continue; // too short for even a short word
        const strand = new Strand(whole.slice(knot, whole.length - knot));
        const mid = (((a0 + a1) / 2) % TAU + TAU) % TAU;
        (Math.sin(mid) < 0 ? top : bottom).push({ mid, strand });
      }
      // both halves read left to right: the top from the left going over, the bottom from the left going under
      top.sort((p, q) => Math.cos(p.mid) - Math.cos(q.mid));
      bottom.sort((p, q) => Math.cos(p.mid) - Math.cos(q.mid));
      tracks.push(top.map((s) => s.strand), bottom.map((s) => s.strand));
      // each ring a slightly different distance from the last, never closer than ringGap
      u += (ringGap * (1 + rnd() * 0.2)) / tightest;
    }
    return tracks.filter((t) => t.length > 0);
  }

  // ---------- putting messages on it ----------

  /** Lays every message onto the web, or returns null if they don't all fit. */
  private place(messages: Msg[]): Thread[] | null {
    const { spoke, ring, nominal } = this.type;
    const usedSpokes = new Set<Spoke>();
    // where the next ring message starts: which track, which stretch on it, how far along
    const cursor = { track: 0, stretch: 0, at: 0 };
    const between = ring * 1.6; // space between one ring message and the next

    const unit = (a: number) => ({ x: Math.cos(a), y: Math.sin(a) });
    // How lopsided the spokes would be with this one added: 0 = perfectly balanced.
    const lopsided = (angle: number) => {
      const all = [...usedSpokes].map((s) => unit(s.angle)).concat(unit(angle));
      return Math.hypot(all.reduce((s, v) => s + v.x, 0), all.reduce((s, v) => s + v.y, 0)) / all.length;
    };
    // How far a spoke is from the nearest one already written on, as a share of a third of a turn.
    const apart = (angle: number) => {
      if (usedSpokes.size === 0) return 1;
      const nearest = Math.min(
        ...[...usedSpokes].map((s) => {
          const d = Math.abs(angle - s.angle) % TAU;
          return Math.min(d, TAU - d);
        }),
      );
      return Math.min(1, nearest / (TAU / 3));
    };

    const threads: Thread[] = [];
    for (const m of messages) {
      const text = shorten(m.body, MAX_CHARS);
      const natural = rulers.spoke.widthInEms(text);

      // A spoke, if one is free and the whole message fits on it at the smallest spoke size.
      const fits = (s: Spoke) =>
        natural * spoke.min * 1.05 <= s.strand.length &&
        (this.wide || Math.abs(Math.sin(s.angle)) <= STEEP || text.length <= STEEP_MAX_CHARS);
      const free = this.spokes.filter((s) => !usedSpokes.has(s) && fits(s));
      if (free.length > 0) {
        const ideal = natural * nominal * 1.05;
        const cost = (s: Spoke) =>
          Math.abs(Math.log(s.strand.length / ideal)) +
          (usedSpokes.size < 3 ? 1.0 * lopsided(s.angle) : 1.2 * (1 - apart(s.angle)));
        const s = free.reduce((best, c) => (cost(c) < cost(best) ? c : best));
        usedSpokes.add(s);
        // the landing page's rule: size the text to fill its spoke, within the spoke range
        const room = s.strand.length;
        const size = clamp(room / (natural * 1.05), spoke.min, spoke.max);
        const drawn = Math.min(room, natural * size * SPOKE_SPREAD);
        const points = leftToRight(s.strand.slice(0, drawn));
        threads.push({ id: m.id, kind: 'spoke', size, parts: [{ text, points, d: pathOf(points), length: drawn }] });
        continue;
      }

      // Otherwise the rings: continue where the last ring message ended.
      const parts = this.onRings(text, cursor, between);
      if (!parts) return null; // the web is full
      threads.push({ id: m.id, kind: 'ring', size: ring, parts });
    }
    return threads;
  }

  /**
   * Writes a message along the rings from `cursor`, word by word, carrying on
   * across the next spoke (and onto the next track) whenever a stretch is
   * full. Moves the cursor past it. Returns null if the rings run out.
   */
  private onRings(text: string, cursor: { track: number; stretch: number; at: number }, between: number): Part[] | null {
    const size = this.type.ring;
    const width = (t: string) => rulers.ring.widthInEms(t) * size;
    const words = text.split(' ');
    const parts: Part[] = [];
    let { track, stretch, at } = cursor;
    let run: string[] = [];

    // `fill`: this piece is not the end of the message, so spread its letters
    // to reach the end of the stretch (within RING_SPREAD), leaving no hole
    // before the sentence carries on past the spoke.
    const close = (fill: boolean) => {
      const strand = this.tracks[track]![stretch]!;
      const words = run.join(' ');
      const natural = width(words);
      const length = fill ? Math.max(natural, Math.min(strand.length - at, natural * RING_SPREAD)) : natural;
      const points = strand.slice(at, at + length);
      parts.push({ text: words, points, d: pathOf(points), length });
      at += length;
      run = [];
    };
    const nextStretch = () => {
      stretch += 1;
      at = 0;
      if (stretch >= this.tracks[track]!.length) {
        track += 1;
        stretch = 0;
      }
      return track < this.tracks.length;
    };

    for (let k = 0; k < words.length; ) {
      if (track >= this.tracks.length) return null;
      const strand = this.tracks[track]![stretch]!;
      const tryRun = [...run, words[k]!].join(' ');
      if (at + width(tryRun) <= strand.length) {
        run.push(words[k]!);
        k++;
        continue;
      }
      if (run.length > 0) {
        close(true); // this stretch is full: carry on past the spoke
        if (!nextStretch()) return null;
      } else if (at === 0) {
        // a single word longer than a whole stretch: cut it, and end the message there
        run.push(cutWord(words[k]!, strand.length, size));
        k = words.length;
      } else if (!nextStretch()) {
        return null;
      }
    }
    if (run.length > 0) close(false);
    // the next message starts a little further on, or on the next stretch if this one is nearly full
    at += between;
    cursor.track = track;
    cursor.stretch = stretch;
    cursor.at = at;
    if (track < this.tracks.length && at >= this.tracks[track]![stretch]!.length) {
      cursor.at = 0;
      cursor.stretch += 1;
      if (cursor.stretch >= this.tracks[track]!.length) {
        cursor.track += 1;
        cursor.stretch = 0;
      }
    }
    return parts;
  }
}
