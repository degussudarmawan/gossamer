export const CLOTHS = ['denim', 'suede', 'olive'] as const;
export type Cloth = (typeof CLOTHS)[number];
export type Theme = { cloth: Cloth; texture: boolean };

/**
 * The visitor's choice of background: which cloth colour, and whether it shows
 * a woven texture. Remembered in the browser and shown by setting attributes
 * on <html>, which the stylesheet reads (see "cloth" in styles/index.css).
 */
export class ThemeStore {
  private static readonly KEY = 'theme';
  private static readonly DEFAULT: Theme = { cloth: 'denim', texture: false };

  private theme: Theme;

  constructor() {
    this.theme = this.read();
  }

  get current(): Theme {
    return this.theme;
  }

  /** Puts the current choice on the page. Call once before the first paint. */
  apply() {
    document.documentElement.dataset.cloth = this.theme.cloth;
    document.documentElement.dataset.texture = this.theme.texture ? 'on' : 'off';
  }

  /** Changes part of the choice, shows it at once and remembers it. */
  change(patch: Partial<Theme>): Theme {
    this.theme = { ...this.theme, ...patch };
    this.apply();
    try {
      localStorage.setItem(ThemeStore.KEY, JSON.stringify(this.theme));
    } catch {
      // private windows can refuse storage; the choice then just lasts until the page closes
    }
    return this.theme;
  }

  private read(): Theme {
    try {
      const saved = JSON.parse(localStorage.getItem(ThemeStore.KEY) ?? 'null') as Partial<Theme> | null;
      return {
        cloth: CLOTHS.find((c) => c === saved?.cloth) ?? ThemeStore.DEFAULT.cloth,
        texture: typeof saved?.texture === 'boolean' ? saved.texture : ThemeStore.DEFAULT.texture,
      };
    } catch {
      // storage blocked or holding something unreadable: fall back to the default look
      return ThemeStore.DEFAULT;
    }
  }
}
