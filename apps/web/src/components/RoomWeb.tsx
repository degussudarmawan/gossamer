import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, useMotionValue, useMotionValueEvent, useReducedMotion, useTransform, type MotionValue } from 'motion/react';
import { pointAlong, type Point, type Run, type WebLayout } from '../web/WebLayout';
import OrbitSpider from './OrbitSpider';

// A room's web, woven entirely from its messages (see web/WebLayout.ts). The
// visitor's scrolling has the spider write it, as on the landing page: at the
// top of the page there is only the title; scrolling down, the spider leaves
// its ring and writes the notes one by one (it is the tip of the words as they
// appear), first the rays, then the strandies, then walks back to its ring.
// Scrolling up un-writes them.
//
// This is the decorative view. The same messages are always available in full
// as an ordinary list on the room screen, so nothing here is the only way to
// read anything.

// Of the scroll given to each run of words, this share is spent writing it; the
// rest is the spider walking to where the next one starts.
const WRITING = 0.8;

// Scroll distances, in screen heights: before the first note (the visitor reads
// the instruction, then the spider walks out), for each note (less when there
// are many, so all of them together never take more than MOST), and for the walk
// home after the last. Doubled at the owner's request, so the writing is slow
// enough to read as it appears.
const LEAD = 0.8;
const PER_RUN = 1;
const MOST = 14;
const HOME = 0.8;
/** Of the lead, the share before the spider sets out. */
const SET_OUT = 0.45;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (u: number) => u * u * (3 - 2 * u);
const TAU = Math.PI * 2;
/** How far round from the top (12 o'clock), clockwise, a direction is: 0 to 2π. */
const fromTop = (angle: number) => (((angle + Math.PI / 2) % TAU) + TAU) % TAU;

export type ScrollPlan = {
  /** How tall the page is, in screen heights. */
  screens: number;
  /** Where in the scroll (0 to 1) the writing starts and ends. */
  start: number;
  end: number;
};

/** How far the room's page scrolls so that scrolling writes `runs` runs of words. No runs, no scrolling. */
export function scrollPlan(runs: number): ScrollPlan {
  if (runs === 0) return { screens: 1, start: 0, end: 1 };
  const per = Math.min(PER_RUN, MOST / runs);
  const span = LEAD + runs * per + HOME;
  return { screens: 1 + span, start: LEAD / span, end: (LEAD + runs * per) / span };
}

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
            {/* wide enough to uncover the letters, or handwriting that reaches further */}
            <motion.path
              d={run.d}
              fill="none"
              stroke="white"
              strokeWidth={Math.max(run.size * 2.4, (run.ink?.reach ?? 0) * 2.2)}
              style={{ pathLength: reveal }}
            />
          </mask>
        )}
      </defs>
      {run.ink ? (
        // A handwritten note: the writer's own strokes, already bent along the strand by
        // the layout, under the same reveal as typed words. Pen lines are too thin to aim
        // at, so an unseen wider line along the strand takes the click.
        <>
          <path
            d={run.ink.d}
            fill="none"
            className="stroke-ink"
            strokeWidth={run.ink.pen}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={run.kind === 'ring' ? 0.92 : 1}
            mask={reveal ? `url(#m-${id})` : undefined}
          />
          <path
            d={run.d}
            fill="none"
            stroke="transparent"
            strokeWidth={run.size * 1.2}
            className="pointer-events-auto cursor-pointer"
            onClick={() => run.ids[0] && onPick(run.ids[0])}
          />
        </>
      ) : (
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
      )}
    </>
  );
}

function WritingRun(props: { id: string; run: Run; dy: number; index: number; written: MotionValue<number>; onPick: (id: string) => void }) {
  const reveal = useTransform(props.written, [props.index, props.index + WRITING], [0, 1]);
  return <RunText id={props.id} run={props.run} dy={props.dy} reveal={reveal} onPick={props.onPick} />;
}

type Props = {
  /** The web for this screen and these messages (the room page lays it out, to size its scroll). */
  layout: WebLayout;
  /** How far down the page the visitor has scrolled, in px. */
  scrollY: MotionValue<number>;
  /** Where in the page's scroll the writing happens (see scrollPlan). */
  plan: ScrollPlan;
  /** Called when a strand is clicked, with that message's id. */
  onPick: (id: string) => void;
};

export default function RoomWeb({ layout, scrollY, plan, onPick }: Props) {
  const still = useReducedMotion();
  const runs = layout.runs;
  const total = runs.length;
  const { cx, cy, rx, ry } = layout.hub;

  // The order the spider writes in (the owner's call): all the rays first, then
  // the strandies, the inner ones before the outer. Each sweeps clockwise from the
  // top, so the spider goes round the web rather than jumping about. Runs sharing
  // a strand keep the order they were written in.
  const order = useMemo(() => {
    const rank = (r: Run) => (r.kind === 'spoke' ? 0 : 2 - r.depth);
    return [...runs].sort((p, q) => rank(p) - rank(q) || fromTop(p.angle) - fromTop(q.angle));
  }, [runs]);

  // `written` counts runs laid down so far: 3.4 means three done and the
  // fourth 40% written. `done` is its whole part, kept in state so React draws
  // exactly the finished runs plus the one in progress.
  const written = useMotionValue(0);
  const [done, setDone] = useState(0);
  useMotionValueEvent(written, 'change', (v) => setDone(Math.min(total, Math.floor(v))));
  // Before the first run the spider walks out to it: 0 = on its ring, 1 = at the start.
  const out = useMotionValue(0);
  // After the last run it walks home: 0 = at the end of that run, 1 = back on its ring.
  const home = useMotionValue(0);

  // The scroll drives all three: walking out during the lead, writing between
  // plan.start and plan.end, walking home after. Progress is worked out here from
  // the page as it is now: a page that can't scroll (yet) is at the start, never
  // at the end, so nothing shows before the visitor scrolls.
  const follow = useCallback(
    (y: number) => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      const p = scrollable >= 1 ? clamp01(y / scrollable) : 0;
      const setOut = plan.start * SET_OUT;
      out.set(clamp01((p - setOut) / (plan.start - setOut || 1)));
      written.set(clamp01((p - plan.start) / (plan.end - plan.start || 1)) * total);
      home.set(plan.end >= 1 ? 1 : clamp01((p - plan.end) / (1 - plan.end)));
    },
    [plan, total, out, written, home],
  );
  useMotionValueEvent(scrollY, 'change', follow);
  // and again whenever the web itself changes (a new note, a resize), without waiting for a scroll
  useEffect(() => follow(scrollY.get()), [follow, scrollY]);

  // While writing, the spider is the tip of the words; between runs it walks
  // to the next one; then it walks back to its ring. With reduced motion it
  // stays on its ring and the words still appear with scrolling. Its group is
  // centred on the hub, while runs are in screen pixels.
  const errand = useCallback(
    (onLoop: Point): Point => {
      if (still || total === 0) return onLoop;
      const local = (p: Point) => ({ x: p.x - cx, y: p.y - cy });
      const toward = (from: Point, to: Point, t: number) => ({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
      const v = written.get();
      if (v <= 0) return toward(onLoop, local(order[0]!.points[0]!), smooth(out.get()));
      if (v < total) {
        const index = Math.floor(v);
        const current = order[index]!;
        const next = order[index + 1];
        const u = v - index;
        if (u <= WRITING || !next) return local(pointAlong(current.points, u / WRITING));
        return local(toward(current.points[current.points.length - 1]!, next.points[0]!, (u - WRITING) / (1 - WRITING)));
      }
      const last = order[total - 1]!;
      return toward(local(last.points[last.points.length - 1]!), onLoop, smooth(home.get()));
    },
    [still, total, order, written, out, home, cx, cy],
  );

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
