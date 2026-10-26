import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('private disk override is local-only, including isolated .localhost hosts', () => {
  const target = new URL('../src/server/private-asset-store.ts', import.meta.url).href;
  for (const [origin, vercel, expected] of [
    ['http://play.localhost:3218', '', 'LocalFirstAssetStore'],
    ['http://localhost:3218', '', 'LocalFirstAssetStore'],
    ['http://play.localhost:3218', '1', 'SupabaseStorageStore'],
    ['https://play.localhost.example.com', '', 'SupabaseStorageStore'],
  ]) {
    const result = execFileSync(
      process.execPath,
      [
        '--conditions=react-server',
        '--experimental-strip-types',
        '--input-type=module',
        '-e',
        `const {createPrivateAssetStore}=await import(${JSON.stringify(target)});console.log(createPrivateAssetStore().constructor.name);`,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          APP_ORIGIN: origin,
          VERCEL: vercel,
          PRIVATE_ASSET_DIR: '/tmp/local-asset-test',
          SUPABASE_URL: 'https://storage.example.com',
          SUPABASE_SECRET_KEY: 'synthetic',
          SUPABASE_SERVICE_ROLE_KEY: '',
          BLOB_READ_WRITE_TOKEN: '',
          BLOB_STORE_ID: '',
        },
      },
    );
    assert.equal(result.trim(), expected);
  }
});
