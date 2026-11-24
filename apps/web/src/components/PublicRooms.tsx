import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiError } from '../lib/ApiClient';
import { explain } from '../lib/explain';
import type { Room } from '../lib/RoomApi';
import { roomApi } from '../services';
import { note, quiet } from './ui';

type Props = {
  /** Switches the join screen over to the invite-link form. */
  onUseLink: () => void;
};

// The public rooms anyone signed in can join, newest first. Choosing one joins
// it and opens it, as following an invite link does for a private room. Rooms
// the person is already in open straight away.
export default function PublicRooms({ onUseLink }: Props) {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'failed'>('loading');
  const [joining, setJoining] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    roomApi
      .listPublic()
      .then((found) => {
        if (!alive) return;
        setRooms(found);
        setState('ready');
      })
      .catch((err: unknown) => {
        if (!alive) return;
        // A backend without public rooms reads "public" as a room id and refuses it.
        const unavailable = err instanceof ApiError && (err.status === 404 || err.status === 400);
        if (!unavailable) setError(explain(err));
        setState(unavailable ? 'unavailable' : 'failed');
      });
    return () => {
      alive = false;
    };
  }, []);

  const enter = async (room: Room) => {
    if (room.isMember) return navigate(`/rooms/${room.id}`);
    setJoining(room.id);
    setError(null);
    try {
      await roomApi.joinPublic(room.id);
      void navigate(`/rooms/${room.id}`);
    } catch (err) {
      setError(
        explain(err, {
          room_closed: 'that room isn’t taking new people right now.',
          not_found: 'that room isn’t public any more.',
        }),
      );
      setJoining(null);
    }
  };

  if (state === 'loading') return null;

  if (state === 'unavailable') {
    return (
      <div className="grid justify-items-center gap-3">
        <p className={note}>public rooms aren’t open yet. for now, rooms are joined with a link.</p>
        <button type="button" onClick={onUseLink} className={quiet}>
          join with a link
        </button>
      </div>
    );
  }

  return (
    <div className="grid w-full justify-items-center gap-4">
      {rooms?.length === 0 && (
        <div className="grid justify-items-center gap-3">
          <p className={note}>no public rooms yet.</p>
          <Link to="/rooms/new" className={quiet}>
            open the first one
          </Link>
        </div>
      )}

      {rooms && rooms.length > 0 && (
        <ul className="grid w-full gap-1" aria-label="public rooms">
          {rooms.map((room) => (
            <li key={room.id}>
              <button
                type="button"
                disabled={joining !== null}
                onClick={() => void enter(room)}
                className="flex w-full cursor-pointer items-baseline justify-between gap-4 border-b border-ink-soft/25 py-3 text-left hover:border-ink disabled:cursor-default"
              >
                <span className="grid min-w-0 gap-0.5">
                  <span className="font-hand text-xl text-ink">{room.title}</span>
                  {room.prompt && <span className={`truncate ${note}`}>{room.prompt}</span>}
                </span>
                <span className="shrink-0 text-sm font-medium text-ink-soft">
                  {joining === room.id
                    ? 'joining…'
                    : room.isOwner
                      ? 'yours'
                      : room.isMember
                        ? 'joined'
                        : room.closed
                          ? 'closed'
                          : <span className="text-ink underline decoration-1 underline-offset-4">join</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p role="status" className={`min-h-6 ${note}`}>
        {error}
      </p>
    </div>
  );
}
