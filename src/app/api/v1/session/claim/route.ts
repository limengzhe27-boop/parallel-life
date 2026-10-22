import { NextResponse } from 'next/server';
import { getServices } from '../../../../../server/services.ts';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const svc = getServices();
  const token = new URL(request.url).searchParams.get('token') ?? '';
  const ownerId = svc.sessions.verify(token);
  if (!ownerId) return NextResponse.redirect(new URL('/?session=invalid', request.url));
  const response = NextResponse.redirect(new URL('/', request.url));
  response.cookies.set('pl_session', token, {
    httpOnly: true,
    secure: new URL(request.url).protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 86400,
  });
  return response;
}
