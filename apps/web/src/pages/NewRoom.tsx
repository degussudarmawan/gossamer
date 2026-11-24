import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import Choice from '../components/Choice';
import Page from '../components/Page';
import { area, field, note, primary, quiet } from '../components/ui';
import { explain } from '../lib/explain';
import { ROOM_LIMITS, type Visibility } from '../lib/RoomApi';
import { roomApi } from '../services';

const VISIBILITY = [
  { value: 'private', label: 'private' },
  { value: 'public', label: 'public' },
] as const;

// Opening a room: a name for it, optionally a line telling friends what you'd
// like them to write, and whether it is private (joined with your link) or
// public (anyone signed in can find it in the list of public rooms). Private
// is the default: nothing is made public unless the person chooses it.
export default function NewRoom() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { room, inviteCode } = await roomApi.create(title.trim(), prompt.trim(), visibility);
      // The code is handed to the room screen in memory. It is shown once and
      // never placed in the address. `opened` has the room offer its link (or,
      // for a public room, its address) straight away.
      void navigate(`/rooms/${room.id}`, { state: { inviteCode, opened: true } });
    } catch (err) {
      setError(
        explain(
          err,
          // The title is checked here before sending, so a public room refused
          // as invalid is a backend that doesn't take `visibility` yet.
          visibility === 'public'
            ? { invalid_input: 'public rooms aren’t open yet. open this one as private for now.' }
            : {},
        ),
      );
      setBusy(false);
    }
  };

  return (
    <Page>
      <form onSubmit={open} className="grid w-full justify-items-center gap-6">
        <h1 className="font-hand text-display">
          <label htmlFor="title">what’s the occasion?</label>
        </h1>
        <input
          id="title"
          required
          autoFocus
          maxLength={ROOM_LIMITS.title}
          placeholder="maya’s graduation"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={field}
        />

        <div className="grid w-full gap-2">
          <label htmlFor="prompt" className={note}>
            what should people write? (optional)
          </label>
          <textarea
            id="prompt"
            rows={3}
            maxLength={ROOM_LIMITS.prompt}
            placeholder="a memory, or a wish for what comes next"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className={area}
          />
        </div>

        <div className="grid justify-items-center gap-1">
          <Choice legend="who can join?" showLegend value={visibility} options={VISIBILITY} onChange={setVisibility} />
          <p className={note}>
            {visibility === 'private'
              ? 'only people with your link can join.'
              : 'anyone signed in can find it in public rooms, read every note and leave one.'}
          </p>
        </div>

        <button type="submit" disabled={busy || !title.trim()} className={primary}>
          {busy ? 'opening…' : 'open the room'}
        </button>
        <Link to="/rooms" className={quiet}>
          your rooms
        </Link>
      </form>
      <p role="status" className={`min-h-6 ${note}`}>
        {error}
      </p>
    </Page>
  );
}
