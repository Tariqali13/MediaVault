# syntax=docker/dockerfile:1
# Build from the repository root:  docker build -f apps/api/Dockerfile .
# Debian slim (not Alpine) so sharp/libvips use their prebuilt glibc binaries.
FROM node:22-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @mediavault/api --include-workspace-root=false
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build --workspace @mediavault/api && npm prune --omit=dev --workspace @mediavault/api

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/migrations ./migrations
COPY --from=build /repo/apps/api/package.json ./
RUN mkdir -p .data && chown node:node .data
USER node
EXPOSE 4100
HEALTHCHECK --interval=10s --timeout=3s CMD node -e "fetch('http://localhost:4100/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
