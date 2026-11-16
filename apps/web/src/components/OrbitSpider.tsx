import { useCallback, useLayoutEffect, useRef } from 'react';
import { useAnimationFrame, useReducedMotion, type MotionValue } from 'motion/react';

// A spider that walks a slow loop around whatever sits at the origin, trailing
// silk. After one lap the silk closes into a ring, and it keeps pacing the ring.
// Render inside an <svg>, in a group translated to the centre it should circle.

const LAP_MS = 32_000; // slow on purpose: a patient walk, not a scuttle
const START = -Math.PI / 2;
const STEP = 0.05;

type Point = { x: number; y: number };

// The loop is an ellipse with a little wobble so it reads as hand-spun. The
// wobble uses whole multiples of the angle, so the loop closes exactly.
export function ringPoint(theta: number, rx: number, ry: number): Point {
  const f = 1 + 0.06 * Math.sin(3 * theta + 1) + 0.035 * Math.sin(5 * theta);
  return { x: rx * f * Math.cos(theta), y: ry * f * Math.sin(theta) };
}

function silkPath(from: number, to: number, rx: number, ry: number) {
  let d = '';
  for (let a = from; a < to; a += STEP) {
    const p = ringPoint(a, rx, ry);
    d += `${d ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  }
  const end = ringPoint(to, rx, ry);
  return `${d}${d ? 'L' : 'M'}${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
}

type Props = {
  rx: number;
  ry: number;
  /** Extra distance (radians) added to the walk, e.g. driven by scroll so the ring is finished on cue. */
  lead?: MotionValue<number>;
  /** Whether the spider leaves silk behind it. Off, it just paces its loop. */
  trail?: boolean;
  /**
   * Called every frame with where the spider would be on its loop; returns where
   * it should actually be. Lets the page send it off on errands (writing a
   * thread) and bring it back. Same coordinates as the loop: origin at the centre.
   */
  errand?: (onLoop: Point) => Point;
};

export default function OrbitSpider({ rx, ry, lead, trail = true, errand }: Props) {
  const spider = useRef<SVGGElement>(null);
  const silk = useRef<SVGPathElement>(null);
  const last = useRef<{ at: Point; heading: number } | null>(null);
  const still = useReducedMotion();

  // Written straight to the DOM: this runs every frame and must not re-render React.
  const place = useCallback(
    (theta: number, roam: boolean) => {
      const onLoop = ringPoint(theta, rx, ry);
      const p = roam && errand ? errand(onLoop) : onLoop;

      // It faces the way it is actually moving, turning smoothly. When it stands
      // still (scroll paused mid-thread) it keeps facing the way it was going.
      const prev = last.current;
      let heading = prev?.heading ?? Math.atan2(ry * Math.cos(theta), -rx * Math.sin(theta));
      if (prev && Math.hypot(p.x - prev.at.x, p.y - prev.at.y) > 0.15) {
        const want = Math.atan2(p.y - prev.at.y, p.x - prev.at.x);
        heading += Math.atan2(Math.sin(want - heading), Math.cos(want - heading)) * 0.25;
      }
      last.current = { at: p, heading };

      // the spider is drawn head-up, so +90° points its head along its path
      spider.current?.setAttribute(
        'transform',
        `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) rotate(${((heading * 180) / Math.PI + 90).toFixed(1)})`,
      );
      silk.current?.setAttribute('d', silkPath(Math.max(START, theta - 2 * Math.PI), theta, rx, ry));
    },
    [rx, ry, errand],
  );

  useAnimationFrame((ms) => {
    if (!still) place(START + (ms / LAP_MS) * 2 * Math.PI + (lead?.get() ?? 0), true);
  });

  // Reduced motion: the ring is already spun and the spider rests at the top.
  useLayoutEffect(() => {
    if (still) {
      last.current = null;
      place(START + 2 * Math.PI, false);
    }
  }, [still, place]);

  return (
    <g className="fill-ink stroke-ink" strokeLinecap="round" filter="url(#ink)">
      {/* Roughens every edge by about a pixel, so the vector lines read as drawn by hand. */}
      <filter id="ink" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="4" result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.6" />
      </filter>
      {trail && <path ref={silk} fill="none" strokeWidth={1.2} />}
      <g ref={spider}>
        {/* drawn head-up around its own middle; alternate legs step in turn */}
        <g transform="translate(0 -9)">
          <g fill="none" strokeWidth={1.5}>
            <g className={still ? '' : 'animate-step-a'} style={{ transformOrigin: '0px 9px' }}>
              <path d="M-3 4q-9-9-11-22M3 7q12-3 16-12" />
              <path d="M-3 11q-12 2-15 14M3 14q8 8 8 26" />
            </g>
            <g className={still ? '' : 'animate-step-b'} style={{ transformOrigin: '0px 9px' }}>
              <path d="M3 4q9-9 11-22M-3 7q-12-3-16-12" />
              <path d="M3 11q12 2 15 14M-3 14q-8 8-8 26" />
            </g>
          </g>
          <ellipse cx="0" cy="3" rx="4.4" ry="4.8" stroke="none" />
          <ellipse cx="0" cy="15" rx="6.8" ry="9.6" stroke="none" />
        </g>
      </g>
    </g>
  );
}
