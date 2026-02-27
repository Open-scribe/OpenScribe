FROM node:20-bookworm-slim

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml tsconfig.json ./
COPY config ./config
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY local-only ./local-only

RUN pnpm install --frozen-lockfile

EXPOSE 3001
