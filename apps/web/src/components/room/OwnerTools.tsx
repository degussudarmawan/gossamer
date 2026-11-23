import { useState } from 'react';
import { explain } from '../../lib/explain';
import type { Room } from '../../lib/RoomApi';
import { roomApi } from '../../services';
import QrCode from '../QrCode';
import { note, primary, quiet } from '../ui';

type Props = {
  room: Room;
  /** The current invite code, if we have just been given it. The server shows a code only once. */
  inviteCode: string | null;
  onInvite: (code: string) => void;
  onRoom: (room: Room) => void;
};

// A link built on one of these names points back at the computer it was made
// on, so a phone scanning the QR code can't open it. Only happens in development.
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

// What only the person who opened the room can do: hand out the invite link
// (copied, or shown as a QR code for someone to scan), replace it, and close or
// reopen the room. Lives inside a Sheet, shown only to the owner; the backend
// checks ownership again on every one of these.
export default function OwnerTools({ room, inviteCode, onInvite, onRoom }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);

  const link = inviteCode ? `${window.location.origin}/join#${inviteCode}` : null;
  const local = LOCAL_HOSTS.includes(window.location.hostname);

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
            <p className={note}>shown only this once. anyone with the link can join.</p>
            <button type="button" disabled={busy} onClick={copy} className={`shrink-0 ${primary}`}>
              copy link
            </button>
          </div>
          <button
            type="button"
            onClick={() => setShowQr(!showQr)}
            aria-expanded={showQr}
            aria-controls="invite-qr"
            className={`justify-self-end ${quiet}`}
          >
            {showQr ? 'hide qr code' : 'show qr code'}
          </button>
          {showQr && (
            <figure id="invite-qr" className="grid justify-items-center gap-2">
              <QrCode value={link} label="QR code of the invite link" className="w-56 max-w-full" />
              <figcaption className={`text-center ${note}`}>
                {local
                  ? 'this link points at localhost, so a phone can’t open it. open the site by its network address to try it on a phone.'
                  : 'point a phone’s camera at it to open the link.'}
              </figcaption>
            </figure>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-4">
          <p className={note}>the link is shown only once. making a new one turns the old one off.</p>
          <button type="button" disabled={busy} onClick={rotate} className={`shrink-0 ${primary}`}>
            make a new link
          </button>
        </div>
      )}

      <div className="flex items-center justify-between gap-4 border-t border-ink-soft/25 pt-5">
        <p className={note}>
          {/* the panel's title already says whether the room is open or closed */}
          {room.closed ? 'no one new can join or write.' : 'people with the link can join and write.'}
        </p>
        <button type="button" disabled={busy} onClick={() => setClosed(!room.closed)} className={`shrink-0 ${quiet}`}>
          {room.closed ? 'reopen the room' : 'close the room'}
        </button>
      </div>

      <p role="status" className={`min-h-5 ${note}`}>
        {message}
      </p>
    </div>
  );
}
