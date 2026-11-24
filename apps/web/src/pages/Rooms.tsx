import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import Page from '../components/Page';
import { note, primary, quiet } from '../components/ui';
import { explain } from '../lib/explain';
import type { Room } from '../lib/RoomApi';
import { roomApi } from '../services';

// Every room the signed-in person belongs to: the ones they opened and the
// ones they joined, with a link or from the public rooms.
export default function Rooms() {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    roomApi
      .list()
      .then((found) => alive && setRooms(found))
      .catch((err: unknown) => alive && setError(explain(err)));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Page>
      <h1 className="font-hand text-display">your rooms</h1>

      {error && <p role="alert" className={note}>{error}</p>}
      {rooms?.length === 0 && (
        <p className={note}>nothing here yet.</p>
      )}

      {rooms && rooms.length > 0 && (
        <ul className="grid w-full gap-1">
          {rooms.map((room) => (
            <li key={room.id}>
              <Link
                to={`/rooms/${room.id}`}
                className="flex items-baseline justify-between gap-4 border-b border-ink-soft/25 py-3 text-left hover:border-ink"
              >
                <span className="font-hand text-xl text-ink">{room.title}</span>
                <span className="shrink-0 text-sm font-medium text-ink-soft">
                  {[room.isOwner ? 'yours' : 'joined', room.visibility === 'public' ? 'public' : null, room.closed ? 'closed' : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-center gap-5">
        <Link to="/rooms/new" className={primary}>
          open a room
        </Link>
        <Link to="/join" className={quiet}>
          join a room
        </Link>
      </div>
    </Page>
  );
}
