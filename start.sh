#!/bin/sh
set -e

echo "[start] Running Prisma migrations..."
npx prisma migrate deploy

echo "[start] Starting Kyubi server..."
node server.mjs
