import { useState } from 'react';
import { explain } from '../../lib/explain';
import type { Room } from '../../lib/RoomApi';
import { roomApi } from '../../services';
import { note, primary, quiet } from '../ui';

type Props = {
  room: Room;
  /** The current invite code, if we have just been given it. The server shows a code only once. */
  inviteCode: string | null;
  onInvite: (code: string) => void;
  onRoom: (room: Room) => void;
};

// What only the person who opened the room can do: hand out the invite link,
// replace it, and close or reopen the room. Lives inside a Sheet, shown only
// to the owner; the backend checks ownership again on every one of these.
export default function OwnerTools({ room, inviteCode, onInvite, onRoom }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const link = inviteCode ? `${window.location.origin}/join#${inviteCode}` : null;

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch (err) {
      setMessage(explain(err, { forbidden: 'only the person who opened this room can do that.' }));
    } finally {
      setBusy(false);
    }
  };

  const copy = () =>
    run(async () => {
      try {
        await navigator.clipboard.writeText(link!);
        setMessage('copied.');
      } catch {
        // clipboard blocked by the browser: the link is on screen to select by hand
        setMessage('couldn’t copy. select the link and copy it yourself.');
      }
    });

  const rotate = () => run(async () => onInvite(await roomApi.rotateInvite(room.id)));
  const setClosed = (closed: boolean) => run(async () => onRoom(await roomApi.setClosed(room.id, closed)));

  return (
    <div className="grid gap-5">
      {link ? (
        <div className="grid gap-3">
          <p className="rounded-xl border border-ink-soft/40 p-3 text-sm break-all text-ink select-all">{link}</p>
          <div className="flex items-center justify-between gap-4">
            <p className={note}>shown once. anyone with it can join.</p>
            <button type="button" disabled={busy} onClick={copy} className={`shrink-0 ${primary}`}>
              copy link
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-4">
          <p className={note}>lost the link? a new one replaces the old.</p>
          <button type="button" disabled={busy} onClick={rotate} className={`shrink-0 ${primary}`}>
            new link
          </button>
        </div>
      )}

      <div className="flex items-center justify-between gap-4 border-t border-ink-soft/25 pt-5">
        <p className={note}>{room.closed ? 'closed: no new people or messages.' : 'open to new people and messages.'}</p>
        <button type="button" disabled={busy} onClick={() => setClosed(!room.closed)} className={`shrink-0 ${quiet}`}>
          {room.closed ? 'reopen' : 'close room'}
        </button>
      </div>

      <p role="status" className={`min-h-5 ${note}`}>
        {message}
      </p>
    </div>
  );
}
