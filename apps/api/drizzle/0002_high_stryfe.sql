CREATE TYPE "public"."room_visibility" AS ENUM('private', 'public');--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "visibility" "room_visibility" DEFAULT 'private' NOT NULL;--> statement-breakpoint
CREATE INDEX "rooms_discovery_idx" ON "rooms" USING btree ("visibility","closed","created_at","id");