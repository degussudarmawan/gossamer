import type { ReactNode } from 'react';
import { Corner, HelpLink, Wordmark } from './Chrome';

/**
 * The frame every simple screen shares: wordmark top-left, picker and account
 * links top-right, help link at the bottom, and the content centred between.
 */
export default function Page({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center px-6 pt-28 pb-20">
      <Wordmark className="absolute top-8 left-6" />
      <Corner className="absolute top-7 right-6" />
      <main className="my-auto grid w-full max-w-md justify-items-center gap-6 text-center">{children}</main>
      <HelpLink className="absolute bottom-5 left-6 text-sm font-medium text-ink-soft" />
    </div>
  );
}
