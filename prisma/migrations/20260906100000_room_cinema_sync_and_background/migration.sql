-- Sincroniza los campos de Room declarados en schema.prisma para:
--   1) chatBackgroundUrl  (fondo del chat persistente)
--   2) Cinema sync        (cinemaVideoId / cinemaState / cinemaCurrentTime / cinemaUpdatedAt)
-- Aplicar con `prisma migrate deploy` (migrate dev queda bloqueado por el
-- pooler de Supabase / shadow DB indisponible; ver AGENTS.md).
ALTER TABLE "Room" ADD COLUMN IF NOT EXISTS "chatBackgroundUrl" TEXT;
ALTER TABLE "Room" ADD COLUMN IF NOT EXISTS "cinemaVideoId" TEXT;
ALTER TABLE "Room" ADD COLUMN IF NOT EXISTS "cinemaState" TEXT DEFAULT 'STOPPED';
ALTER TABLE "Room" ADD COLUMN IF NOT EXISTS "cinemaCurrentTime" DOUBLE PRECISION DEFAULT 0.0;
ALTER TABLE "Room" ADD COLUMN IF NOT EXISTS "cinemaUpdatedAt" TIMESTAMP(3);
