import { useEffect, useState } from 'react';

// True once the named web font has loaded. Anything that measures text has to
// wait for this, or it measures the fallback font instead.
export function useFontReady(family: string) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    const done = () => {
      if (alive) setReady(true);
    };
    // If the font fails to load we still proceed, measuring whatever the browser fell back to.
    document.fonts.load(`400 20px "${family}"`).then(done, done);
    return () => {
      alive = false;
    };
  }, [family]);

  return ready;
}
