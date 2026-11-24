import { useEffect, useRef, useState, type PointerEvent } from 'react';
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
//
// It comes in two sizes: small, inside the panel, and full size, covering the screen
// for writing big with a finger (as in a phone's notes app).
export default function InkPad({ value, onChange }: Props) {
  const [fullSize, setFullSize] = useState(false);
  // the room the pad has: the panel's width when small, the whole screen when full size
  const [frame, { width: roomX, height: roomY }] = useElementSize<HTMLDivElement>();
  // How tall a line is, in px, when the pad is blank. Small: an eighth of the pad's width,
  // between 40 and 56 px. Full size: twice that on a phone (a 4.5th of the width), as
  // tall as the screen allows, at most 120 px. Once something is written the pad keeps
  // its proportions, so changing size, or turning a phone, only rescales the same page.
  const line = fullSize ? clamp(Math.min(roomX / 4.5, roomY / LINES), 40, 120) : clamp(roomX / 8, 40, 56);
  const measured = roomX > 0 ? clamp(Math.round((roomX / line) * LINE), INK_LIMITS.width.min, INK_LIMITS.width.max) : 0;
  const width = value?.width ?? measured;
  const height = LINES * LINE;
  const strokes = value?.strokes ?? [];
  // Full size, the page is as big as fits on the screen. Small, it is as wide as the panel.
  // (Both less the outline's 1 px border on each side.)
  const fitted = fullSize && width > 0 ? Math.max(0, Math.min(roomX - 2, ((roomY - 2) * width) / height)) + 2 : undefined;

  // Escape leaves full size, rather than closing the panel and losing the drawing. This
  // listens before the panel does, and the panel doesn't close for a refused Escape.
  useEffect(() => {
    if (!fullSize) return;
    const back = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setFullSize(false);
    };
    window.addEventListener('keydown', back, true);
    return () => window.removeEventListener('keydown', back, true);
  }, [fullSize]);

  const svg = useRef<SVGSVGElement>(null);
  // The stroke being drawn is drawn straight into this path, without React, and
  // handed over on pen-up.
  const live = useRef<SVGPathElement>(null);
  const drawing = useRef<{ id: number; points: InkPoint[] } | null>(null);
  // once a pen has touched the pad, touches are a resting hand and are ignored
  const penSeen = useRef(false);

  // A finger on the pad is always writing, never scrolling the panel or zooming the
  // page. touch-action alone isn't enough: Safari doesn't reliably honour it on an
  // SVG, takes a moving finger for a scroll, and cancels the stroke part way. Refusing
  // the touch itself keeps it on the pad (pointer events still arrive). React's own
  // touch listeners are passive and can't refuse anything, hence addEventListener.
  const hasPad = width > 0;
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const hold = (e: TouchEvent) => e.preventDefault();
    el.addEventListener('touchstart', hold, { passive: false });
    el.addEventListener('touchmove', hold, { passive: false });
    return () => {
      el.removeEventListener('touchstart', hold);
      el.removeEventListener('touchmove', hold);
    };
  }, [hasPad]);

  // too little room left for another stroke
  const pageFull = strokes.length >= INK_LIMITS.strokes || inkSize(strokes) > INK_LIMITS.numbers - 4;

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
    if (drawing.current || pageFull || e.button !== 0) return;
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

  // Pen up. Also when the browser cancels the stroke part way (a phone taking the
  // touch for a gesture of its own): what was drawn stays, as in a notes app.
  const end = (e: PointerEvent<SVGSVGElement>) => {
    const stroke = drawing.current;
    if (!stroke || e.pointerId !== stroke.id) return;
    drawing.current = null;
    live.current?.setAttribute('d', '');
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

  // The same elements in both sizes, only styled differently, so changing size never
  // remounts the pad (or drops a stroke being written).
  return (
    <div
      className={
        fullSize
          ? // over the whole screen (and the rest of the panel), in the panel's cloth; touches here never scroll what's behind
            'fixed inset-0 z-10 flex touch-none flex-col gap-3 overscroll-contain bg-(--cloth) p-4'
          : 'grid gap-2'
      }
    >
      <div ref={frame} className={fullSize ? 'grid min-h-0 flex-1 place-items-center' : undefined}>
        {/* the same thin outline as the box for typing */}
        <div className="touch-none overflow-hidden rounded-xl border border-ink-soft/50" style={fitted ? { width: fitted } : undefined}>
          {hasPad && (
            <svg
              ref={svg}
              viewBox={`0 0 ${width} ${height}`}
              style={{ aspectRatio: `${width} / ${height}` }}
              // no scrolling, zooming, selecting or press-and-hold menu while writing on it
              className="block w-full cursor-crosshair touch-none select-none [-webkit-touch-callout:none]"
              role="img"
              aria-label="handwriting pad: write with a finger, pen or mouse"
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              // if the pad loses the pointer without either (rare), the stroke still ends, so the next can start
              onLostPointerCapture={end}
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
      </div>
      <div className="flex items-baseline justify-between gap-4">
        <p role="status" className={note}>
          {pageFull ? 'the page is full.' : ''}
        </p>
        <div className="flex gap-4">
          <button type="button" onClick={() => setFullSize(!fullSize)} className={quiet}>
            {fullSize ? 'small size' : 'full size'}
          </button>
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
