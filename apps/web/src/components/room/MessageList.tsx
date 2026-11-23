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

const thisYear = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const otherYear = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** "23 nov", or "23 nov 2025" when it isn't this year. Lower-case, like every other word here. */
function written(iso: string): string {
  const date = new Date(iso);
  const format = date.getFullYear() === new Date().getFullYear() ? thisYear : otherYear;
  return format.format(date).toLocaleLowerCase();
}

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
      setError(explain(err, { forbidden: 'only the person who opened this room can remove notes.' }));
    } finally {
      setBusy(false);
    }
  };

  if (messages.length === 0) return <p className={note}>no notes yet.</p>;

  return (
    <>
      {/* Notes divided by straight hairlines, like the list of your rooms: no cards.
          The rounded glow for a picked note sits inside, so it can't bend the line. */}
      <ol className="grid divide-y divide-ink-soft/20">
        {messages.map((m) => (
          <li key={m.id} id={`message-${m.id}`} className="py-1.5">
            <div
              className={`rounded-xl px-3 py-3 transition-colors duration-700 ${highlighted === m.id ? 'bg-ink/10' : ''}`}
            >
              {/* Plain text only. React escapes it, and pre-wrap keeps the writer's own line breaks. */}
              <p className="text-lg leading-relaxed break-words whitespace-pre-wrap text-ink">{m.body}</p>
              <p className={`mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 ${note}`}>
                {m.signature && <span className="break-all">— {m.signature}</span>}
                <time dateTime={m.createdAt} className="text-ink-soft/70">
                  {written(m.createdAt)}
                </time>
                {isOwner &&
                  (confirming === m.id ? (
                    // its own line, each phrase kept whole, so a phone never splits "keep / it"
                    <span className="flex basis-full flex-wrap items-baseline gap-x-4 gap-y-1 whitespace-nowrap">
                      <span>remove this note?</span>
                      <button type="button" disabled={busy} onClick={() => remove(m.id)} className={quiet}>
                        yes, remove it
                      </button>
                      <button type="button" onClick={() => setConfirming(null)} className={quiet}>
                        keep it
                      </button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => setConfirming(m.id)} className={`ml-auto ${quiet}`}>
                      remove
                    </button>
                  ))}
              </p>
            </div>
          </li>
        ))}
      </ol>
      <p role="status" className={`min-h-5 ${note}`}>
        {error}
      </p>
    </>
  );
}
