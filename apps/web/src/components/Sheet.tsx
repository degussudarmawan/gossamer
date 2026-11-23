import { useEffect, useRef, type ReactNode } from 'react';
import { quiet } from './ui';

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
};

/**
 * A panel that opens over the page for one job (write, read, invite) and
 * closes again. A native <dialog>: the browser keeps keyboard focus inside
 * it, closes it on Escape, and blocks the page behind it.
 */
export default function Sheet({ open, onClose, title, children }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      // showModal focuses the first button (close). A panel with somewhere to
      // type marks it with data-autofocus, and the cursor goes there instead.
      el.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    }
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      // a click on the dimmed area outside the panel lands on the dialog element itself
      onClick={(e) => e.target === dialog.current && onClose()}
      aria-label={title}
      className="m-auto max-h-[86dvh] w-[min(92vw,30rem)] overflow-hidden rounded-2xl border border-ink-soft/30 bg-(--cloth) p-0 text-ink backdrop:bg-black/50"
    >
      <div className="flex max-h-[86dvh] flex-col gap-4 p-6">
        <header className="flex items-baseline justify-between gap-4">
          <h2 className="font-hand text-2xl">{title}</h2>
          <button type="button" onClick={onClose} className={quiet}>
            close
          </button>
        </header>
        {/* only the content scrolls, never the page behind */}
        <div className="-mr-2 grid min-h-0 gap-4 overflow-y-auto pr-2">{open && children}</div>
      </div>
    </dialog>
  );
}
