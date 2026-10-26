// Local production runner. Credentials stay in the ignored JSON file, never in arguments/logs.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { acceptsLocalPlayRequest } from './local-play-host.mjs';
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
};
const port = Number(option('--port', '3218'));
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('LOCAL_PORT_REQUIRED');
let env;
try {
  env = JSON.parse(await readFile(option('--env', '.local/local-play/env.json'), 'utf8'));
} catch {
  throw Error('LOCAL_RUNTIME_CONFIG_UNREADABLE');
}
const base = new URL(env.APP_ORIGIN || 'http://localhost:' + port);
if (!['localhost', 'play.localhost', '127.0.0.1', '[::1]'].includes(base.hostname))
  throw Error('LOCAL_ORIGIN_REQUIRED');
base.port = String(port);
env.APP_ORIGIN = base.origin;
Object.assign(process.env, env);
const { default: next } = await import('next');
const app = next({
  dev: false,
  dir: path.resolve(option('--dir', '.')),
  hostname: base.hostname,
  port,
});
await app.prepare();
// Next may load a parent .env.local. Explicit runtime configuration remains authoritative.
Object.assign(process.env, env);
const handle = app.getRequestHandler();
const server = createServer((req, res) => {
  if (!acceptsLocalPlayRequest(req.headers.host, req.headers.origin, port)) {
    res.writeHead(403, { 'Cache-Control': 'no-store' });
    res.end();
    return;
  }
  const started = Date.now();
  res.on('finish', () => {
    if (req.url?.startsWith('/api/'))
      console.log(
        JSON.stringify({
          scope: 'local-http',
          method: req.method,
          path: req.url.split('?')[0],
          status: res.statusCode,
          ms: Date.now() - started,
        }),
      );
  });
  handle(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});
server.listen(port, '127.0.0.1', () =>
  console.log(`Local service ready: http://localhost:${port}`),
);
process.on('SIGTERM', () => server.close(() => process.exit(0)));
