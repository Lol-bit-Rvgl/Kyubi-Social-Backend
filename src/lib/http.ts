import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

export const ok = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const fail = (message: string, status = 400) => NextResponse.json({ message }, { status });

export function errorResponse(error: unknown): Response {
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
    return NextResponse.json({ message: 'Datos inválidos', issues: error.issues }, { status: 400 });
  }
  console.error('[api] error:', error);
  return fail('Error interno del servidor', 500);
}

export function withErrorHandling<Args extends unknown[], R extends Response | Promise<Response>>(
  handler: (...args: Args) => R
): (...args: Args) => Promise<Awaited<R>> {
  return async (...args: Args): Promise<Awaited<R>> => {
    try {
      return await handler(...args);
    } catch (error) {
      return errorResponse(error) as Awaited<R>;
    }
  };
}
