import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('repeated complete photo captions preserve their group within a bounded processing budget', () => {
  // Isolate the CPU budget so a regression cannot stall the test runner or a database transaction.
  const code = `
    import { resolvePhotoReference } from './src/modules/profile/application/person-extraction.ts';
    import { randomUUID } from 'node:crypto';
    const createdAt='2026-10-09T00:00:00.000Z';
    const first={id:randomUUID(),text:'照片',photoAssetId:randomUUID(),createdAt};
    const second={id:randomUUID(),text:'照片',photoAssetId:randomUUID(),createdAt};
    const captions=Array.from({length:35},()=>({id:randomUUID(),text:'第一张是小芳',photoAssetId:null,createdAt}));
    const source={id:randomUUID(),text:'第二张是王大毛',photoAssetId:null,createdAt};
    const result=resolvePhotoReference(source,[first,second,...captions],source.text,'王大毛');
    if(result?.id!==second.id) process.exit(2);
  `;
  assert.doesNotThrow(() =>
    execFileSync(
      process.execPath,
      ['--experimental-strip-types', '--input-type=module', '-e', code],
      { timeout: 2000, stdio: 'pipe' },
    ),
  );
});
