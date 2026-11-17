import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useTransform,
  type MotionValue,
} from 'motion/react';
import { useFontReady } from '../hooks/useFontReady';
import type { Message } from '../lib/RoomApi';
import { pointAlong, WEIGHT, WebLayout, type Part, type Point, type Thread } from '../web/WebLayout';
import OrbitSpider from './OrbitSpider';

// A room's web, woven entirely from its messages (see web/WebLayout.ts). The
// spider writes it: when a room opens it writes out the newest few messages,
// and when a new one arrives it walks out and writes that.
//
// This is the decorative view. The same messages are always available in full
// as an ordinary list on the room screen, so nothing here is the only way to
// read anything.

const SECONDS_PER_THREAD = 1.2;
const MAX_REPLAY_SECONDS = 6;
/** How many of the newest messages the spider writes when a room opens. */
const REPLAY_NEWEST = 4;
// Of the time given to each thread, this share is spent writing it; the rest
// is the spider walking to where the next one starts.
const WRITING = 0.8;

/** One run of words. While its thread is being written, `reveal` uncovers it from the left. */
function PartText({
  id,
  part,
  thread,
  reveal,
  onPick,
}: {
  id: string;
  part: Part;
  thread: Thread;
  reveal?: MotionValue<number>;
  onPick: (id: string) => void;
}) {
  return (
    <>
      <defs>
        <path id={`t-${id}`} d={part.d} />
        {reveal && (
          <mask id={`m-${id}`} maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
            <motion.path d={part.d} fill="none" stroke="white" strokeWidth={thread.size * 2.4} style={{ pathLength: reveal }} />
          </mask>
        )}
      </defs>
      <text
        className="pointer-events-auto cursor-pointer fill-ink font-hand"
        fontSize={thread.size}
        fontWeight={WEIGHT[thread.kind]}
        // centred on the strand line, which is what the layout's no-overlap spacing assumes
        dy="0.32em"
        mask={reveal ? `url(#m-${id})` : undefined}
        onClick={() => onPick(thread.id)}
      >
        {/* letters spaced to fill the strand exactly, as on the landing page */}
        <textPath href={`#t-${id}`} textLength={part.length} lengthAdjust="spacing">
          {part.text}
        </textPath>
      </text>
    </>
  );
}

/** While a ring message is being written, each of its parts is uncovered in turn. */
function WritingPart({
  id,
  part,
  thread,
  progress,
  from,
  to,
  onPick,
}: {
  id: string;
  part: Part;
  thread: Thread;
  /** The whole thread's writing progress, 0 to 1. */
  progress: MotionValue<number>;
  /** The share of the thread before, and up to the end of, this part. */
  from: number;
  to: number;
  onPick: (id: string) => void;
}) {
  const reveal = useTransform(progress, [from, to], [0, 1]);
  return <PartText id={id} part={part} thread={thread} reveal={reveal} onPick={onPick} />;
}

function WordThread({
  thread,
  index,
  written,
  writing,
  onPick,
}: {
  thread: Thread;
  index: number;
  /** How many threads have been written so far, fractional while one is in progress. */
  written: MotionValue<number>;
  writing: boolean;
  onPick: (id: string) => void;
}) {
  const progress = useTransform(written, [index, index + WRITING], [0, 1]);
  const total = thread.parts.reduce((sum, p) => sum + p.length, 0) || 1;
  let before = 0;
  return (
    <>
      {thread.parts.map((part, k) => {
        const id = `${thread.id}-${k}`;
        const from = before / total;
        before += part.length;
        return writing ? (
          <WritingPart key={id} id={id} part={part} thread={thread} progress={progress} from={from} to={before / total} onPick={onPick} />
        ) : (
          <PartText key={id} id={id} part={part} thread={thread} onPick={onPick} />
        );
      })}
    </>
  );
}

type Props = {
  width: number;
  height: number;
  seed: number;
  messages: Message[];
  /** Called when a thread is clicked, with that message's id. */
  onPick: (id: string) => void;
};

export default function RoomWeb({ width, height, seed, messages, onPick }: Props) {
  const fontReady = useFontReady('Quicksand Variable');
  const still = useReducedMotion();
  // fontReady is a dependency because message widths are measured in the real font
  const layout = useMemo(() => new WebLayout(width, height, seed, messages), [width, height, seed, messages, fontReady]);
  const total = layout.threads.length;
  const { cx, cy, rx, ry } = layout.hub;
  // every part of each thread as one line, for the spider to walk
  const paths = useMemo(() => layout.threads.map((t) => t.parts.flatMap((p) => p.points)), [layout]);

  // `written` counts threads laid down so far: 3.4 means three done and the
  // fourth 40% written. `done` is its whole part, kept in state so React draws
  // exactly the finished threads plus the one in progress.
  const written = useMotionValue(0);
  const [done, setDone] = useState(0);
  useMotionValueEvent(written, 'change', (v) => setDone(Math.min(total, Math.floor(v))));

  // After the last thread the spider walks home: 0 = at the end of that thread, 1 = back on its ring.
  const home = useMotionValue(1);
  const lastTip = useRef<Point | null>(null);

  // On opening a room, everything but the newest few is simply there; the
  // spider writes only those, at an unhurried pace.
  const opened = useRef(false);
  useEffect(() => {
    if (!opened.current && total > 0) {
      opened.current = true;
      written.set(Math.max(0, total - REPLAY_NEWEST));
      setDone(Math.max(0, total - REPLAY_NEWEST));
    }
    const from = written.get();
    // nothing new to write (or fewer threads than before, after a removal): just show them
    if (still || total <= from) {
      written.set(total);
      setDone(total);
      return;
    }
    home.set(0);
    const run = animate(written, total, {
      duration: Math.min(MAX_REPLAY_SECONDS, (total - from) * SECONDS_PER_THREAD),
      ease: 'linear',
    });
    let goingHome: ReturnType<typeof animate> | undefined;
    void run.then(() => {
      goingHome = animate(home, 1, { duration: 1.4, ease: 'easeInOut' });
    });
    return () => {
      run.stop();
      goingHome?.stop();
    };
  }, [total, still, written, home]);

  // While writing, the spider is the tip of the sentence; between sentences it
  // walks to the next one; then it walks back to its ring. Its group is centred
  // on the hub, while threads are in screen pixels.
  const errand = useCallback(
    (onLoop: Point): Point => {
      const local = (p: Point) => ({ x: p.x - cx, y: p.y - cy });
      const v = written.get();
      const index = Math.min(total - 1, Math.floor(v));
      const current = paths[index];
      if (current && v < total) {
        const u = v - index;
        const next = paths[index + 1];
        if (u <= WRITING || !next) {
          lastTip.current = local(pointAlong(current, u / WRITING));
        } else {
          const from = current[current.length - 1]!;
          const to = next[0]!;
          const t = (u - WRITING) / (1 - WRITING);
          lastTip.current = local({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
        }
        return lastTip.current;
      }
      const tip = lastTip.current;
      const t = home.get();
      if (!tip || t >= 1) return onLoop;
      return { x: tip.x + (onLoop.x - tip.x) * t, y: tip.y + (onLoop.y - tip.y) * t };
    },
    [paths, total, written, home, cx, cy],
  );

  if (width === 0) return null;
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
      {layout.threads.slice(0, done + 1).map((thread, index) => (
        <WordThread
          key={`${thread.id}-${thread.parts.length}`}
          thread={thread}
          index={index}
          written={written}
          writing={index === done}
          onPick={onPick}
        />
      ))}
      <g transform={`translate(${cx} ${cy})`}>
        {/* smaller on phones, where its legs would otherwise reach the words */}
        <OrbitSpider rx={rx} ry={ry} errand={errand} ring="whole" glyphScale={layout.wide ? 0.72 : 0.55} />
      </g>
    </svg>
  );
}
