import { createHash, randomBytes } from 'node:crypto';
import type { Clock } from '../shared/Clock.js';
import { type MessageInput, type Room, RoomRepository } from './RoomRepository.js';

export class RoomError extends Error {
  constructor(public readonly code: 'not_found' | 'forbidden' | 'room_closed' | 'retry_conflict') { super(code); }
}
const hash = (code: string) => createHash('sha256').update(code).digest('hex');
const issue = () => randomBytes(12).toString('hex').toUpperCase();
const view = (r: Room, userId: string) => ({ id: r.id, title: r.title, prompt: r.prompt,
  seed: r.seed, closed: r.closed, createdAt: r.createdAt, isOwner: r.ownerId === userId });
const requireMember = (member: boolean) => { if (!member) throw new RoomError('not_found'); };
const requireOwner = (r: Room, userId: string) => { if (r.ownerId !== userId) throw new RoomError('forbidden'); };

export class RoomService {
  constructor(private readonly rooms: RoomRepository, private readonly clock: Clock) {}
  async create(userId: string, title: string, prompt: string) {
    const inviteCode = issue();
    const room = await this.rooms.create(userId, title, prompt, hash(inviteCode));
    return { room: view(room, userId), inviteCode };
  }
  async list(userId: string) { return (await this.rooms.list(userId)).map(({ room }) => view(room, userId)); }
  async read(id: string, userId: string) {
    return this.found(await this.rooms.withRoom(id, userId, async (r, member) => {
      requireMember(member); return view(r, userId);
    }));
  }
  async join(userId: string, code: string) {
    const inviteHash = hash(code.trim().toUpperCase());
    const id = await this.rooms.findInvite(inviteHash);
    if (!id) throw new RoomError('not_found');
    return this.found(await this.rooms.withRoom(id, userId, async (r, member, ops) => {
      // Recheck after acquiring the lock in case the owner rotated the code.
      if (r.inviteHash !== inviteHash) throw new RoomError('not_found');
      if (!member && r.closed) throw new RoomError('room_closed');
      await ops.join(userId); return view(r, userId);
    }));
  }
  async manage(id: string, userId: string, closed: boolean) {
    return this.found(await this.rooms.withRoom(id, userId, async (r, member, ops) => {
      requireMember(member); requireOwner(r, userId);
      return view(await ops.update({ closed }), userId);
    }));
  }
  async rotate(id: string, userId: string) {
    return this.found(await this.rooms.withRoom(id, userId, async (r, member, ops) => {
      requireMember(member); requireOwner(r, userId);
      const inviteCode = issue(); await ops.update({ inviteHash: hash(inviteCode) }); return { inviteCode };
    }));
  }
  async messages(id: string, userId: string, after: number) {
    return this.found(await this.rooms.withRoom(id, userId, async (_r, member, ops) => {
      requireMember(member); return ops.listMessages(after);
    }));
  }
  async send(id: string, userId: string, input: MessageInput) {
    return this.found(await this.rooms.withRoom(id, userId, async (r, member, ops) => {
      requireMember(member);
      const existing = await ops.existing(userId, input.requestId);
      if (existing) {
        if (existing.removedAt || existing.body !== input.body || existing.signature !== (input.signature ?? null)) {
          throw new RoomError('retry_conflict');
        }
        return { id: existing.id, position: existing.position };
      }
      if (r.closed) throw new RoomError('room_closed');
      const message = await ops.insert(userId, input, r.nextPosition);
      await ops.update({ nextPosition: r.nextPosition + 1 });
      return { id: message.id, position: message.position };
    }));
  }
  async remove(id: string, userId: string, messageId: string) {
    return this.found(await this.rooms.withRoom(id, userId, async (r, member, ops) => {
      requireMember(member); requireOwner(r, userId);
      if (!await ops.remove(messageId, this.clock.now())) throw new RoomError('not_found');
      return { ok: true };
    }));
  }
  private found<T>(value: T | null): T { if (value === null) throw new RoomError('not_found'); return value; }
}
