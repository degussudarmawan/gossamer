import { useState } from 'react';
import { Link } from 'react-router';
import { useSession } from '../session';
import ThemePicker from './ThemePicker';

// The few fixed things every screen has in its corners.

/** The wordmark, dangling from the top edge on its own strand. Links home. */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <Link
      to="/"
      className={`px-1 font-hand text-lg leading-none tracking-[0.18em] before:absolute before:bottom-full before:left-2 before:mb-1 before:h-9 before:w-px before:bg-ink ${className}`}
    >
      gossamer
    </Link>
  );
}

/** Background picker plus the way in or out of an account. */
export function Corner({ className = '' }: { className?: string }) {
  const { user, loading, signOut } = useSession();
  const [failed, setFailed] = useState(false);

  const leave = () => {
    setFailed(false);
    signOut().catch((err: unknown) => {
      console.error('sign-out failed', err);
      setFailed(true);
    });
  };

  const link = 'cursor-pointer underline decoration-1 underline-offset-4';
  return (
    <div className={`flex items-center gap-4 text-sm font-medium text-ink-soft ${className}`}>
      <ThemePicker />
      {loading ? null : user ? (
        <button type="button" onClick={leave} className={link}>
          {failed ? 'couldn’t sign out. try again' : 'sign out'}
        </button>
      ) : (
        <Link to="/sign-in" className={link}>
          sign in
        </Link>
      )}
    </div>
  );
}

export function HelpLink({ className = '' }: { className?: string }) {
  return (
    <a
      href="https://findahelpline.com"
      target="_blank"
      rel="noreferrer"
      className={`underline decoration-1 underline-offset-4 ${className}`}
    >
      need to talk to someone now?
    </a>
  );
}
