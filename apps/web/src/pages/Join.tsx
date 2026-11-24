import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import Choice from '../components/Choice';
import Page from '../components/Page';
import PublicRooms from '../components/PublicRooms';
import { field, note, primary, quiet } from '../components/ui';
import { explain } from '../lib/explain';
import { pendingInvite } from '../lib/navigation';
import { roomApi } from '../services';
import { useSession } from '../session';

type Way = 'public' | 'link';

const WAYS = [
  { value: 'public', label: 'public rooms' },
  { value: 'link', label: 'with a link' },
] as const;

/** A whole invite link works as well as the bare code: the code is whatever follows its #. */
const codeFrom = (text: string) => text.slice(text.lastIndexOf('#') + 1).trim();

// Joining a room, one of two ways: choosing a public room from the list, or
// using the invite link (or just its code) for a private room.
//
// An invite link looks like /join#CODE. The part after # never reaches any
// server, so the code stays out of request logs. On arrival we lift it out of
// the address bar and hold it for this tab; it is only ever sent in the body
// of the join request. If the person has to sign in first, they come back
// here afterwards and the code is still waiting.
export default function Join() {
  const { user, loading } = useSession();
  const navigate = useNavigate();
  const [code, setCode] = useState(() => pendingInvite.take());
  // Arriving from an invite link, or back from signing in with one waiting,
  // goes straight to the link form. Otherwise the public rooms come first.
  const [way, setWay] = useState<Way>(() => (code || window.location.hash.length > 1 ? 'link' : 'public'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fromLink = window.location.hash.slice(1).trim();
    if (!fromLink) return;
    pendingInvite.keep(fromLink);
    setCode(fromLink);
    setWay('link');
    // drop the code from the address bar and from this history entry
    window.history.replaceState(window.history.state, '', window.location.pathname);
  }, []);

  const typeCode = (value: string) => {
    setCode(value);
    pendingInvite.keep(codeFrom(value));
  };

  const join = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const room = await roomApi.join(codeFrom(code));
      pendingInvite.clear();
      void navigate(`/rooms/${room.id}`, { replace: true });
    } catch (err) {
      setError(
        explain(err, {
          not_found: 'that code doesn’t open a room. it may have been replaced; ask for a new one.',
          room_closed: 'that room isn’t taking new people right now.',
          invalid_input: 'that doesn’t look like an invite link or code. check it and try again.',
        }),
      );
      setBusy(false);
    }
  };

  return (
    <Page>
      <h1 className="font-hand text-display">{way === 'link' && code ? 'you’ve been invited' : 'join a room'}</h1>
      <p className={note}>everyone in the room can read what you write. your email stays hidden.</p>

      {loading ? null : user ? (
        <>
          <Choice legend="how to join" value={way} options={WAYS} onChange={setWay} />
          {way === 'public' ? (
            <PublicRooms onUseLink={() => setWay('link')} />
          ) : (
            <form onSubmit={join} className="grid w-full justify-items-center gap-6">
              <label htmlFor="code" className="sr-only">
                the invite link or code
              </label>
              <input
                id="code"
                required
                autoFocus
                autoComplete="off"
                spellCheck={false}
                placeholder="paste the link or code"
                value={code}
                onChange={(e) => typeCode(e.target.value)}
                className={`${field} text-base tracking-widest`}
              />
              <button type="submit" disabled={busy || !codeFrom(code)} className={primary}>
                {busy ? 'joining…' : 'join the room'}
              </button>
              <p role="status" className={`min-h-6 ${note}`}>
                {error}
              </p>
            </form>
          )}
        </>
      ) : (
        <Link to="/sign-in?next=/join" className={primary}>
          sign in to join
        </Link>
      )}

      {user && (
        <Link to="/rooms" className={quiet}>
          your rooms
        </Link>
      )}
    </Page>
  );
}
