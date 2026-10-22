import { createPublicKey, verify } from 'node:crypto';

const ISSUER = 'https://token.actions.githubusercontent.com';
const REPOSITORY = 'limengzhe27-boop/parallel-life';
const WORKFLOW = '.github/workflows/proactive.yml';
export const PROACTIVE_AUDIENCE = 'parallel-world-proactive';

type Claims = {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  repository?: unknown;
  ref?: unknown;
  workflow_ref?: unknown;
  job_workflow_ref?: unknown;
};

/** Pure predicate so the security boundary can be tested without a signed token. */
export function githubClaimsAllowed(claims: Claims, now = Date.now()): boolean {
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  return (
    claims.iss === ISSUER &&
    audience.includes(PROACTIVE_AUDIENCE) &&
    typeof claims.exp === 'number' &&
    claims.exp * 1000 > now &&
    claims.repository === REPOSITORY &&
    claims.ref === 'refs/heads/main' &&
    (claims.workflow_ref === `${WORKFLOW}@refs/heads/main` ||
      claims.job_workflow_ref === `${WORKFLOW}@refs/heads/main`)
  );
}

type Jwk = { kid?: string; kty?: string; n?: string; e?: string };
let jwksCache: { at: number; keys: Jwk[] } | undefined;

async function githubKeys(): Promise<Jwk[]> {
  if (jwksCache && Date.now() - jwksCache.at < 5 * 60_000) return jwksCache.keys;
  const response = await fetch(`${ISSUER}/.well-known/jwks`);
  if (!response.ok) throw Error('GITHUB_JWKS_UNAVAILABLE');
  const body = (await response.json()) as { keys?: Jwk[] };
  const keys = (body.keys ?? []).filter((key) => key.kty === 'RSA');
  jwksCache = { at: Date.now(), keys };
  return keys;
}

/** Verify a GitHub Actions OIDC JWT without a long-lived shared secret. */
export async function verifyGitHubActionsToken(authorization: string | null): Promise<boolean> {
  if (!authorization?.startsWith('Bearer ')) return false;
  const token = authorization.slice(7);
  const [headerPart, payloadPart, signaturePart] = token.split('.');
  if (!headerPart || !payloadPart || !signaturePart) return false;
  try {
    const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')) as {
      alg?: string;
      kid?: string;
    };
    if (header.alg !== 'RS256' || !header.kid) return false;
    const claims = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as Claims;
    if (!githubClaimsAllowed(claims)) return false;
    const jwk = (await githubKeys()).find((key) => key.kid === header.kid);
    if (!jwk) return false;
    const key = createPublicKey({ key: jwk, format: 'jwk' });
    return verify(
      'RSA-SHA256',
      Buffer.from(`${headerPart}.${payloadPart}`),
      key,
      Buffer.from(signaturePart, 'base64url'),
    );
  } catch {
    return false;
  }
}
