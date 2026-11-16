import { useEffect, useState } from 'react';
import { applyTheme, CLOTHS, loadTheme, saveTheme, type Theme } from '../theme';

const SWATCH = { denim: 'bg-denim', suede: 'bg-suede', olive: 'bg-olive' } as const;

// Three colour dots and a texture switch. The choice applies at once and is
// remembered for next time.
export default function ThemePicker({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState(loadTheme);

  useEffect(() => {
    applyTheme(theme);
    saveTheme(theme);
  }, [theme]);

  // built from the previous value, so two quick changes can't overwrite each other
  const change = (patch: Partial<Theme>) => setTheme((prev) => ({ ...prev, ...patch }));

  return (
    <div className={`flex items-center gap-3 text-sm font-medium text-ink-soft ${className}`}>
      <div className="flex items-center gap-2" role="group" aria-label="background colour">
        {CLOTHS.map((cloth) => (
          <button
            key={cloth}
            type="button"
            aria-label={cloth}
            aria-pressed={theme.cloth === cloth}
            onClick={() => change({ cloth })}
            className={`size-4 cursor-pointer rounded-full border border-ink-soft/70 ${SWATCH[cloth]} ${
              theme.cloth === cloth ? 'outline-2 outline-offset-2 outline-ink' : ''
            }`}
          />
        ))}
      </div>
      <button
        type="button"
        aria-pressed={theme.texture}
        onClick={() => change({ texture: !theme.texture })}
        className="cursor-pointer underline decoration-1 underline-offset-4"
      >
        texture {theme.texture ? 'on' : 'off'}
      </button>
    </div>
  );
}
