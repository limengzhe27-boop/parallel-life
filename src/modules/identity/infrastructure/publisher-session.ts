import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';

/** Internal publishing identity, separate from guest sessions and world permissions.
 * Configuration is server-owned; an HTTP adapter must never take principals from a request.
 * Request throttling, workspace grants and transaction authority are separate prerequisites.
 */
export type PublisherPermission = 'edit' | 'publish';
export type PublisherPrincipal = {
  id: string;
  username: string;
  displayName: string;
  permissions: PublisherPermission[];
};
export type PublisherPrincipalConfig = PublisherPrincipal & {
  passwordHash: string;
  enabled: boolean;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const usernamePattern = /^[a-z][a-z0-9_-]{2,31}$/;
const hashPattern = /^scrypt-v1\$([0-9a-f]{32})\$([0-9a-f]{128})$/;
const ttlSeconds = 2 * 60 * 60;
const equal = (left: string, right: string) => {
  const a = Buffer.from(left),
    b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
function plain(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.values(Object.getOwnPropertyDescriptors(value)).every((item) => 'value' in item);
}
function onlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return (
    Reflect.ownKeys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}
function dataArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  return (
    keys.length === value.length + 1 &&
    keys.every((key) => {
      if (typeof key !== 'string') return false;
      if (key === 'length') return true;
      const d = descriptors[key];
      return (
        /^(0|[1-9]\d*)$/.test(key) &&
        Number(key) < value.length &&
        !!d &&
        'value' in d &&
        d.enumerable
      );
    })
  );
}
export function parsePublisherPrincipals(raw: unknown): PublisherPrincipalConfig[] {
  if (!dataArray(raw) || raw.length > 20) throw Error('PUBLISHER_CONFIG_INVALID');
  const ids = new Set<string>(),
    names = new Set<string>();
  return raw.map((value) => {
    if (
      !plain(value) ||
      !onlyKeys(value, ['id', 'username', 'displayName', 'permissions', 'passwordHash', 'enabled'])
    )
      throw Error('PUBLISHER_CONFIG_INVALID');
    const { id, username, displayName, passwordHash, enabled, permissions } = value;
    if (
      typeof id !== 'string' ||
      !uuid.test(id) ||
      ids.has(id) ||
      typeof username !== 'string' ||
      !usernamePattern.test(username) ||
      names.has(username) ||
      typeof displayName !== 'string' ||
      !displayName.trim() ||
      displayName.length > 80 ||
      typeof passwordHash !== 'string' ||
      !hashPattern.test(passwordHash) ||
      typeof enabled !== 'boolean' ||
      !dataArray(permissions) ||
      permissions.length < 1 ||
      permissions.length > 2 ||
      new Set(permissions).size !== permissions.length ||
      permissions.some((item) => item !== 'edit' && item !== 'publish')
    )
      throw Error('PUBLISHER_CONFIG_INVALID');
    ids.add(id);
    names.add(username);
    return {
      id,
      username,
      displayName,
      passwordHash,
      enabled,
      permissions: [...permissions] as PublisherPermission[],
    };
  });
}
function derive(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 }, (error, key) => {
      if (error) reject(Error('PUBLISHER_PASSWORD_UNAVAILABLE'));
      else resolve(key);
    });
  });
}
/** Bootstrap helper. The returned verifier belongs only in ignored server configuration. */
export async function hashPublisherPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length < 16 || password.length > 160)
    throw Error('PUBLISHER_PASSWORD_INVALID');
  const salt = randomBytes(16);
  const hash = await derive(password, salt);
  return `scrypt-v1$${salt.toString('hex')}$${hash.toString('hex')}`;
}
type Claims = {
  v: 1;
  subject: string;
  sessionId: string;
  revision: string;
  issued: number;
  expires: number;
};

export class PublisherSessions {
  #secret: string;
  #principals: PublisherPrincipalConfig[];
  constructor(secret: string, rawPrincipals: unknown) {
    if (
      typeof secret !== 'string' ||
      Buffer.byteLength(secret) < 32 ||
      Buffer.byteLength(secret) > 512
    )
      throw Error('PUBLISHER_SESSION_NOT_CONFIGURED');
    this.#secret = secret;
    this.#principals = parsePublisherPrincipals(rawPrincipals);
  }
  private signature(payload: string) {
    return createHmac('sha256', this.#secret)
      .update(`publisher-session:v1:${payload}`)
      .digest('base64url');
  }
  private revision(principal: PublisherPrincipalConfig) {
    return createHash('sha256')
      .update(JSON.stringify({ ...principal, permissions: [...principal.permissions].sort() }))
      .digest('hex');
  }
  private publicPrincipal(principal: PublisherPrincipalConfig): PublisherPrincipal {
    return {
      id: principal.id,
      username: principal.username,
      displayName: principal.displayName,
      permissions: [...principal.permissions],
    };
  }
  async login(username: string, password: string, now = Date.now()) {
    if (
      typeof username !== 'string' ||
      username.length > 32 ||
      typeof password !== 'string' ||
      password.length > 160 ||
      !Number.isFinite(now)
    )
      return null;
    const principal = this.#principals.find((item) => item.username === username && item.enabled);
    // Unknown/disabled users perform the same derivation without revealing the account list.
    const verifier = principal?.passwordHash ?? `scrypt-v1$${'0'.repeat(32)}$${'0'.repeat(128)}`;
    const match = hashPattern.exec(verifier)!;
    const actual = await derive(password, Buffer.from(match[1]!, 'hex'));
    const valid = timingSafeEqual(actual, Buffer.from(match[2]!, 'hex'));
    if (!principal || !valid) return null;
    const issued = Math.floor(now / 1000);
    const claims: Claims = {
      v: 1,
      subject: principal.id,
      sessionId: randomUUID(),
      revision: this.revision(principal),
      issued,
      expires: issued + ttlSeconds,
    };
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return {
      token: `${payload}.${this.signature(payload)}`,
      publisher: this.publicPrincipal(principal),
    };
  }
  verify(token: string, now = Date.now()): PublisherPrincipal | null {
    if (typeof token !== 'string' || token.length > 2048 || !Number.isFinite(now)) return null;
    const match = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(token);
    if (!match || !equal(this.signature(match[1]!), match[2]!)) return null;
    let claims: unknown;
    try {
      claims = JSON.parse(Buffer.from(match[1]!, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (
      !plain(claims) ||
      !onlyKeys(claims, ['v', 'subject', 'sessionId', 'revision', 'issued', 'expires']) ||
      claims.v !== 1 ||
      typeof claims.subject !== 'string' ||
      !uuid.test(claims.subject) ||
      typeof claims.sessionId !== 'string' ||
      !uuid.test(claims.sessionId) ||
      typeof claims.revision !== 'string' ||
      !/^[0-9a-f]{64}$/.test(claims.revision) ||
      !Number.isSafeInteger(claims.issued) ||
      !Number.isSafeInteger(claims.expires)
    )
      return null;
    const issued = claims.issued as number,
      expires = claims.expires as number,
      seconds = Math.floor(now / 1000);
    if (issued > seconds || expires <= seconds || expires - issued !== ttlSeconds) return null;
    const principal = this.#principals.find((item) => item.id === claims.subject && item.enabled);
    if (!principal || !equal(this.revision(principal), claims.revision)) return null;
    return this.publicPrincipal(principal);
  }
  authorize(token: string, permission: PublisherPermission, now = Date.now()) {
    const publisher = this.verify(token, now);
    return publisher?.permissions.includes(permission) ? publisher : null;
  }
  csrf(token: string, now = Date.now()) {
    if (!this.verify(token, now)) return null;
    return createHmac('sha256', this.#secret)
      .update(`publisher-csrf:v1:${token}`)
      .digest('base64url');
  }
  verifyCsrf(token: string, value: string | null, now = Date.now()) {
    const expected = this.csrf(token, now);
    return !!expected && typeof value === 'string' && equal(expected, value);
  }
}

/** Administrative mutations trust exact configured origins, never arbitrary forwarded hosts. */
export function publisherOriginAllowed(
  request: Request,
  trustedOrigins: readonly string[],
): boolean {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = request.headers.get('origin');
  if (!origin || origin.length > 512) return false;
  try {
    const url = new URL(origin);
    if (
      url.origin !== origin ||
      url.username ||
      url.password ||
      (url.protocol !== 'https:' && url.protocol !== 'http:')
    )
      return false;
    return trustedOrigins.includes(origin);
  } catch {
    return false;
  }
}
