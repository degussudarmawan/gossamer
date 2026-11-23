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

GitHub Actions provisions PostgreSQL 17 for that suite.

## Run with Docker

Docker Desktop (or Docker Engine with Compose v2) is an alternative to installing Node
and PostgreSQL locally. From the repository root:

```sh
docker compose up --build -d
```

Open **http://localhost:5300**. This runs the built frontend and API in one non-root app
container, with PostgreSQL in another container. A one-off migration service runs after
the database becomes healthy and before the app starts. The database has no published
host port. The website is bound to localhost only.

The default Compose setup is a **local sandbox**, not a public production deployment.
It uses console email and local-only credentials; it never reads `apps/api/.env`
automatically or connects to your hosted database.

Useful commands:

```sh
docker compose logs -f app          # includes local sign-in codes in console mode
docker compose ps                  # service/health status
docker compose exec db psql -U gossamer -d gossamer  # inspect local tables
docker compose down                # stop; keep database data
```

Data lives in the Compose project's `postgres-data` named volume. It survives container
recreation. `docker compose down --volumes` explicitly deletes that sandbox database.
Your PGlite previews and their data are separate. Change `APP_PORT` if 5300 is in use:

```sh
APP_PORT=5301 docker compose up --build -d
```

For real email in this local sandbox, explicitly opt into your ignored API environment file:

```sh
docker compose --env-file apps/api/.env up --build -d
```

Set `MAIL_MODE=resend`, `RESEND_API_KEY`, `MAIL_FROM` and optionally `SIGN_IN_ALLOWLIST`
in that file first. Compose still uses its own PostgreSQL database and local HTTP settings.
Keep using the same `--env-file` option when managing this stack. Do not paste the output
of `docker compose config` into chat or issues: resolved environment settings can contain secrets.

The Dockerfile builds frontend assets and API code in a build stage, installs
only API production dependencies in the runtime, and runs as the `node` user. `.dockerignore`
excludes credentials, private documents, host dependencies, build output and database files.
Application changes require rebuilding with `docker compose up --build -d`; this setup
does not provide hot reload. `pnpm dev` remains available for day-to-day frontend work.

To run an automated smoke check, use a separate Compose project with console email and an
empty allowlist. It creates synthetic accounts/rooms and recreates the containers to verify
persistence. It never sends real email:

```sh
COMPOSE_PROJECT_NAME=gossamer-check APP_PORT=5301 docker compose up --build -d --wait
COMPOSE_PROJECT_NAME=gossamer-check APP_PORT=5301 node scripts/smoke-docker.mjs
COMPOSE_PROJECT_NAME=gossamer-check APP_PORT=5301 docker compose down --volumes
```

The image packages the frontend present on the branch being built. The `release/pilot`
branch includes the private-room screens and production backend together.

## Deployment

The repository includes `render.yaml` for a free invited pilot: one Render Free Docker web
service serving the frontend and API, with PostgreSQL hosted separately on Neon Free.
Hosting costs $0 per month while usage stays within the free limits; the domain is billed
separately. Local Docker remains the development sandbox and must never use the live
database or its authentication secret.

Free-tier trade-offs:

- Render spins the service down after 15 minutes without traffic. The next visitor waits
  about a minute while it wakes. Render may also restart Free services at any time.
- Neon allows 1 GB of storage and 100 CU-hours of compute per project per month. Its database
  sleeps after 5 idle minutes and wakes on the next query. Monitor usage in Neon to stay
  within the free allowances.
- Neon Free restore history is limited to 6 hours or 1 GB of data changes, with no scheduled
  backups. Export the data yourself (see below) before relying on it for irreplaceable messages.
- Resend Free sends up to 100 emails per day.
- Render's free PostgreSQL is not used: it expires 30 days after creation.

### First release on Render

1. Use the combined `release/pilot` branch. It integrates the committed private-room
   frontend with the production backend; ongoing design revisions stay on feature branches.
   Run lint, type checks, tests, the production build, and the Docker smoke check before
   publishing any new release. A local commit alone is not published.
2. Create a Neon Free project with PostgreSQL 17 in **AWS Asia Pacific (Singapore)**, the
   region nearest the Render service. Open **Connect**, turn **Connection pooling** off,
   and copy the Direct connection string (its host has no `-pooler`). Migrations need a
   direct connection in this setup. Change `sslmode=require` to `sslmode=verify-full`,
   keeping any other connection parameters unchanged. Copy the URL only, without a
   `psql` prefix or surrounding quotes. It contains a password; paste it only into Render.
3. Create a Render account and connect the GitHub account that owns this repository.
   Choose **New > Blueprint**, select this repository and the `release/pilot` branch,
   and use the root `render.yaml`. Do not select an older `main` that lacks the release.
4. Enter `DATABASE_URL` (the edited Neon string), `RESEND_API_KEY` and `SIGN_IN_ALLOWLIST`
   privately in Render's prompted fields. Render prompts for these only on first creation.
   The sender is already set to `Gossamer <login@gossamer.blog>` using the verified domain.
   The allowlist contains the email addresses permitted to sign in for this invited pilot;
   include both test users, separated by commas. Never put the API key in frontend code.
5. Confirm that Render shows the **Free** instance type and no database, then apply. Render
   builds the image and starts it. Each start applies pending migrations before the server
   listens, because Free services have no pre-deploy command. If migrations fail, the
   service does not start. Later code pushes do not deploy automatically.
6. Open the HTTPS URL shown in Render. Test sign-in with two real inboxes, create a room,
   join through its invite link, send/read a message, sign out, and sign back in. Check
   a nonmember cannot access the room. Redeploy the same release and verify saved messages.

If you already applied the earlier paid Blueprint, removing its database from this file
does not delete that resource or stop its billing. Preserve any existing data before
switching databases. Update `DATABASE_URL` in the existing web service's Environment tab,
remove its old pre-deploy command, and ensure its instance type is Free. Only retire an
old paid database after confirming it is no longer needed. Do not create duplicate services.

`AUTH_SECRET` is generated by Render. The Neon database is reachable over the internet,
protected by its password and verified TLS. Treat `DATABASE_URL` as a secret: if it leaks,
reset the role's password in Neon and update the value in Render. The app uses Render's
assigned `RENDER_EXTERNAL_URL` as its HTTPS origin. If you attach a custom website domain,
explicitly set `PUBLIC_ORIGIN` to that origin (no trailing slash), and use it consistently
in browser and invite links.

The Render health check uses `/api/health`, which does not query the database. Startup
already refuses to serve without a migrated database. Avoiding database checks every few
seconds lets Neon sleep and saves its compute-hours.

For logs, use the web service's **Logs** tab (startup, migrations and API errors) and Neon's
**Monitoring** page. Production codes are sent by email, never printed in logs.

To export the data, run `pg_dump` from a PostgreSQL 17 client with the same direct
connection string, for example through the `postgres:17` Docker image. Store the dump
privately, and practise restoring it into a separate Neon branch or local database.

### Develop while the pilot stays live

Keep everyday work on feature branches and test with `pnpm dev` or local Compose.
The Blueprint disables automatic code deployment and preview environments. Push and
review changes, wait for GitHub checks, then deploy the exact reviewed commit manually
from Render. Record that commit as the release. When moving the service to `main`, first
merge the complete release there, update the linked branch, and enable required GitHub
checks. CI configuration alone does not enforce branch protection.

Keep migrations compatible with the version still serving traffic. A code rollback does
not undo database migrations: roll back code only when the current schema supports it,
otherwise prepare a forward fix. Keep the same `AUTH_SECRET` across normal deployments
so existing sessions stay valid.

References: [Render Blueprints](https://render.com/docs/blueprint-spec),
[deployment lifecycle](https://render.com/docs/deploys),
[free resource limits](https://render.com/docs/free),
[Neon Free limits](https://neon.com/pricing),
[Neon connection setup](https://neon.com/docs/connect/connect-from-any-app), and
[Resend domain setup](https://resend.com/docs/dashboard/domains/introduction).

### Hosting without the Blueprint

The same Dockerfile can build a hosted image. Its default `NODE_ENV=production` requires
the settings below. Use managed PostgreSQL, inject secrets at runtime, and run
`node dist/db/migrate.js` once per release before starting the app. Do not deploy the local
Compose credentials/settings. Docker does not publish a website by itself.

Configure the host from the repository root:

| Setting | Command or value |
| --- | --- |
| Build | `pnpm install --frozen-lockfile && pnpm build` |
| Pre-deploy migration | `pnpm --filter @spider-web/api db:migrate` |
| Start | `pnpm --filter @spider-web/api start` |
| Readiness endpoint | `/api/ready` |

The migration command uses the compiled API, so build first. Run migrations once per
release. Render's pre-deploy command requires a paid plan, so the free Blueprint runs migrations
at the start of each boot instead. Elsewhere, run them before starting the new release.

Required production settings:

- `NODE_ENV=production`
- `DATABASE_URL`: the provider's PostgreSQL connection string
- `AUTH_SECRET`: a new random secret containing at least 32 characters
- `PUBLIC_ORIGIN`: the exact HTTPS website origin, without a trailing slash;
  optional on Render when using its assigned `RENDER_EXTERNAL_URL`
- `MAIL_MODE=resend`, `RESEND_API_KEY`, and `MAIL_FROM`
- `SIGN_IN_ALLOWLIST`: comma-separated invited email addresses for the initial pilot

The host supplies `PORT`. Production serves `apps/web/dist` by default; `WEB_DIST` can
override that location. Package the compiled API, its SQL migrations and the web build.
Check database backups and real email delivery before admitting users. Removing an email
from the sign-in allowlist does not revoke an existing session.

This release includes private rooms and their frontend. Public registration, broader abuse
controls, reporting and moderation remain future work. Running locally, committing or
pushing does not deploy a site.

## Layout

```text
apps/web      React frontend
apps/api      Hono backend, database schema and migrations
prototype/    Original standalone web-animation sketch
```
