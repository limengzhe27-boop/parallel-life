import assert from 'node:assert/strict';
import test from 'node:test';
import { githubClaimsAllowed } from '../src/server/github-oidc.ts';
import { runProactiveScheduler } from '../src/modules/world/application/run-proactive-scheduler.ts';

const base = {
  iss: 'https://token.actions.githubusercontent.com',
  aud: 'parallel-world-proactive',
  exp: Math.floor(Date.now() / 1000) + 300,
  repository: 'limengzhe27-boop/parallel-life',
  ref: 'refs/heads/main',
  workflow_ref: '.github/workflows/proactive.yml@refs/heads/main',
};

test('only this repository workflow on main with the proactive audience is accepted', () => {
  assert.equal(githubClaimsAllowed(base), true);
  assert.equal(githubClaimsAllowed({ ...base, repository: 'other/repo' }), false);
  assert.equal(githubClaimsAllowed({ ...base, ref: 'refs/heads/dev' }), false);
  assert.equal(githubClaimsAllowed({ ...base, aud: 'other' }), false);
  assert.equal(githubClaimsAllowed({ ...base, exp: 1 }), false);
  assert.equal(githubClaimsAllowed({ ...base, workflow_ref: undefined }), false);
});

test('proactive tick keeps failures isolated and reports bounded counts', async () => {
  const result = await runProactiveScheduler(
    {
      claimProactive: async () => [
        { ownerId: 'o1', worldId: 'w1' },
        { ownerId: 'o2', worldId: 'w2' },
      ],
    },
    async (ownerId) => {
      if (ownerId === 'o1') return { played: 2 };
      throw Object.assign(Error('X'), { code: 'BUSY' });
    },
  );
  assert.deepEqual(result, { claimed: 2, advanced: 1, messages: 2, failed: 1 });
});
