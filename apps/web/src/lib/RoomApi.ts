import type { ApiClient } from './ApiClient';

// The backend's private-room endpoints as plain methods. The contract is
// docs/BACKEND.md on the backend branch. Whether someone may see or change a
// room is always the backend's decision: a 404 here means "not for you" as
// much as "doesn't exist", and screens must not try to tell the two apart.

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
};

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

  /** The invite code is returned here and never again; show it straight away. */
  create(title: string, prompt: string): Promise<{ room: Room; inviteCode: string }> {
    return this.http.post('/rooms', prompt ? { title, prompt } : { title });
  }

  async list(): Promise<Room[]> {
    return (await this.http.get<{ rooms: Room[] }>('/rooms')).rooms;
  }

  /** Joining twice is harmless. The code travels in the request body, never in a URL. */
  async join(code: string): Promise<Room> {
    return (await this.http.post<{ room: Room }>('/rooms/join', { code })).room;
  }

  async get(id: string): Promise<Room> {
    return (await this.http.get<{ room: Room }>(`/rooms/${id}`)).room;
  }

  async setClosed(id: string, closed: boolean): Promise<Room> {
    return (await this.http.patch<{ room: Room }>(`/rooms/${id}`, { closed })).room;
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
