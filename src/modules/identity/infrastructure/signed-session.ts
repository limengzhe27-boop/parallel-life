import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
export class SignedSession {
  private secret: string;
  constructor(secret: string) {
    if (secret.length < 32) throw Error('SESSION_NOT_CONFIGURED');
    this.secret = secret;
  }
  private sign(value: string) {
    return createHmac('sha256', this.secret).update(value).digest('base64url');
  }
  issue(now = Date.now()) {
    const userId = randomUUID();
    const payload = `${userId}.${Math.floor(now / 1000) + 30 * 86400}`;
    return { userId, token: `${payload}.${this.sign('session:' + payload)}` };
  }
  verify(token: string, now = Date.now()): string | null {
    if (token.length > 256) return null;
    const match = /^([0-9a-f-]{36})\.(\d{10,12})\.([\w-]{43})$/.exec(token);
    if (!match) return null;
    const [, id, expires, signature] = match;
    if (!id || !expires || !signature) return null;
    if (
      Number(expires) <= Math.floor(now / 1000) ||
      Number(expires) > Math.floor(now / 1000) + 31 * 86400
    )
      return null;
    const expected = this.sign(`session:${id}.${expires}`);
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature)) ? id : null;
  }
  csrf(token: string) {
    return this.sign('csrf:' + token);
  }
  verifyCsrf(token: string, value: string | null) {
    const expected = this.csrf(token);
    return (
      !!value &&
      value.length === expected.length &&
      timingSafeEqual(Buffer.from(value), Buffer.from(expected))
    );
  }
}
export function sameOrigin(request: Request, origin: string) {
  return (
    request.headers.get('origin') === origin &&
    request.headers.get('sec-fetch-site') !== 'cross-site'
  );
}
