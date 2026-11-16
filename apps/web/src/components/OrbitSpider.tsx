import { useCallback, useLayoutEffect, useRef } from 'react';
import { useAnimationFrame, useReducedMotion, type MotionValue } from 'motion/react';

// A spider that walks a slow loop around whatever sits at the origin, trailing
// silk. After one lap the silk closes into a ring, and it keeps pacing the ring.
// Render inside an <svg>, in a group translated to the centre it should circle.

const LAP_MS = 32_000; // slow on purpose: a patient walk, not a scuttle
const START = -Math.PI / 2;
const STEP = 0.05;

// The loop is an ellipse with a little wobble so it reads as hand-spun. The
// wobble uses whole multiples of the angle, so the loop closes exactly.
export function ringPoint(theta: number, rx: number, ry: number) {
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
};

export default function OrbitSpider({ rx, ry, lead }: Props) {
  const spider = useRef<SVGGElement>(null);
  const silk = useRef<SVGPathElement>(null);
  const still = useReducedMotion();

  // Written straight to the DOM: this runs every frame and must not re-render React.
  const place = useCallback(
    (theta: number) => {
      const p = ringPoint(theta, rx, ry);
      const ahead = ringPoint(theta + 0.01, rx, ry);
      const heading = (Math.atan2(ahead.y - p.y, ahead.x - p.x) * 180) / Math.PI;
      // the spider is drawn head-up, so +90° points its head along the path
      spider.current?.setAttribute('transform', `translate(${p.x} ${p.y}) rotate(${heading + 90})`);
      silk.current?.setAttribute('d', silkPath(Math.max(START, theta - 2 * Math.PI), theta, rx, ry));
    },
    [rx, ry],
  );

  useAnimationFrame((ms) => {
    if (!still) place(START + (ms / LAP_MS) * 2 * Math.PI + (lead?.get() ?? 0));
  });

  // Reduced motion: the ring is already spun and the spider rests at the top.
  useLayoutEffect(() => {
    if (still) place(START + 2 * Math.PI);
  }, [still, place]);

  return (
    <g className="fill-ink stroke-ink" strokeLinecap="round" filter="url(#ink)">
      {/* Roughens every edge by about a pixel, so the vector lines read as pen on paper. */}
      <filter id="ink" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="4" result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.6" />
      </filter>
      <path ref={silk} fill="none" strokeWidth={1.2} />
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
