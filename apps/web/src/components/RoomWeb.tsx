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
import { pointAlong, WebLayout, type Point, type Run } from '../web/WebLayout';
import OrbitSpider from './OrbitSpider';

// A room's web, woven entirely from its messages (see web/WebLayout.ts). The
// spider writes it: when a room opens it writes out the newest message's
// words, and when a new one arrives it walks out and writes again.
//
// This is the decorative view. The same messages are always available in full
// as an ordinary list on the room screen, so nothing here is the only way to
// read anything.

const SECONDS_PER_RUN = 0.9;
const MAX_REPLAY_SECONDS = 6;
// Of the time given to each run of words, this share is spent writing it; the
// rest is the spider walking to where the next one starts.
const WRITING = 0.8;

function RunText({
  id,
  run,
  dy,
  reveal,
  onPick,
}: {
  id: string;
  run: Run;
  dy: number;
  /** While this run is being written: 0 to 1, how much of it is uncovered. */
  reveal?: MotionValue<number>;
  onPick: (id: string) => void;
}) {
  return (
    <>
      <defs>
        <path id={`t-${id}`} d={run.d} />
        {reveal && (
          <mask id={`m-${id}`} maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
            <motion.path d={run.d} fill="none" stroke="white" strokeWidth={run.size * 2.4} style={{ pathLength: reveal }} />
          </mask>
        )}
      </defs>
      <text
        className="pointer-events-auto cursor-pointer fill-ink font-hand"
        fontSize={run.size}
        fontWeight={run.weight}
        // rings are the finer silk
        opacity={run.kind === 'ring' ? 0.92 : 1}
        // centres the letters on the strand line, which the layout's no-overlap spacing assumes
        dy={`${dy.toFixed(3)}em`}
        mask={reveal ? `url(#m-${id})` : undefined}
        onClick={() => run.ids[0] && onPick(run.ids[0])}
      >
        {/* letters spaced to fill the strand exactly */}
        <textPath href={`#t-${id}`} textLength={run.length} lengthAdjust="spacing">
          {run.text}
        </textPath>
      </text>
    </>
  );
}

function WritingRun(props: { id: string; run: Run; dy: number; index: number; written: MotionValue<number>; onPick: (id: string) => void }) {
  const reveal = useTransform(props.written, [props.index, props.index + WRITING], [0, 1]);
  return <RunText id={props.id} run={props.run} dy={props.dy} reveal={reveal} onPick={props.onPick} />;
}

type Props = {
  width: number;
  height: number;
  seed: number;
  messages: Message[];
  /** Called when a strand is clicked, with that message's id. */
  onPick: (id: string) => void;
};

export default function RoomWeb({ width, height, seed, messages, onPick }: Props) {
  const fontReady = useFontReady('Quicksand Variable');
  const still = useReducedMotion();
  // fontReady is a dependency because the words are measured in the real font
  const layout = useMemo(() => new WebLayout(width, height, seed, messages), [width, height, seed, messages, fontReady]);
  const runs = layout.runs;
  const total = runs.length;
  const { cx, cy, rx, ry } = layout.hub;

  // The runs that belong to the newest message: those are what the spider writes when the room opens.
  const newestRuns = useMemo(() => {
    const newest = [...messages].sort((p, q) => q.position - p.position)[0]?.id;
    return newest ? runs.filter((r) => r.ids.includes(newest)).length : 0;
  }, [messages, runs]);

  // `written` counts runs laid down so far: 3.4 means three done and the
  // fourth 40% written. `done` is its whole part, kept in state so React draws
  // exactly the finished runs plus the one in progress.
  const written = useMotionValue(0);
  const [done, setDone] = useState(0);
  useMotionValueEvent(written, 'change', (v) => setDone(Math.min(total, Math.floor(v))));

  // After the last run the spider walks home: 0 = at the end of that run, 1 = back on its ring.
  const home = useMotionValue(1);
  const lastTip = useRef<Point | null>(null);

  // The newest message's words are written last, so the spider can be seen writing them.
  const order = useMemo(() => {
    const newest = [...messages].sort((p, q) => q.position - p.position)[0]?.id;
    const rest = runs.filter((r) => !newest || !r.ids.includes(newest));
    return [...rest, ...runs.filter((r) => newest && r.ids.includes(newest))];
  }, [messages, runs]);

  const opened = useRef(false);
  useEffect(() => {
    if (!opened.current && total > 0) {
      opened.current = true;
      const start = Math.max(0, total - Math.max(1, newestRuns));
      written.set(start);
      setDone(start);
    }
    const from = written.get();
    // nothing new to write (or fewer runs than before): just show them
    if (still || total <= from) {
      written.set(total);
      setDone(total);
      return;
    }
    home.set(0);
    const run = animate(written, total, {
      duration: Math.min(MAX_REPLAY_SECONDS, (total - from) * SECONDS_PER_RUN),
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
  }, [total, still, written, home, newestRuns]);

  // While writing, the spider is the tip of the words; between runs it walks
  // to the next one; then it walks back to its ring. Its group is centred on
  // the hub, while runs are in screen pixels.
  const errand = useCallback(
    (onLoop: Point): Point => {
      const local = (p: Point) => ({ x: p.x - cx, y: p.y - cy });
      const v = written.get();
      const index = Math.min(total - 1, Math.floor(v));
      const current = order[index];
      if (current && v < total) {
        const u = v - index;
        const next = order[index + 1];
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
    [order, total, written, home, cx, cy],
  );

  if (width === 0) return null;
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
      {order.slice(0, done + 1).map((run, index) => {
        const id = `${index}-${run.ids.join('-')}`;
        return index === done ? (
          <WritingRun key={id} id={id} run={run} dy={layout.dy} index={index} written={written} onPick={onPick} />
        ) : (
          <RunText key={id} id={id} run={run} dy={layout.dy} onPick={onPick} />
        );
      })}
      <g transform={`translate(${cx} ${cy})`}>
        {/* smaller on phones, where its legs would otherwise reach the words */}
        <OrbitSpider rx={rx} ry={ry} errand={errand} ring="whole" glyphScale={layout.wide ? 0.72 : 0.55} />
      </g>
    </svg>
  );
}
