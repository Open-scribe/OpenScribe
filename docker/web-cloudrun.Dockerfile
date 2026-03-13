FROM node:20-bookworm-slim AS builder

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_SECURE_STORAGE_KEY
ENV NEXT_PUBLIC_SECURE_STORAGE_KEY=${NEXT_PUBLIC_SECURE_STORAGE_KEY}
ARG NEXT_PUBLIC_HIPAA_HOSTED_MODE
ENV NEXT_PUBLIC_HIPAA_HOSTED_MODE=${NEXT_PUBLIC_HIPAA_HOSTED_MODE}
ARG DATABASE_URL
ENV DATABASE_URL=${DATABASE_URL}

RUN corepack enable

COPY package.json pnpm-lock.yaml tsconfig.json ./
COPY config ./config
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY local-only ./local-only

RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:20-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm install --global pnpm@10.23.0

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app ./

USER nextjs

EXPOSE 8080

CMD ["sh", "-c", "pnpm start -- -p ${PORT:-8080}"]
