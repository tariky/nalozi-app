# syntax=docker/dockerfile:1
FROM oven/bun:1 AS base
WORKDIR /app

# --- Install dependencies ---
# Install ALL deps (including devDependencies): the frontend is bundled
# on-the-fly at runtime by Bun.serve via bun-plugin-tailwind, which needs
# tailwindcss available in node_modules. There is no separate build step.
FROM base AS install
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# --- Release image ---
FROM base AS release
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/asnord.db

COPY --from=install /app/node_modules ./node_modules
COPY . .

# Persistent SQLite data lives here (mounted as a volume in compose)
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["bun", "src/index.ts"]
