import { NextResponse } from 'next/server';
import { getServices } from '../../../../../server/services.ts';
import { readToken } from '../../../../../server/http.ts';

export const runtime = 'nodejs';

/** Owner-only handoff: returns a temporary link that sets the same session on a new origin. */
export async function GET(request: Request) {
  const svc = getServices();
  const ownerId = svc.sessions.verify(readToken(request));
  if (!ownerId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const issued = svc.sessions.issue(ownerId);
  const url = new URL('/api/v1/session/claim', request.url);
  url.searchParams.set('token', issued.token);
  return NextResponse.json({ url: url.toString() });
}
