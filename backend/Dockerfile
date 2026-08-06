# ---- Build stage: install all deps and compile TS -> dist ----
# Node 22 (native WebSocket, required by @supabase/supabase-js realtime client).
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- Runtime stage ----
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
# Bring the full dependency tree (incl. ts-node/typescript) so release-phase
# `npm run migrate` / `create-admin` can run the TypeScript scripts.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/package*.json ./
COPY --from=build /app/tsconfig.json ./

EXPOSE 3000
# Container orchestrator should run `npm run migrate` once per deploy before
# scaling up app instances. The app itself just serves.
CMD ["node", "dist/server.js"]
