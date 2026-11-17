import { useState } from 'react';
import { CLOTHS } from '../lib/ThemeStore';
import { themeStore } from '../services';

const SWATCH = { denim: 'bg-denim', suede: 'bg-suede', olive: 'bg-olive' } as const;

// Three colour dots and a texture switch. The choice applies at once and is
// remembered for next time. The store holds the truth; this state only mirrors
// it so the buttons redraw.
export default function ThemePicker({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState(themeStore.current);

  return (
    <div className={`flex items-center gap-3 text-sm font-medium text-ink-soft ${className}`}>
      <div className="flex items-center gap-2" role="group" aria-label="background colour">
        {CLOTHS.map((cloth) => (
          <button
            key={cloth}
            type="button"
            aria-label={cloth}
            aria-pressed={theme.cloth === cloth}
            onClick={() => setTheme(themeStore.change({ cloth }))}
            className={`size-4 cursor-pointer rounded-full border border-ink-soft/70 ${SWATCH[cloth]} ${
              theme.cloth === cloth ? 'outline-2 outline-offset-2 outline-ink' : ''
            }`}
          />
        ))}
      </div>
      <button
        type="button"
        aria-pressed={theme.texture}
        onClick={() => setTheme(themeStore.change({ texture: !themeStore.current.texture }))}
        className="cursor-pointer underline decoration-1 underline-offset-4"
      >
        texture {theme.texture ? 'on' : 'off'}
      </button>
    </div>
  );
}
