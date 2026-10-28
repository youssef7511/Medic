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

# Next.js standalone output bundles node_modules, server.js and the traced
# runtime files, so no extra package.json/tsconfig/prisma copy is needed.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# React-PDF reads its bundled fonts at runtime when issuing prescriptions.
COPY --from=builder /app/src/lib/documents/pdf/fonts ./src/lib/documents/pdf/fonts

USER appuser

EXPOSE 3000

CMD ["node", "server.js"]
