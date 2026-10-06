# syntax=docker/dockerfile:1
# One Dockerfile for the three runtime apps. Build a target with
#   docker build -f infra/docker/Dockerfile --target api|worker|web .
# Workspace packages are consumed as TypeScript source and run through tsx,
# so there is no separate compile step for api and worker.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ---- api ----
FROM deps AS api
ENV NODE_ENV=production PORT=4000
EXPOSE 4000
CMD ["pnpm", "--filter", "@honeytree/api", "start"]

# ---- worker (needs ffmpeg for video processing) ----
FROM deps AS worker
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@honeytree/worker", "start"]

# ---- web ----
FROM deps AS web-build
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_USE_MOCKS=false
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_USE_MOCKS=$NEXT_PUBLIC_USE_MOCKS
RUN pnpm --filter @honeytree/web build

FROM web-build AS web
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["pnpm", "--filter", "@honeytree/web", "start"]
