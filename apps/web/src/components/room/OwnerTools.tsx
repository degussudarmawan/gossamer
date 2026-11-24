import { useState } from 'react';
import { explain } from '../../lib/explain';
import type { Room, Visibility } from '../../lib/RoomApi';
import { roomApi } from '../../services';
import Choice from '../Choice';
import QrCode from '../QrCode';
import { note, primary, quiet } from '../ui';

type Props = {
  room: Room;
  /** The current invite code, if we have just been given it. The server shows a code only once. */
  inviteCode: string | null;
  /** How many notes the room holds, for the warning before making it public. */
  notes: number;
  onInvite: (code: string) => void;
  onRoom: (room: Room) => void;
};

const VISIBILITY = [
  { value: 'private', label: 'private' },
  { value: 'public', label: 'public' },
] as const;

// A link built on one of these names points back at the computer it was made
// on, so a phone scanning the QR code can't open it. Only happens in development.
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

// What only the person who opened the room can do: hand out the invite link
// (copied, or shown as a QR code for someone to scan), replace it, make the
// room private or public, and close or reopen it. A public room has no invite
// code: its link is just the room's own address, always available, and there
// is nothing to replace. Lives inside a Sheet, shown only to the owner; the
// backend checks ownership again on every one of these.
export default function OwnerTools({ room, inviteCode, notes, onInvite, onRoom }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  // Going public is asked about first (see `choose`); this holds it meanwhile.
  const [pending, setPending] = useState<Visibility | null>(null);

  const isPublic = room.visibility === 'public';
  const link = isPublic
    ? `${window.location.origin}/rooms/${room.id}`
    : inviteCode
      ? `${window.location.origin}/join#${inviteCode}`
      : null;
  const local = LOCAL_HOSTS.includes(window.location.hostname);

  const run = async (work: () => Promise<void>, known: Record<string, string> = {}) => {
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch (err) {
      setMessage(explain(err, { forbidden: 'only the person who opened this room can do that.', ...known }));
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

  // The backend refuses a new code for a public room (public_room); it can only
  // happen if the room was made public somewhere else, e.g. in another tab.
  const rotate = () =>
    run(async () => onInvite(await roomApi.rotateInvite(room.id)), {
      public_room: 'this room is public now, so its link is just its address.',
    });
  const setClosed = (closed: boolean) => run(async () => onRoom(await roomApi.setClosed(room.id, closed)));

  const setVisibility = (visibility: Visibility) =>
    run(
      async () => {
        onRoom(await roomApi.setVisibility(room.id, visibility));
        setMessage(
          visibility === 'public'
            ? 'public now. it’s listed in public rooms.'
            : 'private now. it’s off the public list, and everyone who joined can stay.',
        );
      },
      // A backend without public rooms refuses the unknown field.
      { invalid_input: 'public rooms aren’t open yet, so this room stays private.' },
    ).finally(() => setPending(null));

  // Going private only narrows who can get in, so it happens at once. Going
  // public is asked about first: notes written for a private room would become
  // readable by anyone signed in, which their writers didn't expect.
  const choose = (next: Visibility) => {
    setMessage(null);
    setPending(next === room.visibility ? null : next);
    if (next === 'private' && room.visibility !== 'private') void setVisibility('private');
  };

  return (
    <div className="grid gap-5">
      {link ? (
        <div className="grid gap-3">
          <p className="rounded-xl border border-ink-soft/40 p-3 text-sm break-all text-ink select-all">{link}</p>
          <div className="flex items-center justify-between gap-4">
            <p className={note}>
              {isPublic
                ? 'anyone signed in can open it, or find the room in public rooms.'
                : 'shown only this once. anyone with the link can join.'}
            </p>
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
              <QrCode value={link} label={isPublic ? 'QR code of the room’s link' : 'QR code of the invite link'} className="w-56 max-w-full" />
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

      <div className="grid gap-3 border-t border-ink-soft/25 pt-5">
        <div className="flex items-center justify-between gap-4">
          {/* shown for sighted people; screen readers get the same words as the choice's legend */}
          <p className={note} aria-hidden="true">
            who can join?
          </p>
          <Choice
            legend="who can join?"
            value={pending ?? room.visibility}
            options={VISIBILITY}
            onChange={choose}
            disabled={busy}
          />
        </div>
        {pending === 'public' && room.visibility === 'private' && (
          <div className="grid gap-3">
            <p className={note}>
              {notes > 0
                ? `${notes === 1 ? 'the note' : `all ${notes} notes`} already here will be readable by anyone signed in, not only the people you invited.`
                : 'anyone signed in will be able to find it in public rooms, read it and write in it.'}
            </p>
            <div className="flex items-center justify-end gap-5">
              <button type="button" disabled={busy} onClick={() => setPending(null)} className={quiet}>
                keep it private
              </button>
              <button type="button" disabled={busy} onClick={() => void setVisibility('public')} className={primary}>
                make it public
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-ink-soft/25 pt-5">
        <p className={note}>
          {/* the panel's title already says whether the room is open or closed */}
          {room.closed
            ? 'no one new can join or write.'
            : isPublic
              ? 'anyone signed in can join and write.'
              : 'people with the link can join and write.'}
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
