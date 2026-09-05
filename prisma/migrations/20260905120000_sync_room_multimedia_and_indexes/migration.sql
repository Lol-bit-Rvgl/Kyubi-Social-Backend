-- Sincroniza índices de RoomMessage (characterId) declarados en schema.prisma.
-- Aplicada con migrate deploy: migrate dev queda bloqueado en Supabase pooler
-- (shadow database no disponible), ver AGENTS.md.
CREATE INDEX IF NOT EXISTS "RoomMessage_characterId_idx" ON "RoomMessage"("characterId");