# spider-web

A place to leave a worry and have strangers answer it with kindness. Every
supportive message someone sends becomes one more thread in your spider's web.


## Run it

Needs Node 22 and pnpm.

```sh
pnpm install
pnpm dev        # web on http://localhost:5173, api on http://localhost:8787
```

Other commands: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.

**Signing in while developing:** no email is sent. Enter any email address, and the
6-digit code is printed in the terminal where `pnpm dev` is running.

**Database:** nothing to install. Postgres runs inside the API process (PGlite) and keeps
its files in `apps/api/.data/`; delete that folder to start empty. After changing
`apps/api/src/db/schema.ts`, run `pnpm --filter @spider-web/api db:generate` to write the
migration; it is applied automatically the next time the API starts.

## Layout

```
apps/web     React + TypeScript + Tailwind (Vite)
apps/api     Hono + TypeScript
prototype/   the original single-file canvas sketch; open index.html in a browser
```

## Private-room backend

Private occasion rooms now have a backend API; the frontend is not connected yet.
