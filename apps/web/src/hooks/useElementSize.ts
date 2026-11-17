import { useLayoutEffect, useState } from 'react';

/**
 * Live pixel size of an element, for drawings that are laid out in real pixels.
 * Returns a ref to put on the element, and its size.
 *
 * The ref is a callback, not an object, so it also works for an element that
 * only appears later (after data has loaded, say): measuring starts whenever
 * the element actually arrives.
 */
export function useElementSize<T extends HTMLElement>() {
  const [element, setElement] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return [setElement, size] as const;
}
