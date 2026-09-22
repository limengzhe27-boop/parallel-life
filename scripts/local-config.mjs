import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
export const root = path.resolve(import.meta.dirname, '..');
export async function localConfig() {
  const dir = path.join(root, '.local');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'runtime.json');
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const config = {
      port: 55432,
      adminPassword: randomBytes(32).toString('hex'),
      appPassword: randomBytes(32).toString('hex'),
      workerPassword: randomBytes(32).toString('hex'),
      sessionSecret: randomBytes(32).toString('hex'),
    };
    await writeFile(file, JSON.stringify(config), { flag: 'wx', mode: 0o600 });
    return config;
  }
}
export async function writeLocalEnv(config) {
  const file = path.join(root, '.env.local');
  let env = await readFile(file, 'utf8').catch((e) => {
    if (e.code !== 'ENOENT') throw e;
    return '';
  });
  const values = {
    DATABASE_URL: `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_dev`,
    WORKER_DATABASE_URL: `postgresql://pl_worker:${config.workerPassword}@127.0.0.1:${config.port}/parallel_life_dev`,
    SESSION_SECRET: config.sessionSecret,
    APP_ORIGIN: 'http://127.0.0.1:3218',
    PRIVATE_ASSET_DIR: path.join(root, '.local/assets'),
  };
  for (const [key, value] of Object.entries(values))
    if (!new RegExp(`^${key}=.+`, 'm').test(env)) env += `\n${key}=${value}`;
  await writeFile(file, env.trim() + '\n', { mode: 0o600 });
  await mkdir(values.PRIVATE_ASSET_DIR, { recursive: true, mode: 0o700 });
}
