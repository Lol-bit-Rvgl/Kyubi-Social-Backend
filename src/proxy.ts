import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS ?? '*')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const allowAll = ALLOWED_ORIGINS.includes('*');

function setCorsHeaders(response: NextResponse, origin: string) {
  if (allowAll) {
    response.headers.set('Access-Control-Allow-Origin', '*');
  } else if (ALLOWED_ORIGINS.includes(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Vary', 'Origin');
  }
  response.headers.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  response.headers.set('Access-Control-Max-Age', '86400');
}

export function proxy(request: NextRequest) {
  const origin = request.headers.get('origin') ?? '';

  if (request.method === 'OPTIONS') {
    const response = new NextResponse(null, { status: 204 });
    setCorsHeaders(response, origin);
    return response;
  }

  const response = NextResponse.next();
  setCorsHeaders(response, origin);
  return response;
}

export const config = {
  matcher: [
    '/api/:path*',
    '/users/:path*',
    '/posts/:path*',
    '/wall/:path*',
    '/upload/:path*',
    '/auth/:path*',
    '/circles/:path*',
    '/search/:path*',
    '/stories/:path*',
    '/messages/:path*',
    '/notifications/:path*',
    '/rooms/:path*',
    '/chats/:path*',
  ],
};
