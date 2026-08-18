# Kyubi Social Backend

API inicial para el cliente Flutter: autenticación JWT con refresh-token rotativo, perfil y feed/publicaciones.

## Arranque

1. Copia `.env.example` a `.env` y genera un `JWT_SECRET` de al menos 32 caracteres.
2. Ejecuta `docker compose up -d`.
3. Ejecuta `npm install`, `npm run db:generate` y `npm run db:migrate` (las migraciones iniciales ya están incluidas en `prisma/migrations`). Después `npm run dev`. Si Windows bloquea la caché global de npm, usa `npm install --cache .npm-cache`.

Para validar: `npm run typecheck` y `npm test` (Vitest, 31 tests).

La API se sirve en `http://localhost:3000`. Las rutas REST usan la raíz (sin prefijo `/api`; la excepción es `GET /api/health`). Existe un árbol paralelo `src/app/api/...` experimental que solo consumen los tests Vitest; **no es el contrato** del cliente Flutter. Configura Flutter con `--dart-define=API_BASE_URL=http://10.0.2.2:3000` para emulador Android; sockets y REST comparten el mismo origen.

## Endpoints actuales

Auth (raíz): `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/verify-email`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `GET /auth/me`.

Resto (raíz): `GET|PATCH /users/me`, `GET|PATCH /users/me/profile`, `GET|PATCH /users/me/availability`, `GET /users/me/achievements`, `GET|POST /users/me/stickers`, `GET /users/check-username/:username`, `POST /users/onboarding`, `POST /users/setup/interests`, `POST /users/payment-password`, `POST /users/verify-payment-password`, `GET /users/:username/profile`, `GET /users/:username/followers`, `GET /users/:username/following`, `POST /users/:username/visit`, `GET /users/:username/visits`, `POST|DELETE /users/:username/block`, `POST /users/:username/report`, `POST /users/follow/:id`, `POST /users/unfollow/:id`, `POST /posts`, `GET /posts/feed`, `GET /posts/user/:username`, `GET|PATCH|DELETE /posts/:id`, `POST|DELETE /posts/:id/react`, `GET /posts/:id/reactions`, `GET|POST /posts/:id/comments`, `POST /posts/:id/report`, `POST /posts/:id/translate`, `POST /posts/:id/join-rp`, `POST /posts/ai-improve`, `POST /posts/comments/:id`, `POST /posts/comments/:id/like`, `GET /posts/drafts/my`, `POST /posts/drafts/autosave`, `POST /posts/upload/:kind`, `GET|POST /wall/:userId`, `POST /wall/:userId/subscribe`, `POST /wall/react/:postId`, `GET|POST /notifications`, `POST|DELETE /notifications/:id`, `GET /stories`, `GET /stories/:id`, `GET /circles/my-circles`, `GET /circles/search`, `GET|POST /circles/:circleId`, `GET /circles/:circleId/posts`, `GET /search/people`, `GET /search/suggest`, `GET /search/trending`, `GET /search`, `GET|POST /rooms`, `GET /rooms/:id`, `GET /rooms/:id/messages`, `POST /rooms/:id/messages`, `POST /rooms/:id/read`, `GET /chats/:conversationId/search`, `POST /upload/:kind`, `GET /api/health`.

### Notificaciones

`NotificationType`: `FOLLOW | REACTION | COMMENT | MENTION | WALL`. Se generan en servidor al seguir, reaccionar (solo al añadir), comentar (autor del post, autor del comentario padre si es respuesta y menciones `@username`) y escribir en el muro (dueño, autor de la entrada padre si es respuesta y menciones). Se omite cuando el actor es el propio destinatario. Respuesta de `GET /notifications`: `{ data, total, page, pages, unread }`; `POST /notifications` marca todas como leídas.

El correo (verificación de email y restablecimiento de contraseña) se envía por SMTP si `SMTP_HOST` está configurado; en caso contrario se imprime en consola en desarrollo. La rotación de refresh-tokens incluye detección de reutilización y limpieza de tokens expirados.

El chat en tiempo real usa Socket.IO sobre el mismo servidor (`server.mjs`): eventos `conversation:join`/`conversation:leave`/`typing`/`read`, y emisiones `message:new`/`conversation:new`/`conversation:update` en la sala `conversation:{id}`.
