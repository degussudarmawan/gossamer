import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../lib/ApiClient';
import type { Message, Room } from '../lib/RoomApi';
import { roomApi } from '../services';

const REFRESH_MS = 8000;

export type RoomState = {
  /** 'missing' covers both "no such room" and "not one of yours": the backend doesn't say which. */
  status: 'loading' | 'ready' | 'missing' | 'failed';
  room: Room | null;
  messages: Message[];
  /** Fetch the messages again now, e.g. right after sending or removing one. */
  refresh: () => Promise<void>;
  /** Replace the room after an owner action returns the updated one. */
  setRoom: (room: Room) => void;
};

/**
 * Loads one room and its messages, then keeps the messages fresh by asking
 * again every few seconds while the tab is visible. Each refresh fetches the
 * whole list, which is also how removed messages disappear.
 */
export function useRoom(id: string): RoomState {
  const [status, setStatus] = useState<RoomState['status']>('loading');
  const [room, setRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);

  const refresh = useCallback(async () => {
    const [nextRoom, nextMessages] = await Promise.all([roomApi.get(id), roomApi.messages(id)]);
    setRoom(nextRoom);
    // keep the same array when nothing changed, so the web isn't laid out again for no reason
    setMessages((prev) =>
      prev.length === nextMessages.length && prev.every((m, i) => m.id === nextMessages[i]!.id) ? prev : nextMessages,
    );
  }, [id]);

  useEffect(() => {
    let alive = true;
    setStatus('loading');
    refresh()
      .then(() => alive && setStatus('ready'))
      .catch((err: unknown) => {
        if (!alive) return;
        const gone = err instanceof ApiError && (err.status === 404 || err.status === 400);
        if (!gone) console.error('could not load the room', err);
        setStatus(gone ? 'missing' : 'failed');
      });

    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      refresh().catch((err: unknown) => {
        // Losing access (removed, signed out) shows on the next real action;
        // a passing network blip shouldn't blank the room.
        console.warn('room refresh failed', err);
      });
    }, REFRESH_MS);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [refresh]);

  return { status, room, messages, refresh, setRoom };
}
