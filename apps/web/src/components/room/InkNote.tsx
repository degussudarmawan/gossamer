import { LINE, PEN, pointsOf, smoothPath, type Ink } from '../../lib/ink';

/**
 * A handwritten note exactly as it was written: on its lines, at the pad's width,
 * cropped above and below to the writing. No ruled lines, only the hand.
 */
export default function InkNote({ ink, label }: { ink: Ink; label: string }) {
  const strokes = ink.strokes.map(pointsOf);
  const ys = strokes.flatMap((s) => s.map((p) => p.y));
  const margin = LINE * 0.15;
  const top = Math.min(...ys) - margin;
  const height = Math.max(...ys) + margin - top;
  return (
    <svg
      viewBox={`0 ${top} ${ink.width} ${height}`}
      style={{ aspectRatio: `${ink.width} / ${height}` }}
      className="block w-full"
      role="img"
      aria-label={label}
    >
      <g fill="none" className="stroke-ink" strokeWidth={PEN * LINE} strokeLinecap="round" strokeLinejoin="round">
        {strokes.map((s, i) => (
          <path key={i} d={smoothPath(s, 1)} />
        ))}
      </g>
    </svg>
  );
}
