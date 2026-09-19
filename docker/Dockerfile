FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first for layer caching
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma client, build app, run typecheck
RUN npx prisma generate && npm run build && npm run typecheck

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/package.json package.json ./
COPY --from=builder /app/tsconfig.json tsconfig.json ./
COPY --from=builder /app/prisma ./prisma

USER appuser

EXPOSE 3000

CMD ["node", "server.js"]