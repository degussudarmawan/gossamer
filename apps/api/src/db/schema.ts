import { index, integer, pgTable, primaryKey, uniqueIndex, boolean, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  // always stored trimmed and lower-cased, so "A@b.com" and "a@b.com" are one person
  email: text('email').notNull().unique(),
  createdAt: createdAt(),
});

// One row per sign-in code emailed out. Only a hash of the code is kept.
export const loginCodes = pgTable(
  'login_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    // wrong guesses made against this code
    attempts: integer('attempts').notNull().default(0),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('login_codes_email_created_idx').on(t.email, t.createdAt)],
);

// One row per signed-in browser. The cookie holds a random token; only its hash is kept.
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

// Private collections: invite credentials never appear in read responses.
export const rooms = pgTable('rooms', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  prompt: text('prompt').notNull().default(''),
  seed: uuid('seed').notNull().defaultRandom(),
  inviteHash: text('invite_hash').notNull().unique(),
  closed: boolean('closed').notNull().default(false),
  nextPosition: integer('next_position').notNull().default(1),
  createdAt: createdAt(),
}, (t) => [index('rooms_owner_idx').on(t.ownerId)]);

export const roomMembers = pgTable('room_members', {
  roomId: uuid('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.roomId, t.userId] }), index('members_user_idx').on(t.userId)]);

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  roomId: uuid('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  senderId: uuid('sender_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  signature: text('signature'),
  position: integer('position').notNull(),
  // Caller-supplied UUID makes retrying a send safe.
  requestId: uuid('request_id').notNull(),
  removedAt: timestamp('removed_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('messages_position_idx').on(t.roomId, t.position),
  uniqueIndex('messages_request_idx').on(t.roomId, t.senderId, t.requestId)]);
