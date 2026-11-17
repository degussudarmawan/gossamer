import { useState } from 'react';
import { explain } from '../../lib/explain';
import type { Message } from '../../lib/RoomApi';
import { roomApi } from '../../services';
import { note, quiet } from '../ui';

type Props = {
  roomId: string;
  messages: Message[];
  isOwner: boolean;
  /** A message to draw attention to, e.g. the one whose thread was just clicked. */
  highlighted: string | null;
  /** Called after a message is removed, so the room can reload. */
  onRemoved: () => Promise<void> | void;
};

const day = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

// Every message in full, as ordinary text. This is the dependable way to read
// a room: the web above shows the same messages, shortened to fit their threads.
export default function MessageList({ roomId, messages, isOwner, highlighted, onRemoved }: Props) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async (messageId: string) => {
    setBusy(true);
    setError(null);
    try {
      await roomApi.removeMessage(roomId, messageId);
      setConfirming(null);
      await onRemoved();
    } catch (err) {
      setError(explain(err, { forbidden: 'only the person who opened this room can remove messages.' }));
    } finally {
      setBusy(false);
    }
  };

  if (messages.length === 0) return <p className={note}>no messages yet.</p>;

  return (
    <>
      <ol className="grid gap-3">
        {messages.map((m) => (
          <li
            key={m.id}
            id={`message-${m.id}`}
            className={`rounded-xl p-3 transition-colors duration-700 ${highlighted === m.id ? 'bg-ink/10' : ''}`}
          >
            {/* Plain text only. React escapes it, and pre-wrap keeps the writer's own line breaks. */}
            <p className="text-lg break-words whitespace-pre-wrap text-ink">{m.body}</p>
            <p className={`mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 ${note}`}>
              {m.signature && <span>— {m.signature}</span>}
              <time dateTime={m.createdAt}>{day.format(new Date(m.createdAt))}</time>
              {isOwner &&
                (confirming === m.id ? (
                  <span className="flex gap-4">
                    <span>remove it?</span>
                    <button type="button" disabled={busy} onClick={() => remove(m.id)} className={quiet}>
                      yes, remove
                    </button>
                    <button type="button" onClick={() => setConfirming(null)} className={quiet}>
                      keep it
                    </button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirming(m.id)} className={quiet}>
                    remove
                  </button>
                ))}
            </p>
          </li>
        ))}
      </ol>
      <p role="status" className={`min-h-5 ${note}`}>
        {error}
      </p>
    </>
  );
}
