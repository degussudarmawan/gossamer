import { useMemo, useRef } from 'react';
import { motion, useScroll, useTransform, type MotionValue } from 'motion/react';
import ApiStatus from '../components/ApiStatus';
import OrbitSpider, { ringPoint } from '../components/OrbitSpider';
import { useElementSize } from '../hooks/useElementSize';

// The landing page is one pinned scene that scrolling plays through:
//   the title, circled by the spider
//   -> the title becomes someone's worry
//   -> kind replies arrive, and each sentence IS a thread: written from the
//      spider's ring out to the edge of the screen
// Three short captions are the only explanation.

const WORRY = 'my cat died this morning';

// Each reply and the direction its thread leaves the ring, in degrees
// (0 = right, 90 = down). Long sentences get the long diagonals.
const REPLIES = [
  { text: 'he will always be with you', wide: -158, narrow: -96 },
  { text: 'i’m so sorry', wide: -80, narrow: -52 },
  { text: 'thinking of you tonight', wide: -22, narrow: 62 },
  { text: 'he knew he was loved', wide: 55, narrow: 83 },
  { text: 'you’re not alone', wide: 128, narrow: 118 },
];

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

type Thread = {
  text: string;
  /** The path the words are written along, always running left to right so they read upright. */
  reads: string;
  /** The same path from the ring outward: the direction the thread is spun in. */
  spun: string;
  length: number;
  size: number;
};

// A thread starts just off the ring and ends at the edge of the screen, sagging
// slightly. Its sentence is sized and spaced to span the whole thing.
function buildThreads(width: number, height: number, rx: number, ry: number): Thread[] {
  const cx = width / 2;
  const cy = height / 2;
  const wide = width >= 1024;

  return REPLIES.map((reply, i) => {
    const angle = ((wide ? reply.wide : reply.narrow) * Math.PI) / 180;
    const dir = { x: Math.cos(angle), y: Math.sin(angle) };
    const ring = ringPoint(Math.atan2(dir.y / ry, dir.x / rx), rx, ry);
    const from = Math.hypot(ring.x, ring.y) + 10;
    // stops a little short of the edge so the last letter isn't cut off
    const to = Math.min(cx / Math.abs(dir.x || 1e-9), cy / Math.abs(dir.y || 1e-9)) - 18;

    const a = { x: cx + dir.x * from, y: cy + dir.y * from };
    const b = { x: cx + dir.x * to, y: cy + dir.y * to };
    const length = to - from;
    const sag = length * 0.035 * (i % 2 ? 1 : -1);
    const c = { x: (a.x + b.x) / 2 - dir.y * sag, y: (a.y + b.y) / 2 + dir.x * sag };
    const curve = (p: typeof a, q: typeof a) =>
      `M${p.x.toFixed(1)} ${p.y.toFixed(1)}Q${c.x.toFixed(1)} ${c.y.toFixed(1)} ${q.x.toFixed(1)} ${q.y.toFixed(1)}`;

    // Letters average about 0.46em wide. Aim for the sentence to fill the thread
    // with barely open spacing, within a narrow range of sizes.
    const size = Math.max(wide ? 20 : 17, Math.min(wide ? 32 : 24, length / (reply.text.length * 0.46 * 1.05)));
    // A short sentence on a long thread is written again instead of being stretched thin.
    const natural = reply.text.length * 0.46 * size;
    const times = Math.max(1, Math.round(length / (natural * 1.3)));

    return {
      text: Array(times).fill(reply.text).join('   ·   '),
      reads: dir.x >= 0 ? curve(a, b) : curve(b, a),
      spun: curve(a, b),
      length,
      size,
    };
  });
}

// One reply: a sentence written along its thread, revealed from the ring outward
// as if it were being spun.
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
    <motion.p className="absolute inset-x-0 text-center text-sm text-ink-soft" style={{ opacity }}>
      {text}
    </motion.p>
  );
}

export default function Home() {
  const scene = useRef<HTMLDivElement>(null);
  const [stage, { width, height }] = useElementSize<HTMLDivElement>();
  const { scrollYProgress: progress } = useScroll({ target: scene, offset: ['start start', 'end end'] });

  const titleOpacity = useTransform(progress, TITLE_OUT, [1, 0]);
  const worryOpacity = useTransform(progress, WORRY_IN, [0, 1]);
  const hintOpacity = useTransform(progress, [0, 0.04], [1, 0]);
  const lead = useTransform(progress, RING_DONE_BY, [0, 2 * Math.PI]);

  // The ring the spider walks: roomy enough to hold two lines of title and a caption.
  const rx = Math.min(width * 0.4, 250);
  const ry = Math.min(height * 0.16, 125);
  const threads = useMemo(() => buildThreads(width, height, rx, ry), [width, height, rx, ry]);

  return (
    // Tall, so there is distance to scroll; the stage inside stays pinned to the screen.
    <div ref={scene} className="h-[450vh]">
      <div ref={stage} className="sticky top-0 h-dvh overflow-hidden">
        {width > 0 && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full">
            {threads.map((thread, i) => (
              <WordThread
                key={thread.text}
                id={`reply-${i}`}
                thread={thread}
                at={FIRST_REPLY + i * REPLY_GAP}
                progress={progress}
              />
            ))}
            <g transform={`translate(${width / 2} ${height / 2})`} aria-hidden="true">
              <OrbitSpider rx={rx} ry={ry} lead={lead} />
            </g>
          </svg>
        )}

        {/* The wordmark dangles from the top edge on its own strand. */}
        <span className="absolute top-8 left-6 px-1 font-hand text-lg leading-none tracking-[0.18em] paper before:absolute before:bottom-full before:left-2 before:h-9 before:w-px before:bg-ink">
          gossamer
        </span>

        {/* The title and the worry share the middle, in the same face; one fades into the other. */}
        <div className="absolute inset-0 grid place-items-center px-6 text-center">
          <motion.h1
            className="col-start-1 row-start-1 max-w-[8em] font-hand text-display font-light"
            style={{ opacity: titleOpacity }}
          >
            leave what’s heavy here.
          </motion.h1>
          <motion.p
            className="col-start-1 row-start-1 max-w-[8em] font-hand text-display font-light"
            style={{ opacity: worryOpacity }}
          >
            {WORRY}
          </motion.p>
        </div>

        {/* Captions sit inside the ring, just under the two lines of handwriting. */}
        <div className="absolute inset-x-0 top-1/2 mt-[calc(var(--text-display)*1.25+0.6rem)] h-6">
          {CAPTIONS.map((caption) => (
            <Caption key={caption.text} {...caption} progress={progress} />
          ))}
        </div>

        {/* A short strand hanging at the bottom edge: "there is more below". */}
        <motion.div
          className="absolute bottom-0 left-1/2 h-14 w-px animate-pulse bg-ink-soft"
          style={{ opacity: hintOpacity }}
          aria-hidden="true"
        />

        <footer className="absolute inset-x-6 bottom-5 flex justify-between gap-4 text-sm text-ink-soft">
          <a
            href="https://findahelpline.com"
            target="_blank"
            rel="noreferrer"
            className="px-1 underline decoration-1 underline-offset-4 paper"
          >
            need to talk to someone now?
          </a>
          {import.meta.env.DEV && (
            <span className="px-1 paper">
              <ApiStatus />
            </span>
          )}
        </footer>
      </div>
    </div>
  );
}
