import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import Page from '../components/Page';
import { area, field, note, primary, quiet } from '../components/ui';
import { explain } from '../lib/explain';
import { ROOM_LIMITS } from '../lib/RoomApi';
import { roomApi } from '../services';

// Opening a room: a name for it, and optionally a line telling friends what
// you'd like them to write.
export default function NewRoom() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { room, inviteCode } = await roomApi.create(title.trim(), prompt.trim());
      // The code is handed to the room screen in memory. It is shown once and
      // never placed in the address.
      void navigate(`/rooms/${room.id}`, { state: { inviteCode } });
    } catch (err) {
      setError(explain(err));
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

        <p className={note}>private. only people with your link can join.</p>

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
