import type { ApiClient } from './ApiClient';

// The backend's room endpoints as plain methods. The contract is
// docs/BACKEND.md on the backend branch. Whether someone may see or change a
// room is always the backend's decision: a 404 here means "not for you" as
// much as "doesn't exist", and screens must not try to tell the two apart.
//
// Public rooms are not in the backend yet. What this file expects of them is
// written down in docs/handoffs/public-rooms-ui.md.

/** Private rooms are joined with an invite link; public ones can be found in a list. */
export type Visibility = 'private' | 'public';

export type Room = {
  id: string;
  title: string;
  /** Empty string when the owner wrote none. */
  prompt: string;
  /** Fixes the shape of this room's web, so it looks the same to every member. */
  seed: number;
  /** Closed rooms can be read but take no new people or messages. */
  closed: boolean;
  createdAt: string;
  isOwner: boolean;
  visibility: Visibility;
  /** False only for a public room the person is looking at without having joined. */
  isMember: boolean;
};

// A backend without public rooms leaves out the two newer fields. Every room it
// sends is then private, and only ever sent to its members.
type RoomFromServer = Omit<Room, 'visibility' | 'isMember'> & Partial<Pick<Room, 'visibility' | 'isMember'>>;

const complete = (room: RoomFromServer): Room => ({
  ...room,
  visibility: room.visibility ?? 'private',
  isMember: room.isMember ?? true,
});

export type Message = {
  id: string;
  body: string;
  /** A name the writer chose to show. Not checked against who they are. */
  signature: string | null;
  /** This message's permanent number in the room, starting at 1. Never reused. */
  position: number;
  createdAt: string;
};

export type Draft = {
  body: string;
  signature?: string;
  /** One id per intended message, kept across retries so a retry can't post twice. */
  requestId: string;
};

export const ROOM_LIMITS = { title: 120, prompt: 1000, body: 2000, signature: 80 } as const;

export class RoomApi {
  constructor(private readonly http: ApiClient) {}

  /**
   * A private room's invite code is returned here and never again; show it
   * straight away. A public room needs no code, so it may come back null.
   * `visibility` is only sent for a public room, so a backend that doesn't
   * know the field still opens private rooms (and refuses a public one with
   * invalid_input rather than quietly making it private).
   */
  async create(title: string, prompt: string, visibility: Visibility): Promise<{ room: Room; inviteCode: string | null }> {
    const made = await this.http.post<{ room: RoomFromServer; inviteCode?: string | null }>('/rooms', {
      title,
      ...(prompt ? { prompt } : {}),
      ...(visibility === 'public' ? { visibility } : {}),
    });
    return { room: complete(made.room), inviteCode: made.inviteCode ?? null };
  }

  /** The rooms this person opened or joined. */
  async list(): Promise<Room[]> {
    return (await this.http.get<{ rooms: RoomFromServer[] }>('/rooms')).rooms.map(complete);
  }

  /** Open public rooms anyone signed in can join, newest first. */
  async listPublic(): Promise<Room[]> {
    return (await this.http.get<{ rooms: RoomFromServer[] }>('/rooms/public')).rooms.map(complete);
  }

  /** Joining twice is harmless. The code travels in the request body, never in a URL. */
  async join(code: string): Promise<Room> {
    return complete((await this.http.post<{ room: RoomFromServer }>('/rooms/join', { code })).room);
  }

  /** Joins a public room, which needs no code. Joining twice is harmless. */
  async joinPublic(id: string): Promise<Room> {
    return complete((await this.http.post<{ room: RoomFromServer }>(`/rooms/${id}/join`)).room);
  }

  async get(id: string): Promise<Room> {
    return complete((await this.http.get<{ room: RoomFromServer }>(`/rooms/${id}`)).room);
  }

  async setClosed(id: string, closed: boolean): Promise<Room> {
    return complete((await this.http.patch<{ room: RoomFromServer }>(`/rooms/${id}`, { closed })).room);
  }

  /**
   * Owner only. Going private takes the room out of the public list and leaves
   * everyone who joined in it; going public lists it, and makes every note in
   * it readable by anyone signed in. The invite code is not touched.
   */
  async setVisibility(id: string, visibility: Visibility): Promise<Room> {
    return complete((await this.http.patch<{ room: RoomFromServer }>(`/rooms/${id}`, { visibility })).room);
  }

  /** Replaces the invite code. The old one stops admitting people; current members stay. */
  async rotateInvite(id: string): Promise<string> {
    return (await this.http.post<{ inviteCode: string }>(`/rooms/${id}/invite`)).inviteCode;
  }

  /** Every message still in the room, in order. Removed ones are simply absent. */
  async messages(id: string): Promise<Message[]> {
    const all: Message[] = [];
    let after = 0;
    for (;;) {
      const page = await this.http.get<{ messages: Message[]; nextAfter: number }>(
        `/rooms/${id}/messages?after=${after}`,
      );
      all.push(...page.messages);
      if (page.messages.length < 100) return all;
      after = page.nextAfter;
    }
  }

  /** Returns only a receipt; reload the messages to see the stored text. */
  async send(id: string, draft: Draft): Promise<{ id: string; position: number }> {
    return (await this.http.post<{ message: { id: string; position: number } }>(`/rooms/${id}/messages`, draft))
      .message;
  }

  async removeMessage(id: string, messageId: string): Promise<void> {
    await this.http.delete(`/rooms/${id}/messages/${messageId}`);
  }
}
