import { and, asc, desc, eq, gt, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { messages, roomMembers, rooms } from '../db/schema.js';

export type Room = typeof rooms.$inferSelect;
export type MessageInput = { body: string; signature?: string; requestId: string };

export class RoomRepository {
  constructor(private readonly db: Db) {}

  create(ownerId: string, title: string, prompt: string, inviteHash: string) {
    return this.db.transaction(async (tx) => {
      const [room] = await tx.insert(rooms).values({ ownerId, title, prompt, inviteHash }).returning();
      await tx.insert(roomMembers).values({ roomId: room!.id, userId: ownerId });
      return room!;
    });
  }

  list(userId: string) {
    return this.db.select({ room: rooms }).from(roomMembers)
      .innerJoin(rooms, eq(rooms.id, roomMembers.roomId))
      .where(eq(roomMembers.userId, userId)).orderBy(desc(rooms.createdAt), desc(rooms.id)).limit(100);
  }

  // Serialise joins, invitation rotation, closing and sends on the same room.
  // The callback receives data operations only; service callbacks enforce policy.
  withRoom<T>(id: string, userId: string, action: (room: Room, member: boolean, ops: RoomOperations) => Promise<T>) {
    return this.db.transaction(async (tx) => {
      const [room] = await tx.select().from(rooms).where(eq(rooms.id, id)).for('update');
      if (!room) return null;
      const [member] = await tx.select().from(roomMembers)
        .where(and(eq(roomMembers.roomId, id), eq(roomMembers.userId, userId)));
      return action(room, !!member, new RoomOperations(tx, id));
    });
  }

  async findInvite(inviteHash: string) {
    const [room] = await this.db.select({ id: rooms.id }).from(rooms).where(eq(rooms.inviteHash, inviteHash));
    return room?.id;
  }
}

type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];
export class RoomOperations {
  constructor(private readonly tx: Transaction, private readonly roomId: string) {}
  async join(userId: string) {
    await this.tx.insert(roomMembers).values({ roomId: this.roomId, userId }).onConflictDoNothing();
  }
  async update(values: { inviteHash?: string; closed?: boolean; nextPosition?: number }) {
    const [room] = await this.tx.update(rooms).set(values).where(eq(rooms.id, this.roomId)).returning();
    return room!;
  }
  listMessages(after: number) {
    return this.tx.select({ id: messages.id, body: messages.body, signature: messages.signature,
      position: messages.position, createdAt: messages.createdAt }).from(messages)
      .where(and(eq(messages.roomId, this.roomId), isNull(messages.removedAt), gt(messages.position, after)))
      .orderBy(asc(messages.position)).limit(100);
  }
  async existing(senderId: string, requestId: string) {
    const [message] = await this.tx.select().from(messages).where(and(eq(messages.roomId, this.roomId),
      eq(messages.senderId, senderId), eq(messages.requestId, requestId)));
    return message;
  }
  async insert(senderId: string, input: MessageInput, position: number) {
    const [message] = await this.tx.insert(messages).values({ ...input, roomId: this.roomId, senderId, position }).returning();
    return message!;
  }
  async remove(id: string, at: Date) {
    const result = await this.tx.update(messages).set({ removedAt: at, body: '', signature: null })
      .where(and(eq(messages.roomId, this.roomId), eq(messages.id, id))).returning({ id: messages.id });
    return result.length > 0;
  }
}
