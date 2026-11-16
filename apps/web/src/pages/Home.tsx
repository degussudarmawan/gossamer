import { useCallback, useMemo, useRef } from 'react';
import { motion, useScroll, useTransform, type MotionValue } from 'motion/react';
import ApiStatus from '../components/ApiStatus';
import OrbitSpider, { ringPoint } from '../components/OrbitSpider';
import ThemePicker from '../components/ThemePicker';
import { useElementSize } from '../hooks/useElementSize';
import { useFontReady } from '../hooks/useFontReady';

// The landing page is one pinned scene that scrolling plays through:
//   the title, circled by the spider
//   -> the title becomes someone's worry
//   -> kind replies arrive, and each sentence IS a thread: the spider leaves
//      its loop and writes each one, the letters appearing behind it
// Three short captions are the only explanation.

const FONT = 'Quicksand Variable';
const WORRY = 'my cat died this morning';

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

// Scroll progress (0 to 1) at which things happen.
const TITLE_OUT = [0.05, 0.12];
const WORRY_IN = [0.11, 0.18];
// Scrolling hurries the spider, so its ring is finished before it leaves to write.
const RING_DONE_BY = [0.05, 0.24];
// The spider leaves its loop and walks to where the first reply starts...
const SET_OUT = 0.25;
// ...then for each reply: writes it (WRITE), and walks to where the next one starts.
const FIRST_REPLY = 0.3;
const REPLY_GAP = 0.12;
const WRITE = 0.075;
// After the last reply it walks home to its loop.
const HOME_BY = FIRST_REPLY + (REPLIES.length - 1) * REPLY_GAP + WRITE + 0.06;
const CAPTIONS = [
  { text: 'someone leaves a worry.', fade: [0.12, 0.17, 0.24, 0.28], to: [0, 1, 1, 0] },
  { text: 'strangers answer.', fade: [0.3, 0.34, 0.82, 0.86], to: [0, 1, 1, 0] },
  { text: 'every kind word spins a thread.', fade: [0.88, 0.93], to: [0, 1] },
];

type Point = { x: number; y: number };

const lerp = (p: Point, q: Point, u: number): Point => ({ x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u });
const smooth = (u: number) => u * u * (3 - 2 * u);
const along = (range: [number, number], p: number) => Math.min(1, Math.max(0, (p - range[0]) / (range[1] - range[0])));

type Thread = {
  text: string;
  /** Where it is written from (the left end), where to, and the control point of the sag between. */
  a: Point;
  b: Point;
  c: Point;
  /** The same curve as an SVG path. */
  d: string;
  length: number;
  size: number;
};

export const isWide = (width: number) => width >= 1024;

// Width of a piece of text in ems, measured in the real font.
let ruler: CanvasRenderingContext2D | null | undefined;
function emWidth(text: string) {
  ruler ??= document.createElement('canvas').getContext('2d');
  if (!ruler) return text.length * 0.5;
  ruler.font = `400 100px "${FONT}"`;
  return ruler.measureText(text).width / 100;
}

// A thread sags slightly between its two ends, and its sentence is sized and
// spaced to span the whole thing.
function buildThreads(width: number, height: number, rx: number, ry: number): Thread[] {
  const cx = width / 2;
  const cy = height / 2;
  const wide = isWide(width);

  return REPLIES.map((reply, i) => {
    let a: Point;
    let b: Point;
    if (wide) {
      const angle = (reply.wide * Math.PI) / 180;
      const dir = { x: Math.cos(angle), y: Math.sin(angle) };
      const ring = ringPoint(Math.atan2(dir.y / ry, dir.x / rx), rx, ry);
      const from = Math.hypot(ring.x, ring.y);
      const to = Math.min(cx / Math.abs(dir.x || 1e-9), cy / Math.abs(dir.y || 1e-9));
      a = { x: cx + dir.x * from, y: cy + dir.y * from };
      b = { x: cx + dir.x * to, y: cy + dir.y * to };
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
    const ems = emWidth(reply.text);
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
    };
  });
}

// Where the spider is on the screen at a given scroll position, given where its
// loop would otherwise have it. It leaves the loop, writes each reply (it is the
// tip of the sentence as the letters appear), walks to the start of the next,
// and finally goes home.
function spiderAt(p: number, onLoop: Point, threads: Thread[]): Point {
  const first = threads[0];
  const final = threads[threads.length - 1];
  if (!first || !final || p <= SET_OUT || p >= HOME_BY) return onLoop;
  if (p < FIRST_REPLY) return lerp(onLoop, first.a, smooth(along([SET_OUT, FIRST_REPLY], p)));

  const i = Math.min(threads.length - 1, Math.floor((p - FIRST_REPLY) / REPLY_GAP));
  const thread = threads[i]!;
  const start = FIRST_REPLY + i * REPLY_GAP;
  if (p <= start + WRITE) {
    // a point on the sagging thread: the same curve the words are written along
    const u = along([start, start + WRITE], p);
    return lerp(lerp(thread.a, thread.c, u), lerp(thread.c, thread.b, u), u);
  }
  const next = threads[i + 1];
  if (next) return lerp(thread.b, next.a, smooth(along([start + WRITE, start + REPLY_GAP], p)));
  return lerp(final.b, onLoop, smooth(along([start + WRITE, HOME_BY], p)));
}

// One reply: a sentence written along its thread, revealed from its first
// anchor onward as the spider walks it.
function WordThread({
  id,
  thread,
  at,
  progress,
}: {
  id: string;
  thread: Thread;
  at: number;
  progress: MotionValue<number>;
}) {
  const pathLength = useTransform(progress, [at, at + WRITE], [0, 1]);
  return (
    <>
      <defs>
        <path id={`${id}-path`} d={thread.d} />
        <mask id={`${id}-mask`} maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
          <motion.path d={thread.d} fill="none" stroke="white" strokeWidth={thread.size * 2.4} style={{ pathLength }} />
        </mask>
      </defs>
      <text className="fill-ink font-hand" fontSize={thread.size} mask={`url(#${id}-mask)`} dy="0.3em">
        <textPath href={`#${id}-path`} textLength={thread.length} lengthAdjust="spacing">
          {thread.text}
        </textPath>
      </text>
    </>
  );
}

function Caption({
  text,
  fade,
  to,
  progress,
}: {
  text: string;
  fade: number[];
  to: number[];
  progress: MotionValue<number>;
}) {
  const opacity = useTransform(progress, fade, to);
  return (
    <motion.p className="absolute inset-x-0 text-center text-sm font-medium text-ink-soft" style={{ opacity }}>
      {text}
    </motion.p>
  );
}

export default function Home() {
  const scene = useRef<HTMLDivElement>(null);
  const [stage, { width, height }] = useElementSize<HTMLDivElement>();
  const { scrollYProgress: progress } = useScroll({ target: scene, offset: ['start start', 'end end'] });
  const fontReady = useFontReady(FONT);

  const titleOpacity = useTransform(progress, TITLE_OUT, [1, 0]);
  const worryOpacity = useTransform(progress, WORRY_IN, [0, 1]);
  const hintOpacity = useTransform(progress, [0, 0.04], [1, 0]);
  const lead = useTransform(progress, RING_DONE_BY, [0, 2 * Math.PI]);

  // The loop the spider walks: roomy enough to hold two lines of title and a caption.
  // On wide screens it leaves a ring of silk for the replies to hang from; on a
  // phone the ring would crowd the words, so the spider just paces around them.
  const wide = isWide(width);
  const rx = Math.min(width * 0.4, 250);
  const ry = wide ? Math.min(height * 0.16, 125) : Math.min(height * 0.11, 95);
  // fontReady is a dependency because sentence widths are measured in the real font
  const threads = useMemo(() => buildThreads(width, height, rx, ry), [width, height, rx, ry, fontReady]);

  // The spider is drawn in a group centred on the screen (and shrunk on phones),
  // while threads are in screen pixels, so convert on the way in and out.
  const scale = wide ? 1 : 0.75;
  const errand = useCallback(
    (onLoop: Point): Point => {
      const cx = width / 2;
      const cy = height / 2;
      const at = spiderAt(progress.get(), { x: cx + onLoop.x * scale, y: cy + onLoop.y * scale }, threads);
      return { x: (at.x - cx) / scale, y: (at.y - cy) / scale };
    },
    [progress, threads, width, height, scale],
  );

  return (
    // Tall, so there is distance to scroll; the stage inside stays pinned to the screen.
    <div ref={scene} className="h-[600vh]">
      <div ref={stage} className="sticky top-0 h-dvh overflow-hidden">
        {width > 0 && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full">
            {threads.map((thread, i) => (
              <WordThread
                key={REPLIES[i]!.text}
                id={`reply-${i}`}
                thread={thread}
                at={FIRST_REPLY + i * REPLY_GAP}
                progress={progress}
              />
            ))}
            <g transform={`translate(${width / 2} ${height / 2}) scale(${scale})`} aria-hidden="true">
              {/* the group is scaled down on phones, so the loop is scaled up to stay the same size */}
              <OrbitSpider rx={rx / scale} ry={ry / scale} lead={lead} trail={wide} errand={errand} />
            </g>
          </svg>
        )}

        {/* The wordmark dangles from the top edge on its own strand. */}
        <span className="absolute top-8 left-6 px-1 font-hand text-lg leading-none tracking-[0.18em] before:absolute before:bottom-full before:left-2 before:mb-1 before:h-9 before:w-px before:bg-ink">
          gossamer
        </span>

        <ThemePicker className="absolute top-7 right-6 z-10" />

        {/* The title and the worry share the middle, in the same face; one fades into the other.
            This layer covers the whole screen, so it must let clicks through to what's beneath. */}
        <div className="pointer-events-none absolute inset-0 grid place-items-center px-16 text-center">
          <motion.h1 className="col-start-1 row-start-1 max-w-[8em] font-hand text-display" style={{ opacity: titleOpacity }}>
            leave what’s heavy here.
          </motion.h1>
          <motion.p className="col-start-1 row-start-1 max-w-[8em] font-hand text-display" style={{ opacity: worryOpacity }}>
            {WORRY}
          </motion.p>
        </div>

        {/* Captions sit just under the two lines in the middle. */}
        <div className="pointer-events-none absolute inset-x-0 top-1/2 mt-[calc(var(--text-display)*1.25+0.6rem)] h-6">
          {CAPTIONS.map((caption) => (
            <Caption key={caption.text} {...caption} progress={progress} />
          ))}
        </div>

        {/* A short strand near the bottom: "there is more below". On phones it sits above the help link. */}
        <motion.div
          className="absolute bottom-14 left-1/2 h-10 w-px animate-pulse bg-ink-soft lg:bottom-0 lg:h-14"
          style={{ opacity: hintOpacity }}
          aria-hidden="true"
        />

        <footer className="absolute inset-x-6 bottom-5 flex justify-between gap-4 text-sm font-medium text-ink-soft">
          <a
            href="https://findahelpline.com"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-1 underline-offset-4"
          >
            need to talk to someone now?
          </a>
          {import.meta.env.DEV && <ApiStatus />}
        </footer>
      </div>
    </div>
  );
}
