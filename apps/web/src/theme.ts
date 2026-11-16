// The visitor's choice of background: which cloth colour, and whether it shows
// a woven texture. Stored in the browser and applied as attributes on <html>,
// which the stylesheet reads (see "cloth" in styles/index.css).

export const CLOTHS = ['denim', 'suede', 'olive'] as const;
export type Cloth = (typeof CLOTHS)[number];
export type Theme = { cloth: Cloth; texture: boolean };

const KEY = 'theme';
const DEFAULT: Theme = { cloth: 'denim', texture: false };

export function loadTheme(): Theme {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Theme> | null;
    return {
      cloth: CLOTHS.find((c) => c === saved?.cloth) ?? DEFAULT.cloth,
      texture: typeof saved?.texture === 'boolean' ? saved.texture : DEFAULT.texture,
    };
  } catch {
    // storage blocked or holding something unreadable: fall back to the default look
    return DEFAULT;
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.cloth = theme.cloth;
  document.documentElement.dataset.texture = theme.texture ? 'on' : 'off';
}

export function saveTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, JSON.stringify(theme));
  } catch {
    // private windows can refuse storage; the choice then just lasts until the page closes
  }
}
