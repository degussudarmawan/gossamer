// Class lists for the few form pieces every screen shares, so they look and
// behave the same everywhere.

/** A single-line input: just an underline, centred text. */
export const field =
  'w-full border-b border-ink-soft/60 bg-transparent py-2 text-center text-xl text-ink outline-none placeholder:text-ink-soft/50 focus:border-ink';

/** A multi-line input: a thin outline, left-aligned text. */
export const area =
  'w-full resize-none rounded-xl border border-ink-soft/50 bg-transparent p-3 text-base text-ink outline-none placeholder:text-ink-soft/50 focus:border-ink';

/** The one main action on a screen. */
export const primary =
  'cursor-pointer rounded-full border border-ink px-6 py-2 text-ink transition-colors hover:bg-ink hover:text-(--cloth) disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-ink';

/** Secondary actions and links: small underlined text. */
export const quiet = 'cursor-pointer text-sm font-medium text-ink-soft underline decoration-1 underline-offset-4';

/** Small explanatory text. */
export const note = 'text-sm font-medium text-ink-soft';
