import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

export const ok = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const fail = (message: string, status = 400) => NextResponse.json({ message }, { status });

/**
 * Request tracking: reutiliza `x-request-id` entrante (inyectado por un proxy
 * de confianza) o genera uno nuevo. Viaja de vuelta al cliente en la cabecera
 * `x-request-id` de TODAS las respuestas JSON y se incluye en los logs de
 * error 500 para poder rastrear el incidente sin filtrar detalles internos.
 */
export function getRequestId(request: unknown): string {
  if (request instanceof Request) {
    return request.headers.get('x-request-id') || randomUUID();
  }
  return randomUUID();
}

function setRequestIdHeader(response: Response, requestId: string): Response {
  try {
    response.headers.set('x-request-id', requestId);
  } catch {
    // Algunas Response inmutables no permiten mutar cabeceras: no es fatal.
  }
  return response;
}

export function errorResponse(error: unknown, requestId?: string, request?: unknown): Response {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return fail('Conflicto de datos: el valor ya existe', 409);
    if (error.code === 'P2025') return fail('Recurso no encontrado', 404);
    if (error.code === 'P2003') return fail('Operación inválida', 400);
    if (error.code === 'P1001' || error.code === 'P1017') {
      console.error('[api] prisma connection error:', error.code, error.message);
      return fail('Servicio de base de datos no disponible', 503);
    }
  }
  if (error instanceof Prisma.PrismaClientValidationError) {
    return fail('Datos inválidos', 400);
  }
  if (error instanceof Prisma.PrismaClientRustPanicError) {
    console.error('[api] prisma rust panic:', error.message);
    return fail('Error interno del servidor', 500);
  }
  if (error instanceof ZodError) {
    const issues =
      process.env.NODE_ENV === 'production'
        ? undefined
        : error.issues.map((i) => ({ path: i.path, message: i.message }));
    return NextResponse.json(issues ? { message: 'Datos inválidos', issues } : { message: 'Datos inválidos' }, { status: 400 });
  }
  // 500 no controlado: log con formato rastreable, respuesta sin stacktrace.
  const req = request instanceof Request ? request : null;
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    `[ERROR] [requestId: ${requestId ?? 'unknown'}] [${req?.method ?? '?'} ${req?.url ?? '?'}]: ${message}`,
  );
  return NextResponse.json(
    { error: 'Internal Server Error', ...(requestId ? { requestId } : {}) },
    { status: 500 },
  );
}

export function withErrorHandling<Args extends unknown[], R extends Response | Promise<Response>>(
  handler: (...args: Args) => R
): (...args: Args) => Promise<Awaited<R>> {
  return async (...args: Args): Promise<Awaited<R>> => {
    const requestId = getRequestId(args[0]);
    try {
      const response = await handler(...args);
      return setRequestIdHeader(response, requestId) as Awaited<R>;
    } catch (error) {
      return errorResponse(error, requestId, args[0]) as Awaited<R>;
    }
  };
}
