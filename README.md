# Gossamer

A place to collect meaningful messages. Each message becomes a thread in a growing web,
turning encouragement, congratulations and memories into something worth keeping.

Private rooms let someone collect messages for a graduation, birthday or farewell by
sharing an invitation code. Public, anonymous support is a planned extension.

## Stack

- React, TypeScript, Vite, Tailwind CSS and Motion
- Node.js, Hono and Drizzle ORM
- PGlite for local development; PostgreSQL for hosted environments
- Resend for optional email-code delivery

## Local development

Requires Node.js 22.17 or later in the Node 22 release line and pnpm 10.1.0.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The frontend runs at `http://localhost:5173` and proxies `/api` to the backend on port
8787. No separate database installation is needed. PGlite stores local data in
`apps/api/.data/pg` by default and applies migrations on startup.

Without email configuration, sign-in codes appear in the terminal running the API.
Codes expire after ten minutes, work once and allow five incorrect attempts. Requests
are limited to one code per minute and five per hour per email address.

## Real email during development

Copy `apps/api/.env.example` to `apps/api/.env` if that file does not already exist.
The API loads this file automatically. Keep it private; it is ignored by Git.

Set these values in that file:

```dotenv
MAIL_MODE=resend
RESEND_API_KEY=your-api-key
MAIL_FROM=Gossamer <onboarding@resend.dev>
SIGN_IN_ALLOWLIST=your-resend-account-email@example.com
```

The Resend test sender can email only the address associated with your Resend account.
Sending to other people requires a verified sending domain and a sender address on that
domain. Never place the API key in frontend variables or commit it.

Check the settings without printing credentials or sending an email:

```sh
pnpm --filter @spider-web/api config:check
```

Restart the API after changing `.env`. Request a code through the sign-in page and check
your inbox. Resend mode does not print verification codes in the application log.

`PORT` defaults to 8787. The example environment file uses 8900 to avoid colliding with
other previews; change it to 8787 for the standard local setup, or point your frontend's
API proxy to 8900.

## Private-room API

All `/api/rooms` routes require a signed-in session. Members can read messages; owners
can manage invitations, close contributions and remove messages.

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/api/rooms` | Create a room with `{title, prompt?}` |
| GET | `/api/rooms` | List the caller's rooms |
| POST | `/api/rooms/join` | Join with `{code}` |
| GET | `/api/rooms/:id` | Read a member-only room |
| PATCH | `/api/rooms/:id` | Owner sets `{closed: true/false}` |
| POST | `/api/rooms/:id/invite` | Owner rotates the invitation code |
| GET | `/api/rooms/:id/messages?after=0` | Read messages, up to 100 per page |
| POST | `/api/rooms/:id/messages` | Send `{body, signature?, requestId}` |
| DELETE | `/api/rooms/:id/messages/:messageId` | Owner removes a message |

Generate a UUID `requestId` for each intended message and reuse it on network retries.
Message positions stay stable. Invitation rotation prevents new joins with the old code
but does not evict existing members. Private rooms are access-controlled, not end-to-end
encrypted. Signatures are optional display text, not verified identities.

## Checks

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

A separate suite tests network PostgreSQL, including concurrent requests from two API
instances. It requires `POSTGRES_TEST_URL` pointing at a disposable **local** database
named `gossamer_test`. It never reads the production `DATABASE_URL`.

```sh
pnpm --filter @spider-web/api test:postgres
```

GitHub Actions provisions PostgreSQL 17 for that suite. Docker is optional for local
PostgreSQL testing; the application does not currently include a Dockerfile or Compose setup.

## Deployment

A recommended initial setup is a Node web service on Render, managed PostgreSQL, and
Resend. The Node service serves both the built frontend and API under one HTTPS origin.
Local testing and hosted production must use separate databases and secrets.

Configure the host from the repository root:

| Setting | Command or value |
| --- | --- |
| Build | `pnpm install --frozen-lockfile && pnpm build` |
| Pre-deploy migration | `pnpm --filter @spider-web/api db:migrate` |
| Start | `pnpm --filter @spider-web/api start` |
| Readiness endpoint | `/api/ready` |

The migration command uses the compiled API, so build first. Run migrations once per
release. Render's pre-deploy command requires a supported paid service plan; otherwise
arrange a separate migration step before starting the new release.

Required production settings:

- `NODE_ENV=production`
- `DATABASE_URL`: the provider's PostgreSQL connection string
- `AUTH_SECRET`: a new random secret containing at least 32 characters
- `PUBLIC_ORIGIN`: the exact HTTPS website origin, without a trailing slash
- `MAIL_MODE=resend`, `RESEND_API_KEY`, and `MAIL_FROM`
- `SIGN_IN_ALLOWLIST`: comma-separated invited email addresses for the initial pilot

The host supplies `PORT`. Production serves `apps/web/dist` by default; `WEB_DIST` can
override that location. Package the compiled API, its SQL migrations and the web build.
Check database backups and real email delivery before admitting users. Removing an email
from the sign-in allowlist does not revoke an existing session.

This branch contains backend deployment preparation; integrate the reviewed room UI before
releasing the complete app. Public registration, broader abuse controls, reporting and
moderation remain future work. Running locally, committing or pushing does not deploy a site.

## Layout

```text
apps/web      React frontend
apps/api      Hono backend, database schema and migrations
prototype/    Original standalone web-animation sketch
```
