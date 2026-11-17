import { useCallback, useMemo, useRef } from 'react';
import { motion, useScroll, useTransform, type MotionValue } from 'motion/react';
import { Link } from 'react-router';
import ApiStatus from '../components/ApiStatus';
import { Corner, HelpLink, Wordmark } from '../components/Chrome';
import OrbitSpider from '../components/OrbitSpider';
import { useElementSize } from '../hooks/useElementSize';
import { useFontReady } from '../hooks/useFontReady';
import { FONT, LandingScene, TIMELINE, WORRY, type Point, type Thread } from '../landing/LandingScene';
import { useSession } from '../session';

// The landing page is one pinned scene that scrolling plays through:
//   the title, circled by the spider
//   -> the title becomes someone's worry
//   -> kind replies arrive, and each sentence IS a thread: the spider leaves
//      its loop and writes each one, the letters appearing behind it
// Three short captions are the only explanation.
//
// This file only draws. Where things are and when they happen is decided by
// LandingScene.

// One reply: a sentence written along its thread, revealed from its left end
// onward as the spider walks it.
function WordThread({ id, thread, progress }: { id: string; thread: Thread; progress: MotionValue<number> }) {
  const pathLength = useTransform(progress, [thread.startsAt, thread.startsAt + TIMELINE.write], [0, 1]);
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
  const scroller = useRef<HTMLDivElement>(null);
  const [stage, { width, height }] = useElementSize<HTMLDivElement>();
  const { scrollYProgress: progress } = useScroll({ target: scroller, offset: ['start start', 'end end'] });
  const fontReady = useFontReady(FONT);
  const { user, loading } = useSession();

  const titleOpacity = useTransform(progress, TIMELINE.titleOut, [1, 0]);
  const worryOpacity = useTransform(progress, TIMELINE.worryIn, [0, 1]);
  const hintOpacity = useTransform(progress, [0, 0.04], [1, 0]);
  const lead = useTransform(progress, TIMELINE.ringDoneBy, [0, 2 * Math.PI]);
  const inviteOpacity = useTransform(progress, [TIMELINE.inviteAt, TIMELINE.inviteAt + 0.05], [0, 1]);
  const invitePointer = useTransform(progress, (p) => (p > TIMELINE.inviteAt ? 'auto' : 'none'));

  // fontReady is a dependency because sentence widths are measured in the real font
  const scene = useMemo(() => new LandingScene(width, height), [width, height, fontReady]);

  // The spider is drawn in a group centred on the screen (and shrunk on phones),
  // while the scene works in screen pixels, so convert on the way in and out.
  const errand = useCallback(
    (onLoop: Point): Point => {
      const cx = scene.width / 2;
      const cy = scene.height / 2;
      const s = scene.spiderScale;
      const at = scene.spiderAt(progress.get(), { x: cx + onLoop.x * s, y: cy + onLoop.y * s });
      return { x: (at.x - cx) / s, y: (at.y - cy) / s };
    },
    [progress, scene],
  );

  return (
    // Tall, so there is distance to scroll; the stage inside stays pinned to the screen.
    <div ref={scroller} className="h-[600vh]">
      <div ref={stage} className="sticky top-0 h-dvh overflow-hidden">
        {width > 0 && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full">
            {scene.threads.map((thread, i) => (
              <WordThread key={i} id={`reply-${i}`} thread={thread} progress={progress} />
            ))}
            <g
              transform={`translate(${width / 2} ${height / 2}) scale(${scene.spiderScale})`}
              aria-hidden="true"
            >
              {/* the group is scaled down on phones, so the loop is scaled up to stay the same size */}
              <OrbitSpider
                rx={scene.rx / scene.spiderScale}
                ry={scene.ry / scene.spiderScale}
                lead={lead}
                trail={scene.wide}
                errand={errand}
              />
            </g>
          </svg>
        )}

        <Wordmark className="absolute top-8 left-6 z-10" />
        <Corner className="absolute top-7 right-6 z-10" />

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
          {TIMELINE.captions.map((caption) => (
            <Caption key={caption.text} {...caption} progress={progress} />
          ))}
          {/* Where the story ends, the way in. Clickable only once it has faded in. */}
          {!loading && !user && (
            <motion.div
              className="absolute inset-x-0 top-7 text-center"
              style={{ opacity: inviteOpacity, pointerEvents: invitePointer }}
            >
              <Link to="/sign-in" className="text-sm font-medium text-ink underline decoration-1 underline-offset-4">
                leave yours
              </Link>
            </motion.div>
          )}
        </div>

        {/* A short strand near the bottom: "there is more below". On phones it sits above the help link. */}
        <motion.div
          className="absolute bottom-14 left-1/2 h-10 w-px animate-pulse bg-ink-soft lg:bottom-0 lg:h-14"
          style={{ opacity: hintOpacity }}
          aria-hidden="true"
        />

        <footer className="absolute inset-x-6 bottom-5 flex justify-between gap-4 text-sm font-medium text-ink-soft">
          <HelpLink />
          {import.meta.env.DEV && <ApiStatus />}
        </footer>
      </div>
    </div>
  );
}
