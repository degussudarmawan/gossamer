import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import Page from '../components/Page';
import { field, note, primary, quiet } from '../components/ui';
import { explain } from '../lib/explain';
import { pendingInvite } from '../lib/navigation';
import { roomApi } from '../services';
import { useSession } from '../session';

// Joining a private room with an invite code.
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fromLink = window.location.hash.slice(1).trim();
    if (!fromLink) return;
    pendingInvite.keep(fromLink);
    setCode(fromLink);
    // drop the code from the address bar and from this history entry
    window.history.replaceState(window.history.state, '', window.location.pathname);
  }, []);

  const typeCode = (value: string) => {
    setCode(value);
    pendingInvite.keep(value.trim());
  };

  const join = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const room = await roomApi.join(code.trim());
      pendingInvite.clear();
      void navigate(`/rooms/${room.id}`, { replace: true });
    } catch (err) {
      setError(
        explain(err, {
          not_found: 'that code doesn’t open a room. it may have been replaced; ask for a new one.',
          room_closed: 'that room isn’t taking new people right now.',
          invalid_input: 'that doesn’t look like a code. check it and try again.',
        }),
      );
      setBusy(false);
    }
  };

  return (
    <Page>
      <h1 className="font-hand text-display">
        <label htmlFor="code">{code ? 'you’ve been invited' : 'have a code?'}</label>
      </h1>
      <p className={note}>everyone in the room can read what you write. your email stays hidden.</p>

      {loading ? null : user ? (
        <form onSubmit={join} className="grid w-full justify-items-center gap-6">
          <input
            id="code"
            required
            autoFocus
            autoComplete="off"
            spellCheck={false}
            placeholder="paste the code"
            value={code}
            onChange={(e) => typeCode(e.target.value)}
            className={`${field} text-base tracking-widest`}
          />
          <button type="submit" disabled={busy || !code.trim()} className={primary}>
            {busy ? 'joining…' : 'join the room'}
          </button>
        </form>
      ) : (
        <Link to="/sign-in?next=/join" className={primary}>
          sign in to join
        </Link>
      )}

      <p role="status" className={`min-h-6 ${note}`}>
        {error}
      </p>
      {user && (
        <Link to="/rooms" className={quiet}>
          your rooms
        </Link>
      )}
    </Page>
  );
}
