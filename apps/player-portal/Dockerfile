# Multi-stage build. Docker build context must be the monorepo root so
# npm workspaces can resolve @dm-tool/shared. docker-compose's
# `build.context: ../..` takes care of this for both dev + deploy.
#
# Build stage installs all workspace deps, builds the Vite SPA (dist/) +
# the Fastify server (server-dist/). Runtime stage is a slim node:alpine
# that reuses the hoisted node_modules from build — avoids a second
# install pass (which trips on peer-dep checks against devDeps).

FROM node:22-alpine AS build
WORKDIR /repo
# Workspace manifests first so the install layer caches cleanly across
# source-only changes.
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/player-portal/package.json apps/player-portal/
COPY apps/dm-tool/package.json apps/dm-tool/
COPY packages/shared/package.json packages/shared/
RUN npm install --ignore-scripts
# Source — only what the portal build actually needs.
COPY packages/shared packages/shared
COPY apps/player-portal apps/player-portal
RUN npm --workspace @dm-tool/player-portal run build

FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=build /repo/apps/player-portal/dist ./dist
COPY --from=build /repo/apps/player-portal/server-dist ./server-dist
COPY --from=build /repo/apps/player-portal/package.json ./package.json
# Reuse the hoisted monorepo node_modules from the build stage. It
# contains every prod dep Fastify needs + the React bits the SPA bundled
# at build time (bundled-only paths are fine even though the symlinks to
# source are unreachable at runtime — nothing imports them).
COPY --from=build /repo/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "server-dist/index.js"]
