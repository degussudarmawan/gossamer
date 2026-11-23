import { useMemo } from 'react';
import { encode } from 'uqr';

type Props = {
  /** The text the code holds, usually a link. */
  value: string;
  /** Read out by screen readers in place of the picture. */
  label: string;
  className?: string;
};

// Four squares of blank space round the edge. The QR standard asks for this
// margin so a camera can tell where the code starts.
const MARGIN = 4;

/**
 * A QR code, made in the browser and drawn as one SVG path. Nothing is sent
 * anywhere to draw it, which matters when it holds an invite code.
 *
 * It is dark squares on a cream tile in every theme. Phone cameras need dark
 * on light with strong contrast, and the site's gold on cloth doesn't give that.
 * The squares are the visitor's cloth colour, deepened.
 */
export default function QrCode({ value, label, className = '' }: Props) {
  const { size, path } = useMemo(() => {
    // 'M' still reads with 15% of the code lost: glare on a screen, a smudge.
    const qr = encode(value, { ecc: 'M', border: MARGIN });
    let d = '';
    qr.data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { size: qr.size, path: d };
  }, [value]);

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      // squares edge to edge, with no blurred seams between neighbours
      shapeRendering="crispEdges"
      className={`rounded-xl bg-ink-soft ${className}`}
    >
      <path d={path} style={{ fill: 'color-mix(in oklab, var(--cloth), black 55%)' }} />
    </svg>
  );
}
