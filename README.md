# spider-web

A place to leave a worry and have strangers answer it with kindness. Every
supportive message someone sends becomes one more thread in your spider's web.


## Run it

Needs Node 22 and pnpm.

```sh
pnpm install
pnpm dev        # web on http://localhost:5173, api on http://localhost:8787
```

Other commands: `pnpm lint`, `pnpm typecheck`, `pnpm build`.

## Layout

```
apps/web     React + TypeScript + Tailwind (Vite)
apps/api     Hono + TypeScript
prototype/   the original single-file canvas sketch; open index.html in a browser
```
