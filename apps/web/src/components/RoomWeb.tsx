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
import { LETTER_SPACING, pointAlong, WEIGHT, WebLayout, type Point, type Thread } from '../web/WebLayout';
import OrbitSpider from './OrbitSpider';

// A room's web, woven entirely from its messages. The spider writes it: when
// the room opens it walks the web laying down every message in order, then
// goes back to pacing the ring round the title. When a new message arrives it
// walks out and writes that one.
//
// This is the decorative view. The same messages are always available in full
// as an ordinary list on the room screen, so nothing here is the only way to
// read anything.

const SECONDS_PER_THREAD = 0.9;
const MAX_REPLAY_SECONDS = 9; // however many messages, opening a room never takes longer than this
// Of the time given to each thread, this share is spent writing it; the rest
// is the spider walking to where the next one starts.
const WRITING = 0.8;

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
  /** True while this is the thread being written: only then does it need its reveal mask. */
  writing: boolean;
  onPick: (id: string) => void;
}) {
  const reveal = useTransform(written, [index, index + WRITING], [0, 1]);
  return (
    <>
      <defs>
        <path id={`t-${thread.id}`} d={thread.d} />
        {writing && (
          <mask id={`m-${thread.id}`} maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
            <motion.path
              d={thread.d}
              fill="none"
              stroke="white"
              strokeWidth={thread.size * 2.4}
              style={{ pathLength: reveal }}
            />
          </mask>
        )}
      </defs>
      <text
        className="pointer-events-auto cursor-pointer fill-ink font-hand"
        fontSize={thread.size}
        fontWeight={WEIGHT[thread.kind]}
        letterSpacing={`${LETTER_SPACING}em`}
        // the spiral is the finer silk; the radials hold the web up
        opacity={thread.kind === 'spiral' ? 0.86 : 1}
        dy="0.32em"
        mask={writing ? `url(#m-${thread.id})` : undefined}
        // an outline in the cloth colour, so where two strands cross, the one on top stays readable
        stroke="var(--cloth)"
        strokeWidth={thread.size * 0.28}
        paintOrder="stroke"
        onClick={() => onPick(thread.id)}
      >
        <textPath href={`#t-${thread.id}`}>{thread.text}</textPath>
      </text>
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

  // `written` counts threads laid down so far: 3.4 means three done and the
  // fourth 40% written. `done` is its whole part, kept in state so React draws
  // exactly the finished threads plus the one in progress.
  const written = useMotionValue(0);
  const [done, setDone] = useState(0);
  useMotionValueEvent(written, 'change', (v) => setDone(Math.min(total, Math.floor(v))));

  // After the last thread the spider walks home: 0 = at the end of that thread, 1 = back on its ring.
  const home = useMotionValue(1);
  const lastTip = useRef<Point | null>(null);

  useEffect(() => {
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
      const current = layout.threads[index];
      if (current && v < total) {
        const u = v - index;
        const next = layout.threads[index + 1];
        if (u <= WRITING || !next) {
          lastTip.current = local(pointAlong(current.points, u / WRITING));
        } else {
          const from = current.points[current.points.length - 1]!;
          const to = next.points[0]!;
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
    [layout, total, written, home, cx, cy],
  );

  if (width === 0) return null;
  // Written in message order, but drawn spiral first and radials on top, as
  // in a real web: the radials stay whole and the spiral passes under them.
  const shown = layout.threads.slice(0, done + 1).map((thread, index) => ({ thread, index }));
  const layered = [...shown.filter((t) => t.thread.kind === 'spiral'), ...shown.filter((t) => t.thread.kind === 'radial')];
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
      {layered.map(({ thread, index }) => (
        <WordThread
          key={thread.id}
          thread={thread}
          index={index}
          written={written}
          writing={index === done}
          onPick={onPick}
        />
      ))}
      <g transform={`translate(${cx} ${cy})`}>
        <OrbitSpider rx={rx} ry={ry} errand={errand} ring="whole" />
      </g>
    </svg>
  );
}
