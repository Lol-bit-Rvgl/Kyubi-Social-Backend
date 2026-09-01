-- Índices GIN para búsqueda full-text (español/simple) ─ Kyubi Search
-- Post: contenido + tags serializados.
CREATE INDEX IF NOT EXISTS "posts_search_idx"
  ON "Post" USING GIN (
    to_tsvector('spanish', coalesce("content", '') || ' ' || array_to_string("tags", ' '))
  );

-- User: username + displayName + bio (config 'simple' para usernames).
CREATE INDEX IF NOT EXISTS "users_search_idx"
  ON "User" USING GIN (
    to_tsvector('simple',
      coalesce("username", '') || ' ' ||
      coalesce("displayName", '') || ' ' ||
      coalesce("bio", ''))
  );

-- Room (salas de roleplay): nombre + descripción.
CREATE INDEX IF NOT EXISTS "rooms_search_idx"
  ON "Room" USING GIN (
    to_tsvector('spanish',
      coalesce("name", '') || ' ' || coalesce("description", ''))
  );
