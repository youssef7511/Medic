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

# Copy runtime files from builder
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json* ./package-lock.json
COPY --from=builder /app/prisma ./prisma

# Install production deps AFTER prisma schema is present so the
# @prisma/client postinstall can generate the client.
RUN npm ci --omit=dev && npx prisma generate

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/next.config.mjs ./
COPY --from=builder /app/tsconfig.json ./

USER appuser

EXPOSE 3000

CMD ["npm", "run", "start"]