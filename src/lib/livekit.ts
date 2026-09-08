import { AccessToken } from 'livekit-server-sdk';

/**
 * Configuración de LiveKit Cloud.
 * Las credenciales vienen de `.env` (LIVEKIT_URL / LIVEKIT_API_KEY /
 * LIVEKIT_API_SECRET). Si faltan, `isLiveKitEnabled()` devuelve `false` y los
 * endpoints de voz responden 503 en lugar de reventar.
 */
export function livekitConfig(): { url: string; apiKey: string; apiSecret: string } | null {
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const missing: string[] = [];
  if (!url) missing.push('LIVEKIT_URL');
  if (!apiKey) missing.push('LIVEKIT_API_KEY');
  if (!apiSecret) missing.push('LIVEKIT_API_SECRET');
  if (missing.length > 0) {
    console.error(
      `[livekit] Faltan variables de entorno: ${missing.join(', ')}. ` +
        'El canal de voz responderá 503 hasta configurarlas en .env',
    );
    return null;
  }
  return { url: url!, apiKey: apiKey!, apiSecret: apiSecret! };
}

export function isLiveKitEnabled(): boolean {
  return livekitConfig() !== null;
}

/**
 * Genera un token de acceso para unirse a una sala de voz de LiveKit con
 * permisos completos (publicar y suscribir audio).
 *
 * @param identity - id del usuario (session.userId)
 * @param name - nombre visible del participante
 * @param room - nombre de la sala LiveKit (`sala_<id>` o `dm_<u1>_<u2>`)
 * @param metadata - metadatos JSON extra (avatarUrl, rol, etc.)
 */
export async function createVoiceToken(opts: {
  identity: string;
  name: string;
  room: string;
  metadata?: Record<string, unknown>;
}): Promise<{ token: string; url: string }> {
  const config = livekitConfig();
  if (!config) throw new Error('LiveKit no configurado');

  const at = new AccessToken(config.apiKey, config.apiSecret, {
    identity: opts.identity,
    name: opts.name,
    ttl: '6h',
    metadata: opts.metadata ? JSON.stringify(opts.metadata) : undefined,
  });

  at.addGrant({
    room: opts.room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
  });

  const token = await at.toJwt();
  return { token, url: config.url };
}