-- Persistencia del modo interactivo activo de la sala.
-- Se añade `currentMode` a Room para que los usuarios que entran después de que
-- el Host active voz/cine/roleplay vean la actividad en curso al cargar la sala.
-- Valores: 'standard' | 'voice' | 'roleplay' | 'screening'.
ALTER TABLE "Room" ADD COLUMN IF NOT EXISTS "currentMode" TEXT NOT NULL DEFAULT 'standard';