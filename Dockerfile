# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
RUN npm install --global pnpm@10.1.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json

FROM dependencies AS build
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY apps ./apps
RUN pnpm build

FROM dependencies AS production-dependencies
RUN pnpm install --prod --frozen-lockfile --filter @spider-web/api...

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=8787
WORKDIR /app/apps/api
COPY --from=production-dependencies /app/node_modules /app/node_modules
COPY --from=production-dependencies /app/apps/api/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json ./package.json
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/drizzle ./drizzle
COPY --from=build /app/apps/web/dist /app/apps/web/dist
USER node
EXPOSE 8787
CMD ["node", "dist/index.js"]
