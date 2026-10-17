import { getServices } from '../../../../server/services.ts';
import { endpoint, HttpError, json, readToken } from '../../../../server/http.ts';
import { sessionOriginAllowed } from '../../../../server/composition.ts';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  return endpoint(async () => {
    const svc = getServices();
    const token = readToken(request);
    const ownerId = svc.sessions.verify(token);
    if (!ownerId || !(await svc.identity.exists(ownerId))) {
      return json(
        {
          authenticated: false,
          kind: 'guest',
          userId: null,
          identifier: null,
          csrfToken: null,
        },
        200,
      );
    }
    const info = await svc.identity.getAccountInfo(ownerId);
    return json(
      {
        authenticated: true,
        kind: info?.kind ?? 'guest',
        userId: ownerId,
        identifier: info?.identifier ?? null,
        csrfToken: svc.sessions.csrf(token),
      },
      200,
    );
  });
}

export async function POST(request: Request) {
  return endpoint(async () => {
    const svc = getServices();
    if (!sessionOriginAllowed(request, svc.origin)) throw new HttpError('UNAUTHORIZED', 401);
    let token = readToken(request),
      ownerId = svc.sessions.verify(token);
    if (!ownerId || !(await svc.identity.exists(ownerId))) {
      /* Limit per caller so one caller cannot spend the whole guest allowance. */
      if (!(await svc.reserveGuestCreation(request.headers)))
        throw new HttpError('RATE_LIMITED', 429);
      const issued = svc.sessions.issue();
      token = issued.token;
      ownerId = issued.userId;
      await svc.identity.ensureGuest(ownerId);
    }
    const info = await svc.identity.getAccountInfo(ownerId);
    const kind = info?.kind ?? 'guest';
    const response = json({ kind, csrfToken: svc.sessions.csrf(token) });
    response.cookies.set('pl_session', token, {
      httpOnly: true,
      secure: svc.origin.startsWith('https:'),
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 86400,
    });
    return response;
  });
}

export async function DELETE(request: Request) {
  return endpoint(async () => {
    const svc = getServices();
    if (!sessionOriginAllowed(request, svc.origin)) throw new HttpError('UNAUTHORIZED', 401);
    const response = json({ status: 'cleared' }, 200);
    response.cookies.set('pl_session', '', {
      httpOnly: true,
      secure: svc.origin.startsWith('https:'),
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
    return response;
  });
}
