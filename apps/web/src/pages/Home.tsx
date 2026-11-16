import { useMemo, useRef } from 'react';
import { motion, useScroll, useTransform, type MotionValue } from 'motion/react';
import ApiStatus from '../components/ApiStatus';
import OrbitSpider, { ringPoint } from '../components/OrbitSpider';
import { useElementSize } from '../hooks/useElementSize';
import { useFontReady } from '../hooks/useFontReady';

// The landing page is one pinned scene that scrolling plays through:
//   the title, circled by the spider
//   -> the title becomes someone's worry
//   -> kind replies arrive, and each sentence IS a thread
// The cloth behind it changes with each beat: denim, then suede, then olive.
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
//         [x1, y1, x2, y2] as fractions of the screen, spun from the first
//         point to the second. Every end is on a screen edge or on an earlier
//         thread (marked below), never in mid-air.
const REPLIES = [
  { text: 'he will always be with you', wide: -158, narrow: [0, 0.335, 1, 0.285] },
  { text: 'i’m so sorry', wide: -80, narrow: [0.62, 0, 1, 0.115] }, // across the top-right corner
  { text: 'he knew he was loved', wide: 55, narrow: [0, 0.13, 0.7, 0.3] }, // ends on the first thread
  { text: 'thinking of you tonight', wide: -22, narrow: [0, 0.665, 1, 0.72] },
  { text: 'you’re not alone', wide: 128, narrow: [1, 0.87, 0.52, 0.694] }, // ends on the thread above it
] as const;

// Scroll progress (0 to 1) at which things happen.
const TITLE_OUT = [0.06, 0.16];
const WORRY_IN = [0.14, 0.24];
const FIRST_REPLY = 0.36;
const REPLY_GAP = 0.095;
const CAPTIONS = [
  { text: 'someone leaves a worry.', fade: [0.16, 0.22, 0.3, 0.35], to: [0, 1, 1, 0] },
  { text: 'strangers answer.', fade: [0.36, 0.42, 0.78, 0.83], to: [0, 1, 1, 0] },
  { text: 'every kind word spins a thread.', fade: [0.84, 0.9], to: [0, 1] },
];
// Scrolling hurries the spider, so its ring is finished before the first reply needs it.
const RING_DONE_BY = [0.06, 0.34];
// The cloth: denim under the title, suede under the worry, olive once replies arrive.
const CLOTH_AT = [0.06, 0.2, 0.3, 0.44];
const CLOTH = ['#54708a', '#5a4d43', '#5a4d43', '#6b6a40'];

type Point = { x: number; y: number };

type Thread = {
  text: string;
  /** The path the words are written along, always running left to right so they read upright. */
  reads: string;
  /** The same path from its first anchor to its second: the direction the thread is spun in. */
  spun: string;
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
    const curve = (p: Point, q: Point) =>
      `M${p.x.toFixed(1)} ${p.y.toFixed(1)}Q${c.x.toFixed(1)} ${c.y.toFixed(1)} ${q.x.toFixed(1)} ${q.y.toFixed(1)}`;

    // Size the sentence to fill the thread with barely open spacing, within a
    // narrow range of sizes.
    const ems = emWidth(reply.text);
    const size = Math.max(wide ? 20 : 15, Math.min(wide ? 30 : 20, length / (ems * 1.05)));
    // A short sentence on a long thread is written again instead of being stretched thin.
    const times = Math.max(1, Math.round(length / (ems * size * 1.3)));

    return {
      text: Array(times).fill(reply.text).join('   ·   '),
      reads: dir.x >= 0 ? curve(a, b) : curve(b, a),
      spun: curve(a, b),
      length,
      size,
    };
  });
}

// One reply: a sentence written along its thread, revealed from its first
// anchor onward as if it were being spun.
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
  const pathLength = useTransform(progress, [at, at + 0.1], [0, 1]);
  return (
    <>
      <defs>
        <path id={`${id}-path`} d={thread.reads} />
        <mask id={`${id}-mask`} maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
          <motion.path d={thread.spun} fill="none" stroke="white" strokeWidth={thread.size * 2.4} style={{ pathLength }} />
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
  const cloth = useTransform(progress, CLOTH_AT, CLOTH);

  // The loop the spider walks: roomy enough to hold two lines of title and a caption.
  // On wide screens it leaves a ring of silk for the replies to hang from; on a
  // phone the ring would crowd the words, so the spider just paces around them.
  const wide = isWide(width);
  const rx = Math.min(width * 0.4, 250);
  const ry = wide ? Math.min(height * 0.16, 125) : Math.min(height * 0.11, 95);
  // fontReady is a dependency because sentence widths are measured in the real font
  const threads = useMemo(() => buildThreads(width, height, rx, ry), [width, height, rx, ry, fontReady]);

  return (
    // Tall, so there is distance to scroll; the stage inside stays pinned to the screen.
    <div ref={scene} className="h-[450vh]">
      <motion.div ref={stage} className="sticky top-0 h-dvh overflow-hidden" style={{ backgroundColor: cloth }}>
        <div className="absolute inset-0 fabric" aria-hidden="true" />

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
            <g transform={`translate(${width / 2} ${height / 2}) scale(${wide ? 1 : 0.75})`} aria-hidden="true">
              {/* the group is scaled down on phones, so the loop is scaled up to stay the same size */}
              <OrbitSpider rx={wide ? rx : rx / 0.75} ry={wide ? ry : ry / 0.75} lead={lead} trail={wide} />
            </g>
          </svg>
        )}

        {/* The wordmark dangles from the top edge on its own strand. */}
        <span className="absolute top-8 left-6 px-1 font-hand text-lg leading-none tracking-[0.18em] before:absolute before:bottom-full before:left-2 before:mb-1 before:h-9 before:w-px before:bg-ink">
          gossamer
        </span>

        {/* The title and the worry share the middle, in the same face; one fades into the other. */}
        <div className="absolute inset-0 grid place-items-center px-16 text-center">
          <motion.h1 className="col-start-1 row-start-1 max-w-[8em] font-hand text-display" style={{ opacity: titleOpacity }}>
            leave what’s heavy here.
          </motion.h1>
          <motion.p className="col-start-1 row-start-1 max-w-[8em] font-hand text-display" style={{ opacity: worryOpacity }}>
            {WORRY}
          </motion.p>
        </div>

        {/* Captions sit just under the two lines in the middle. */}
        <div className="absolute inset-x-0 top-1/2 mt-[calc(var(--text-display)*1.25+0.6rem)] h-6">
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
      </motion.div>
    </div>
  );
}
