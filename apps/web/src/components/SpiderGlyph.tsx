// The spider itself, drawn head-up with its body centred on the origin, about
// 60 units tall. An SVG <g>: place and rotate it from outside.
//
// Legs are thin jointed lines, long in front and behind like the spider in the
// original reference drawing. They are split into two sets that step in turn
// (front-right with second-left and so on), the way a real spider walks.

// Right-hand legs as hip -> knee -> foot. The left side is the mirror image.
const LEGS = [
  'M2.5 -6 L11 -17 L14 -31',
  'M3.5 -4 L16 -10 L27 -5',
  'M3.5 -1 L16 4 L25 15',
  'M2.5 1 L10 14 L13 30',
];
const mirror = (d: string) => d.replace(/([ML])(-?[\d.]+)/g, (_, cmd: string, x: string) => `${cmd}${-Number(x)}`);

// set A: right 1, left 2, right 3, left 4.  set B: the other four.
const SET_A = [LEGS[0]!, mirror(LEGS[1]!), LEGS[2]!, mirror(LEGS[3]!)].join('');
const SET_B = [mirror(LEGS[0]!), LEGS[1]!, mirror(LEGS[2]!), LEGS[3]!].join('');

export default function SpiderGlyph({ walking = false }: { walking?: boolean }) {
  return (
    <g className="fill-ink stroke-ink" strokeLinecap="round" strokeLinejoin="round">
      <g fill="none" strokeWidth={1.25}>
        <path d={SET_A} className={walking ? 'animate-step-a' : ''} />
        <path d={SET_B} className={walking ? 'animate-step-b' : ''} />
        {/* the two short feelers at the front */}
        <path d="M-1.6 -8 L-3 -12 M1.6 -8 L3 -12" />
      </g>
      <ellipse cx="0" cy="-4.5" rx="3.6" ry="4" stroke="none" />
      <ellipse cx="0" cy="5.5" rx="5.4" ry="7.6" stroke="none" />
    </g>
  );
}
