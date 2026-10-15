import { createHmac } from 'node:crypto';
import { Id } from '../contracts/api.ts';
/** Called only after the staff trial binding supplies this existing private owner. Never accepts a request owner. */
export function trialOwnerToken(ownerId: string, secret: string, now = Date.now()) {
  Id.parse(ownerId);
  if (secret.length < 32) throw Error('SESSION_NOT_CONFIGURED');
  const payload = ownerId + '.' + (Math.floor(now / 1000) + 7200);
  return (
    payload +
    '.' +
    createHmac('sha256', secret)
      .update('session:' + payload)
      .digest('base64url')
  );
}

/** Exact route/method allowlist follows the existing world API; no director, profile or upload access. */
export function trialProxyTarget(
  path: readonly string[],
  method: string,
  worldId: string,
  query: URLSearchParams,
) {
  if (!Id.safeParse(worldId).success) return null;
  const suffix = path.slice(1).join('/');
  let target: string, taskId: string | undefined;
  const uuid = '[0-9a-f-]{36}';
  const routes: Array<[RegExp, string[]]> = [
    [/^(?:|clock|records|space|scenes|groups|story|social|opening)$/, ['GET']],
    [
      /^(?:opening|notes|messages|messages\/receipt|invitations|space\/establish|space\/travel|space\/receipt|space\/enter|scenes|groups)$/,
      ['POST'],
    ],
    [/^(?:story\/advance|invitations\/wait|clock\/activity|clock\/wait)$/, ['POST']],
    [/^scenes\/history$/, ['GET']],
    [new RegExp('^scenes/' + uuid + '$'), ['GET']],
    [new RegExp('^scenes/' + uuid + '/(?:actions|view|leave)$'), ['POST']],
    [new RegExp('^groups/' + uuid + '$'), ['GET', 'PATCH']],
    [new RegExp('^groups/' + uuid + '/messages$'), ['POST', 'PUT']],
    [new RegExp('^groups/' + uuid + '/members$'), ['POST']],
  ];
  if (
    path[0] === 'world' &&
    routes.some(([re, methods]) => re.test(suffix) && methods.includes(method))
  )
    target = '/api/v1/worlds/' + worldId + (suffix ? '/' + suffix : '');
  else if (
    path[0] === 'tasks' &&
    Id.safeParse(path[1]).success &&
    ((path.length === 2 && method === 'GET') ||
      (path.length === 3 && ['run', 'retry', 'cancel'].includes(path[2]!) && method === 'POST'))
  ) {
    taskId = path[1];
    target = '/api/v1/tasks/' + taskId + (path[2] ? '/' + path[2] : '');
  } else return null;
  const entries = [...query.entries()];
  if (entries.length) {
    if (
      path.join('/') !== 'world/scenes/history' ||
      method !== 'GET' ||
      entries.length !== 1 ||
      entries[0]![0] !== 'before' ||
      !/^\d+$/.test(entries[0]![1]) ||
      !Number.isSafeInteger(Number(entries[0]![1]))
    )
      return null;
    target += '?before=' + encodeURIComponent(entries[0]![1]);
  }
  return {
    target,
    taskId,
    body:
      method === 'GET' || (taskId && ['run', 'cancel'].includes(path[2]!))
        ? ('none' as const)
        : ('json' as const),
  };
}
