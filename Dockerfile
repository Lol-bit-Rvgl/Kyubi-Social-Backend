# ===========================================
# Kyubi Social Backend — Production Dockerfile
# ===========================================
# Uses custom server.mjs with Next.js (no standalone mode).
# Two-stage build to keep the final image lean.

FROM node:20-alpine AS base

# -------------------------------------------
# Stage 1: Install dependencies & build
# -------------------------------------------
FROM base AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build

# -------------------------------------------
# Stage 2: Production image
# -------------------------------------------
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN apk add --no-cache dumb-init curl

# node_modules (production deps only)
COPY --from=builder /app/node_modules ./node_modules
# Prisma client (generated)
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
# .next build output
COPY --from=builder /app/.next ./.next
# Source files needed at runtime
COPY --from=builder /app/server.mjs ./
COPY --from=builder /app/start.sh ./
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/public ./public

RUN chmod +x start.sh

EXPOSE ${PORT}

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:${PORT}/api/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["./start.sh"]
