# Jhol api + worker image. Build from the REPO ROOT:
#   docker build -f apps/api/Dockerfile -t jhol-api .
# Same image runs both Railway services — set ROLE=api on one and ROLE=worker on the other.
FROM node:22-slim

ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable

WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "@jhol/api..."
RUN pnpm --filter @jhol/core build && pnpm --filter @jhol/api build

WORKDIR /repo/apps/api
ENV NODE_ENV=production
CMD ["node", "dist/main.js"]
