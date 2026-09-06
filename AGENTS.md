
# Backend de Kyubi Social

Backend Next.js con Prisma + PostgreSQL (Supabase) para la plataforma social Kyubi.

## Estructura

- `src/app/api/*` — Endpoints REST (Next.js App Router)
- `src/lib/` — Lógica de negocio y utilidades (auth, moderation, prisma, socketio, etc.)
- `tests/*.test.ts` — Suite de tests con Vitest

## Base de Datos

- ORM: **Prisma 6.3.x** (`^6.3.1` según `package.json`)
- Base: **PostgreSQL 15** en Supabase (proyecto `kyubi-social` o similar)
- Conexión: via `DATABASE_URL` (pooler, puerto 6543) y `DIRECT_URL` (5432 para migraciones locales)

## Migraciones

- PrismaMigrate dev (requiere shadow DB)
- `npm run db:generate` — Genera tipos Prisma
- `npm run db:migrate` — Crea y aplica migraciones locales
- `npm run db:deploy` — Aplicación de migraciones en producción
- `npm run db:seed` — Semilla de datos de demostración

### Estado actual de migraciones

Última migración aplicada: `20260904125137_moderation_panel` (panel de administración)

## Sistema de Moderación (src/moderation/)

Endpoints de administración accesibles desde `/api/admin/*`:

### Autorización

- Middleware: `requireStaffRole` (requireRole) cumple con los roles:
  - `MODERATOR` — puede aplicar warn/mute/hide (no suspend/delete)
  - `ADMIN` — puede ban, hide, pin
  - `OWNER` — puede acciones críticas (bulk delete, revocar finestra)
- Guard especial: `requireAdminRole` (para acciones destructivas)

### Endpoints (API REST)

**Gestión de usuarios (sanciones):**
- `POST /api/admin/users/:id/sanction` — Aplica WARN/MUTE/SUSPEND/BAN
- `POST /api/admin/users/:id/unsanction` — Revoca sanciones
- `PATCH /api/admin/users/:id/profile-visibility` — Oculta/perfil
- `POST /api/admin/users/:id/titles` — Asigna título/insignia

**Moderación de contenido (posts):**
- `PATCH /api/admin/posts/:id/pin` — Fija a Vue máximo 3 posts
- `PATCH /api/admin/posts/:id/visibility` — Oculta/mostrar posts

**Centro de reportes:**
- `GET /api/admin/reports` — Lista reportes (query: status, targetType, page, limit)
- `PATCH /api/admin/reports/:id` — Actualiza estado (REVIEWING / RESOLVED / DISMISSED)

**Registro de auditoría:**
- `GET /api/admin/audit-logs` — Historial (query: action, moderatorId, targetUserId, page, limit)

### Logging Automático

Todas las acciones escriben en `ModerationLog` con:
- `moderatorId` (quien ejecuta)
- `action` (tipo de acción, enum)
- `targetType` / `targetId` (recurso afectado)
- `reason` (motivo optionally)
- `metadata` (detalles JSON: duración, contentType, etc.)
- `createdAt` (timestamp)

### Eventos en tiempo real (Socket.IO)

Todos los endpoints aplican emisiones via `emitToUser` y `emitToConversation`:
- `user:sanctioned` (forza logout en Flutter)
- `post:pinned` / `post:hidden`
- `report:updated`

## Tests

```bash
npm test           # Ejecuta todos los tests
npm run typecheck  # Compilación TypeScript
```

### Resultados (157/157)
- auth.test.ts — 15 tests
- circles.test.ts — 14 tests
- posts.test.ts — 16 tests
- moderation.test.ts — 38 tests
- admin-validation.test.ts — 22 tests (validación de schemas Zod)

## Convenciones

- **Énfasis en validación:** Zod para request bodies
- **Respuestas:** `{ success: true, data: {...} }` o `{ message: 'error' }` con status HTTP
- **Logs:** Se muestra en panel web admin y puede enviarse por extensión

## Archivos 두드러진特点

- `tsconfig.json`: Estricto + bundling boot
- `next.config.ts`: Permite build folder as `/app` so that Next.js handles routing
- `Dockerfile` + `server.mjs` para producción (render)

## Notas operativas

- Se requiere `node server.mjs` para arrancar (no `npm run start` porque no lo soporta Next.js 16)
- El proyecto puede usar `migrate` (usual) o `db push` (fuerza bruta si es necesario).
- Onboarding page: `/onboarding` (no tests cubiertos por simplicidad).

> **Nota CI/CD:** Para automatizar builds/tests, usar `Render` o `GitHub Actions` con workflow similar a los comandos este fichero.
