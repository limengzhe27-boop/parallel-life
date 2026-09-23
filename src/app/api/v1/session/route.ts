import { getServices } from '../../../../server/services.ts';
import { endpoint, HttpError, json, readToken } from '../../../../server/http.ts';
import { sessionOriginAllowed } from '../../../../server/composition.ts';
export const runtime = 'nodejs';
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
    const response = json({ kind: 'guest', csrfToken: svc.sessions.csrf(token) });
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
