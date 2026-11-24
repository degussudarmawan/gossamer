import { useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../../lib/ApiClient';
import { explain } from '../../lib/explain';
import type { Ink } from '../../lib/ink';
import { ROOM_LIMITS } from '../../lib/RoomApi';
import { roomApi } from '../../services';
import Choice from '../Choice';
import { area, note, primary } from '../ui';
import InkPad from './InkPad';

type Mode = 'type' | 'write';

const MODES = [
  { value: 'type', label: 'type' },
  { value: 'write', label: 'write' },
] as const;

/** An underlined single line, as for the signature: same size as the note, it is a sign-off, not a heading. */
const line =
  'w-full border-b border-ink-soft/50 bg-transparent px-3 py-2 text-base text-ink outline-none placeholder:text-ink-soft/50 focus:border-ink';

type Props = {
  roomId: string;
  /** What the room's owner asked people to write, if anything. */
  prompt: string;
  /** A public room's notes can be read by anyone signed in, which the writer is told. */
  isPublic: boolean;
  /** Called after the message is stored, so the room can close this and show it. */
  onSent: () => Promise<void> | void;
};

// The form for writing a message: typed, or written by hand on a pad. Lives inside a Sheet.
export default function Composer({ roomId, prompt, isPublic, onSent }: Props) {
  const [mode, setMode] = useState<Mode>('type');
  const [body, setBody] = useState('');
  // a handwritten note, and what it says (its caption, for anyone who can't see it)
  const [ink, setInk] = useState<Ink | null>(null);
  const [caption, setCaption] = useState('');
  const [signature, setSignature] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One id per message, kept for retries of the same note so a retry after a
  // dropped connection can't post it twice. Changing the note makes it a
  // different message, which gets a new id.
  const attempt = useRef<{ requestId: string; note: string } | null>(null);

  const writing = mode === 'write';
  const ready = writing ? ink !== null : body.trim().length > 0;

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    const name = signature.trim();
    const words = (writing ? caption : body).trim();
    const draft = writing && ink ? { ink, ...(words ? { body: words } : {}) } : { body: words };
    // both drafts are kept while switching, so only the one being sent counts
    const same = JSON.stringify([draft, name]);
    if (attempt.current?.note !== same) attempt.current = { requestId: crypto.randomUUID(), note: same };
    setBusy(true);
    setError(null);
    try {
      await roomApi.send(roomId, { ...draft, requestId: attempt.current.requestId, ...(name ? { signature: name } : {}) });
      await onSent();
    } catch (err) {
      // A backend that doesn't know handwriting refuses the unknown `ink` (invalid_input),
      // or a long note before even looking at it (413).
      const unknown = writing && err instanceof ApiError && (err.code === 'invalid_input' || err.status === 413);
      setError(
        unknown
          ? 'handwritten notes aren’t open yet. type this one for now.'
          : explain(err, {
              room_closed: 'this room has just been closed.',
              retry_conflict: 'that was already sent. close this and look.',
              not_found: 'this room is no longer open to you.',
            }),
      );
      setBusy(false);
    }
  };

  const left = ROOM_LIMITS.body - body.length;

  return (
    <form onSubmit={send} className="grid gap-4">
      {prompt && <p className={note}>{prompt}</p>}

      <Choice legend="how will you leave it?" value={mode} options={MODES} onChange={setMode} />

      {writing ? (
        <>
          <InkPad value={ink} onChange={setInk} />
          <label htmlFor="message-caption" className="sr-only">
            what it says, for anyone who can’t see it (optional)
          </label>
          <input
            id="message-caption"
            maxLength={ROOM_LIMITS.body}
            autoComplete="off"
            placeholder="what it says, if you like"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            className={line}
          />
        </>
      ) : (
        <>
          <label htmlFor="message-body" className="sr-only">
            your message
          </label>
          <textarea
            id="message-body"
            required
            // the Sheet puts the cursor here when it opens (React's autoFocus runs before the dialog is open)
            data-autofocus
            rows={5}
            maxLength={ROOM_LIMITS.body}
            placeholder="write something they’ll want to keep"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className={area}
          />
          {left <= 200 && <p className={`-mt-2 text-right ${note}`}>{left} characters left</p>}
        </>
      )}

      <label htmlFor="message-signature" className="sr-only">
        your name (optional)
      </label>
      <input
        id="message-signature"
        maxLength={ROOM_LIMITS.signature}
        autoComplete="off"
        placeholder="sign it, if you like"
        value={signature}
        onChange={(e) => setSignature(e.target.value)}
        className={line}
      />

      <div className="flex items-center justify-between gap-4">
        <p role="status" className={note}>
          {error ?? (isPublic ? 'a public room: anyone signed in can read it.' : 'everyone in the room can read it.')}
        </p>
        <button type="submit" disabled={busy || !ready} className={`shrink-0 ${primary}`}>
          {busy ? 'sending…' : 'send'}
        </button>
      </div>
    </form>
  );
}
