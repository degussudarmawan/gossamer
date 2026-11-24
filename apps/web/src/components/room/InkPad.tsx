import { useRef, type PointerEvent } from 'react';
import { useElementSize } from '../../hooks/useElementSize';
import { INK_LIMITS, LINE, PEN, finishStroke, inkSize, pointsOf, smoothPath, type Ink, type InkPoint } from '../../lib/ink';
import { note, quiet } from '../ui';

/** Ruled lines on the pad. */
const LINES = 3;
/** Where each ruled line is drawn, as a share of its line's height down from the top: the writing sits on it. */
const RULE = 0.75;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Props = {
  /** What has been written so far; null before the first stroke. */
  value: Ink | null;
  onChange: (ink: Ink | null) => void;
};

// The pad a handwritten note is written on: three faint ruled lines, like notepaper,
// written on with a finger, pen or mouse. What is drawn is kept as pen strokes (see
// lib/ink.ts), not as a picture, so it can later be bent along a strand of the web.
export default function InkPad({ value, onChange }: Props) {
  const [box, { width: px }] = useElementSize<HTMLDivElement>();
  // A line is an eighth of the pad's width, kept between 40 and 56 px. Once something
  // is written the pad keeps its proportions, so turning a phone only rescales it.
  const line = clamp(px / 8, 40, 56);
  const measured = px > 0 ? clamp(Math.round((px / line) * LINE), INK_LIMITS.width.min, INK_LIMITS.width.max) : 0;
  const width = value?.width ?? measured;
  const height = LINES * LINE;
  const strokes = value?.strokes ?? [];

  const svg = useRef<SVGSVGElement>(null);
  // The stroke being drawn is drawn straight into this path, without React, and
  // handed over on pen-up.
  const live = useRef<SVGPathElement>(null);
  const drawing = useRef<{ id: number; points: InkPoint[] } | null>(null);
  // once a pen has touched the pad, touches are a resting hand and are ignored
  const penSeen = useRef(false);

  // too little room left for another stroke
  const full = strokes.length >= INK_LIMITS.strokes || inkSize(strokes) > INK_LIMITS.numbers - 4;

  const toInk = (e: { clientX: number; clientY: number }): InkPoint => {
    const r = svg.current!.getBoundingClientRect();
    return {
      x: clamp(((e.clientX - r.left) / r.width) * width, 0, width),
      y: clamp(((e.clientY - r.top) / r.height) * height, 0, height),
    };
  };

  const down = (e: PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'pen') penSeen.current = true;
    if (e.pointerType === 'touch' && penSeen.current) return;
    // one stroke at a time, and only the main button (a pen's tip, a finger, the left mouse button)
    if (drawing.current || full || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = { id: e.pointerId, points: [toInk(e)] };
    live.current?.setAttribute('d', smoothPath(drawing.current.points));
  };

  const move = (e: PointerEvent<SVGSVGElement>) => {
    const stroke = drawing.current;
    if (!stroke || e.pointerId !== stroke.id) return;
    // every position since the last event, not only the latest, so fast writing stays smooth
    const all = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const ev of all.length ? all : [e.nativeEvent]) stroke.points.push(toInk(ev));
    live.current?.setAttribute('d', smoothPath(stroke.points));
  };

  const end = (e: PointerEvent<SVGSVGElement>, keep: boolean) => {
    const stroke = drawing.current;
    if (!stroke || e.pointerId !== stroke.id) return;
    drawing.current = null;
    live.current?.setAttribute('d', '');
    if (!keep) return;
    // whatever still fits in a note
    let room = INK_LIMITS.numbers - inkSize(strokes);
    const added: number[][] = [];
    for (const piece of finishStroke(stroke.points)) {
      if (strokes.length + added.length >= INK_LIMITS.strokes || piece.length > room) break;
      added.push(piece);
      room -= piece.length;
    }
    if (added.length) onChange({ v: 1, lines: LINES, width, strokes: [...strokes, ...added] });
  };

  const undo = () => onChange(strokes.length > 1 && value ? { ...value, strokes: strokes.slice(0, -1) } : null);

  return (
    <div className="grid gap-2">
      {/* the same thin outline as the box for typing */}
      <div ref={box} className="w-full overflow-hidden rounded-xl border border-ink-soft/50">
        {width > 0 && (
          <svg
            ref={svg}
            viewBox={`0 0 ${width} ${height}`}
            style={{ aspectRatio: `${width} / ${height}` }}
            // no scrolling or zooming while writing on it
            className="block w-full cursor-crosshair touch-none select-none"
            role="img"
            aria-label="handwriting pad: write with a finger, pen or mouse"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={(e) => end(e, true)}
            onPointerCancel={(e) => end(e, false)}
          >
            {Array.from({ length: LINES }, (_, k) => (
              <line
                key={k}
                x1={LINE * 0.2}
                x2={width - LINE * 0.2}
                y1={(k + RULE) * LINE}
                y2={(k + RULE) * LINE}
                className="stroke-ink-soft/25"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <g fill="none" className="stroke-ink" strokeWidth={PEN * LINE} strokeLinecap="round" strokeLinejoin="round">
              {strokes.map((s, i) => (
                <path key={i} d={smoothPath(pointsOf(s), 1)} />
              ))}
              <path ref={live} />
            </g>
          </svg>
        )}
      </div>
      <div className="flex items-baseline justify-between gap-4">
        <p role="status" className={note}>
          {full ? 'the page is full.' : ''}
        </p>
        <div className="flex gap-4">
          <button type="button" disabled={strokes.length === 0} onClick={undo} className={`${quiet} disabled:opacity-40`}>
            undo
          </button>
          <button type="button" disabled={strokes.length === 0} onClick={() => onChange(null)} className={`${quiet} disabled:opacity-40`}>
            clear
          </button>
        </div>
      </div>
    </div>
  );
}
