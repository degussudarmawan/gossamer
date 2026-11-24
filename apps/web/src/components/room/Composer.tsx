import { useRef, useState, type FormEvent } from 'react';
import { explain } from '../../lib/explain';
import { ROOM_LIMITS } from '../../lib/RoomApi';
import { roomApi } from '../../services';
import { area, note, primary } from '../ui';

type Props = {
  roomId: string;
  /** What the room's owner asked people to write, if anything. */
  prompt: string;
  /** A public room's notes can be read by anyone signed in, which the writer is told. */
  isPublic: boolean;
  /** Called after the message is stored, so the room can close this and show it. */
  onSent: () => Promise<void> | void;
};

// The form for writing a message. Lives inside a Sheet.
export default function Composer({ roomId, prompt, isPublic, onSent }: Props) {
  const [body, setBody] = useState('');
  const [signature, setSignature] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One id per message, kept for retries of the same text so a retry after a
  // dropped connection can't post it twice. Changing the text makes it a
  // different message, which gets a new id.
  const attempt = useRef<{ requestId: string; body: string; signature: string } | null>(null);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const text = body.trim();
    const name = signature.trim();
    if (attempt.current?.body !== text || attempt.current.signature !== name) {
      attempt.current = { requestId: crypto.randomUUID(), body: text, signature: name };
    }
    setBusy(true);
    setError(null);
    try {
      await roomApi.send(roomId, { body: text, requestId: attempt.current.requestId, ...(name ? { signature: name } : {}) });
      await onSent();
    } catch (err) {
      setError(
        explain(err, {
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
        // same size as the note above it: the signature is a sign-off, not a heading
        className="w-full border-b border-ink-soft/50 bg-transparent px-3 py-2 text-base text-ink outline-none placeholder:text-ink-soft/50 focus:border-ink"
      />

      <div className="flex items-center justify-between gap-4">
        <p role="status" className={note}>
          {error ?? (isPublic ? 'a public room: anyone signed in can read it.' : 'everyone in the room can read it.')}
        </p>
        <button type="submit" disabled={busy || !body.trim()} className={`shrink-0 ${primary}`}>
          {busy ? 'sending…' : 'send'}
        </button>
      </div>
    </form>
  );
}
