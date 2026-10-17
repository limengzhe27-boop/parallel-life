import { getServices } from '../../../../../server/services.ts';
import { endpoint, HttpError, json, parseBody, readToken } from '../../../../../server/http.ts';
import { sessionOriginAllowed } from '../../../../../server/composition.ts';
import { LoginRequestSchema } from '../../../../../contracts/auth.ts';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  return endpoint(async () => {
    const svc = getServices();
    if (!sessionOriginAllowed(request, svc.origin)) throw new HttpError('UNAUTHORIZED', 401);

    const body = await parseBody(request, LoginRequestSchema);
    const token = readToken(request);
    const existingUserId = token ? svc.sessions.verify(token) : null;
    const isExistingValid = existingUserId ? await svc.identity.exists(existingUserId) : false;
    const currentGuestId = isExistingValid ? existingUserId : null;

    const result = await svc.identity.loginAccount({
      identifier: body.identifier,
      password: body.password,
      currentGuestId,
      mergeGuest: body.mergeGuest,
    });

    const issued = svc.sessions.issue(result.accountId);
    const response = json(
      {
        accountId: result.accountId,
        identifier: result.identifier,
        kind: 'account',
        mergedGuest: result.mergedGuest,
        csrfToken: svc.sessions.csrf(issued.token),
      },
      200,
    );

    response.cookies.set('pl_session', issued.token, {
      httpOnly: true,
      secure: svc.origin.startsWith('https:'),
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 86400,
    });

    return response;
  });
}
