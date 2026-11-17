import { ringPoint } from '../components/OrbitSpider';
import { TextRuler } from '../lib/TextRuler';

// Where every message goes in a room's web. No React in here: given a screen
// size, the room's seed and its messages, this works out the geometry, and
// components/RoomWeb.tsx draws it.
//
// The web is made only of words, and no two words ever overlap.
//
// Shape (from the owner's design study, at the landing page's proportions):
//   - a hub: the ring round the room's title
//   - spokes: straight strands from the hub out toward the edge of the screen
//   - rings: curved strands between each pair of neighbouring spokes, at a few
//     distances from the hub, following the web's outline and sagging a little
//
// Every strand (one spoke, or one stretch of ring between two spokes) carries
// exactly one message. Nothing crosses because of how the strands are laid
// out, not by luck:
//   - a ring stretch stops short of the spokes either side by more than half
//     the tallest letter a spoke can carry
//   - rings are further apart than two lines of the largest ring letters
//   - the first ring leaves a gap after the hub larger than half a letter
//
// Letter size follows the landing page: each strand's text is sized to fill
// its strand (strand length ÷ the text's width in ems × 1.05), kept within a
// range set by the screen, and the letters are spaced out to fill it. Text too
// long for its strand at the smallest size is cut at a word with …; the full
// message is always in the list.
//
// Messages fill the spokes first, then the rings from the inside out, each
// taking the free strand whose length best suits it. A new message never
// moves an earlier one. Once every strand is taken, the newest messages are
// shown and the earliest live only in the list.

export type Point = { x: number; y: number };

export type Thread = {
  id: string;
  /** The words drawn: the message, cut with … if too long for its strand. */
  text: string;
  /** The line the words follow, in reading order (left to right). */
  points: Point[];
  d: string;
  size: number;
  /** Length of the line: the letters are spaced to fill exactly this. */
  length: number;
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
 * Type and spacing per screen. `min` keeps every message readable; `max` is
 * the landing page's largest. `ringGap` is the distance between rings where
 * the web is narrowest; ring letters are capped so two lines always fit in it.
 */
const TYPE = {
  wide: { min: 16, max: 30, nominal: 22, ringGap: 58 },
  narrow: { min: 14, max: 20, nominal: 16, ringGap: 46 },
};
/** How square the web's outline is: 2 is an oval; higher reaches further into the corners, like the landing page's diagonals. */
const OUTLINE_SQUARENESS = 2.6;
/** How far letters may be spread past their natural width to fill a strand. */
const MAX_SPREAD = 1.5;
/** Glyphs reach about this far either side of the strand line, in ems (the text sits centred on it). */
const HALF_HEIGHT = 0.62;

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

/** One line of text, cut at a word (or, for one long word, at a letter) with … to fit `room` pixels at `size`. */
function cutToFit(text: string, room: number, size: number, ruler: TextRuler): string {
  const width = (t: string) => ruler.widthInEms(t) * size * 1.05;
  if (width(text) <= room) return text;
  // first guess from the average letter, then step back until it fits
  let cut = text.slice(0, Math.max(1, Math.floor((room / width(text)) * text.length)));
  while (cut.length > 1 && width(`${cut}…`) > room) {
    const space = cut.lastIndexOf(' ');
    cut = space > cut.length * 0.6 ? cut.slice(0, space) : cut.slice(0, -1);
  }
  return `${cut.replace(/[\s,.;:!?-]+$/, '')}…`;
}

/** A place on the web that can hold one message. */
type Slot = {
  kind: Thread['kind'];
  /** 0 for the spokes, then 1, 2, … for the rings from the inside out. */
  tier: number;
  /** Direction from the hub (spokes only matter): used to spread the first spokes apart. */
  angle: number;
  strand: Strand;
  /** Largest letters this strand may carry without touching its neighbours. */
  maxSize: number;
};

export class WebLayout {
  readonly wide: boolean;
  readonly hub: Hub;
  /** One per message on the web, in the order they were written. */
  readonly threads: Thread[];
  /** How many of the earliest messages didn't fit (they are still in the full list). */
  readonly hidden: number;

  private readonly type: (typeof TYPE)['wide'];
  private readonly wobble: [number, number, number];

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
  static titleSize(title: string, hub: Hub, max: number): number {
    const widest = Math.max(...title.split(/\s+/).map((word) => rulers.ring.widthInEms(word)), 0.1);
    return Math.max(12, Math.min(max, (hub.rx * 1.45) / widest));
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
    const slots = this.slots(rnd);

    const ordered = [...messages].sort((p, q) => p.position - q.position);
    const shown = ordered.slice(Math.max(0, ordered.length - slots.length));
    this.hidden = ordered.length - shown.length;
    this.threads = this.place(shown, slots);
  }

  // ---------- the shape ----------

  /** Distance from the centre to the drawn hub ring in a direction. */
  private hubRadius(angle: number): number {
    const { rx, ry } = this.hub;
    const p = ringPoint(Math.atan2(Math.sin(angle) / ry, Math.cos(angle) / rx), rx, ry);
    return Math.hypot(p.x, p.y);
  }

  /**
   * Distance from the centre to the outline of the web in a direction: an oval
   * filling the free part of the screen, made a little irregular so it looks
   * spun rather than drawn with a compass, and never past the free area.
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

  /** Every strand the web has: its spokes, then its rings from the inside out. */
  private slots(rnd: () => number): Slot[] {
    const { min, max, ringGap } = this.type;
    const count = this.wide ? 8 + Math.floor(rnd() * 3) : 6 + Math.floor(rnd() * 2);
    const turn = rnd() * TAU;
    // unevenly spaced, as in a hand-spun web, but never two spokes nearly together
    const angles = Array.from({ length: count }, (_, i) => turn + ((i + (rnd() - 0.5) * 0.5) / count) * TAU);

    const out: Slot[] = [];
    // spokes: from just off the hub ring to just inside the outline
    for (const a of angles) {
      const strand = new Strand([this.at(a, 0), this.at(a, 1)].map((p, i) => {
        // pull each end in a little: off the drawn ring at the hub, off the outline at the edge
        const toward = i === 0 ? this.at(a, 1) : this.at(a, 0);
        const len = distance(p, toward) || 1;
        const pad = i === 0 ? 12 : 6;
        return { x: p.x + ((toward.x - p.x) / len) * pad, y: p.y + ((toward.y - p.y) / len) * pad };
      }));
      out.push({ kind: 'spoke', tier: 0, angle: a, strand, maxSize: max });
    }

    // rings: spaced by ringGap pixels where the web is narrowest (wider elsewhere, following its oval)
    const tightest = Math.min(...Array.from({ length: 72 }, (_, i) => this.edge((i / 72) * TAU) - this.hubRadius((i / 72) * TAU)));
    // Ring letters stay smaller than spoke letters, so the spokes read as the web's frame,
    // and small enough that two lines always fit between rings.
    const ringMax = Math.min(max * 0.75, ringGap / (2 * HALF_HEIGHT) - 4);
    const firstGap = ringMax * HALF_HEIGHT + 22; // clear of the hub ring
    const lastAllowed = 1 - (ringMax * HALF_HEIGHT + 6) / tightest; // clear of the outline
    // how far a ring stretch stops short of each spoke: more than half a spoke's tallest letter
    const inset = max * HALF_HEIGHT + 10;

    let u = firstGap / tightest;
    for (let tier = 1; u <= lastAllowed; tier++) {
      for (let j = 0; j < count; j++) {
        const a0 = angles[j]!;
        const a1 = angles[(j + 1) % count]! + (j + 1 === count ? TAU : 0);
        // the ring's own curve, then let it sag part of the way toward the straight line
        const slack = 0.1 + rnd() * 0.25;
        const p0 = this.at(a0, u);
        const p1 = this.at(a1, u);
        const steps = 48;
        const points = Array.from({ length: steps + 1 }, (_, i) => {
          const t = i / steps;
          const onRing = this.at(a0 + (a1 - a0) * t, u);
          const straight = { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t };
          return { x: onRing.x + (straight.x - onRing.x) * slack, y: onRing.y + (straight.y - onRing.y) * slack };
        });
        const whole = new Strand(points);
        // A stretch that couldn't hold about seven letters at the smallest size would only
        // ever show a cut-off fragment, so it isn't used at all.
        if (whole.length - 2 * inset < min * 7) continue;
        out.push({ kind: 'ring', tier, angle: (a0 + a1) / 2, strand: new Strand(whole.slice(inset, whole.length - inset)), maxSize: ringMax });
      }
      // each ring a slightly different distance from the last, never closer than ringGap
      u += (ringGap * (1 + rnd() * 0.25)) / tightest;
    }
    return out;
  }

  // ---------- putting messages on it ----------

  private place(messages: Msg[], slots: Slot[]): Thread[] {
    const { min, nominal } = this.type;
    const free = new Set(slots);
    const usedSpokes: number[] = [];
    // How far a spoke is from the nearest one already written on, as a share of
    // a third of a turn: 1 = at least 120° away. Keeps a young web balanced.
    const apart = (angle: number) => {
      if (usedSpokes.length === 0) return 1;
      const nearest = Math.min(...usedSpokes.map((a) => {
        const d = Math.abs(angle - a) % TAU;
        return Math.min(d, TAU - d);
      }));
      // two spokes almost opposite each other read as one straight line, not a web
      const straightLine = usedSpokes.length < 3 && Math.abs(nearest - Math.PI) < Math.PI / 6;
      return Math.min(1, nearest / (TAU / 3)) - (straightLine ? 0.5 : 0);
    };

    return messages.map((m) => {
      const line = m.body.replace(/\s+/g, ' ').trim();
      // Spokes are spun first. After that any ring stretch may be used, the
      // inner rings slightly preferred, so the web still grows outward.
      const innermost = Math.min(...[...free].map((s) => s.tier));
      const candidates = innermost === 0 ? [...free].filter((s) => s.tier === 0) : [...free];
      // The strand whose length best suits this message at the screen's usual size
      // (long sentences on the long diagonals); strongly avoid any strand that would
      // have to cut it; and for spokes, keep them well apart.
      const ideal = rulers.spoke.widthInEms(line) * nominal * 1.05;
      const needs = rulers.ring.widthInEms(line) * min * 1.05;
      const cost = (s: Slot) =>
        Math.abs(Math.log(s.strand.length / ideal)) +
        0.35 * (s.tier - innermost) +
        (needs > s.strand.length ? 1.5 + Math.log(needs / s.strand.length) : 0) +
        (s.kind === 'spoke' ? 1.2 * (1 - apart(s.angle)) : 0);
      const slot = candidates.reduce((best, s) => (cost(s) < cost(best) ? s : best));
      free.delete(slot);
      if (slot.kind === 'spoke') usedSpokes.push(slot.angle);

      // the landing page's rule: size the text to fill its strand, within the allowed range
      const ruler = rulers[slot.kind];
      const room = slot.strand.length;
      const text = cutToFit(line, room, min, ruler);
      const natural = ruler.widthInEms(text);
      const size = clamp(room / (natural * 1.05), min, slot.maxSize);
      // spread the letters to fill the strand, but not beyond MAX_SPREAD of their natural width
      const drawn = Math.min(room, natural * size * MAX_SPREAD);
      // spokes start from the hub; rings sit centred between their spokes
      const from = slot.kind === 'spoke' ? 0 : (room - drawn) / 2;
      const points = slot.strand.slice(from, from + drawn);
      if (points[points.length - 1]!.x < points[0]!.x) points.reverse(); // always read left to right
      return { id: m.id, text, points, d: pathOf(points), size, length: drawn, kind: slot.kind };
    });
  }
}
