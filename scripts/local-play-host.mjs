const loopback = new Set([
  'localhost',
  'play.localhost',
  'qa-chat.localhost',
  '127.0.0.1',
  '[::1]',
]);
/** Preserve each loopback hostname's existing cookie; never redirect an authenticated request. */
export function localPlayOrigin(host, port) {
  if (typeof host !== 'string' || !host) return null;
  try {
    const url = new URL('http://' + host);
    return loopback.has(url.hostname) &&
      url.port === String(port) &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash
      ? url.origin
      : null;
  } catch {
    return null;
  }
}
export function acceptsLocalPlayRequest(host, origin, port) {
  const target = localPlayOrigin(host, port);
  return Boolean(target && (!origin || origin === target));
}
