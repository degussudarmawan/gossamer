import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { Corner, HelpLink, Wordmark } from '../components/Chrome';
import { ApiError } from '../lib/ApiClient';
import { authApi } from '../services';
import { useSession } from '../session';

// Two steps on one screen: give an email, then type the code we sent to it.
// There is no separate sign-up; a new email just becomes a new account.

function explain(err: unknown) {
  if (err instanceof ApiError) {
    if (err.code === 'invalid_code') return 'that code didn’t work. check it, or ask for a new one.';
    if (err.code === 'too_many_requests') return 'a code went out a moment ago. give it a minute, then try again.';
    if (err.code === 'invalid_input') return 'that doesn’t look right. have another look.';
  }
  return 'something went wrong on our side. try again in a moment.';
}

const field =
  'w-full border-b border-ink-soft/60 bg-transparent py-2 text-center text-xl text-ink outline-none placeholder:text-ink-soft/50 focus:border-ink';
const primary =
  'cursor-pointer rounded-full border border-ink px-6 py-2 text-ink transition-colors hover:bg-ink hover:text-(--cloth) disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-ink';
const quiet = 'cursor-pointer text-sm font-medium text-ink-soft underline decoration-1 underline-offset-4';

export default function SignIn() {
  const { user, loading, signedIn } = useSession();
  const navigate = useNavigate();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!loading && user) return <Navigate to="/" replace />;

  // Runs one request, with the buttons disabled meanwhile and any failure shown in plain words.
  const attempt = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (err) {
      if (!(err instanceof ApiError)) console.error('sign-in request failed', err);
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  };

  const sendCode = (e?: FormEvent) => {
    e?.preventDefault();
    void attempt(async () => {
      await authApi.requestCode(email);
      if (step === 'code') setNotice('a new code is on its way.');
      setCode('');
      setStep('code');
    });
  };

  const verify = (value: string) =>
    void attempt(async () => {
      signedIn(await authApi.verifyCode(email, value));
      void navigate('/', { replace: true });
    });

  const typeCode = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    // the sixth digit submits by itself, so there is nothing more to press
    if (digits.length === 6 && !busy) verify(digits);
  };

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center px-8">
      <Wordmark className="absolute top-8 left-6" />
      <Corner className="absolute top-7 right-6" />

      {step === 'email' ? (
        <form onSubmit={sendCode} className="grid w-full max-w-xs justify-items-center gap-6 text-center">
          <h1 className="font-hand text-display">
            <label htmlFor="email">what’s your email?</label>
          </h1>
          <p className="text-sm font-medium text-ink-soft">we’ll send you a code. no password to remember.</p>
          <input
            id="email"
            type="email"
            required
            autoFocus
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={field}
          />
          <button type="submit" disabled={busy} className={primary}>
            {busy ? 'sending…' : 'send me a code'}
          </button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            verify(code);
          }}
          className="grid w-full max-w-xs justify-items-center gap-6 text-center"
        >
          <h1 className="font-hand text-display">
            <label htmlFor="code">check your email</label>
          </h1>
          <p className="text-sm font-medium text-ink-soft">
            we sent a 6-digit code to <span className="text-ink">{email}</span>. it works for 10 minutes.
          </p>
          {import.meta.env.DEV && (
            <p className="text-sm font-medium text-ink-soft/70">
              (dev: no email is sent. the code is printed in the terminal running the server.)
            </p>
          )}
          <input
            id="code"
            inputMode="numeric"
            autoFocus
            autoComplete="one-time-code"
            placeholder="······"
            value={code}
            onChange={(e) => typeCode(e.target.value)}
            className={`${field} tracking-[0.5em]`}
          />
          <button type="submit" disabled={busy || code.length !== 6} className={primary}>
            {busy ? 'checking…' : 'sign in'}
          </button>
          <div className="flex gap-5">
            <button type="button" disabled={busy} onClick={() => sendCode()} className={quiet}>
              send a new code
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setStep('email');
                setError(null);
                setNotice(null);
              }}
              className={quiet}
            >
              use another email
            </button>
          </div>
        </form>
      )}

      {/* Always in the page, so a screen reader announces whatever appears in it. */}
      <p role="status" className="mt-6 min-h-6 max-w-xs text-center text-sm font-medium text-ink-soft">
        {error ?? notice}
      </p>

      <HelpLink className="absolute bottom-5 left-6 text-sm font-medium text-ink-soft" />
    </div>
  );
}
