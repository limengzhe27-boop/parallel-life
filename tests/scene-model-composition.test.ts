import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

/** Exercise actual server factories with a fake transport; no provider or database is contacted. */
function serverProbe(body: string) {
  const run = spawnSync(
    process.execPath,
    ['--conditions=react-server', '--experimental-strip-types', '--input-type=module', '-e', body],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        YIBU_API_KEY: 'fixture-key',
        YIBU_BASE_URL: 'https://yibuapi.com',
        YIBU_TEXT_MODEL: 'gpt-4o-mini',
        YIBU_PREPARATION_MODEL: 'gpt-4.1-mini',
        YIBU_SCENE_MODEL: '',
      },
      encoding: 'utf8',
      timeout: 15000,
    },
  );
  assert.equal(run.status, 0, run.stderr);
}
test('scene-only model selection preserves credentials, global chat, preparation and fallback', () => {
  serverProbe(`
    import assert from 'node:assert/strict';
    import {sceneGatewayConfig} from './src/server/scene-model-config.ts';
    import {gatewayConfig} from './src/server/config.ts';
    import {createSceneTextModel,createTextModel,createManuscriptTextModel} from './src/server/composition.ts';
    const requested=[];
    globalThis.fetch=async(url,init)=>{
      assert.equal(url,'https://yibuapi.com/v1/chat/completions');
      requested.push(JSON.parse(init.body).model);
      return new Response(JSON.stringify({choices:[{message:{content:'{}'},finish_reason:'stop'}]}),{status:200});
    };
    const base=gatewayConfig();
    assert.deepEqual(sceneGatewayConfig(),base);
    delete process.env.YIBU_SCENE_MODEL;
    assert.deepEqual(sceneGatewayConfig(),base);
    process.env.YIBU_SCENE_MODEL='   ';
    assert.deepEqual(sceneGatewayConfig(),base);
    process.env.YIBU_SCENE_MODEL='  gpt-4.1  ';
    assert.deepEqual(sceneGatewayConfig(),{...base,model:'gpt-4.1'});
    assert.deepEqual(gatewayConfig(),base);
    for(const model of [createSceneTextModel(),createTextModel(),createManuscriptTextModel()]) await model.complete([{role:'user',content:'fixture'}]);
    assert.deepEqual(requested,['gpt-4.1','gpt-4o-mini','gpt-4.1-mini']);
    process.env.YIBU_SCENE_MODEL='fixture-secret/invalid';
    assert.throws(()=>createSceneTextModel(),error=>error.message==='SCENE_MODEL_NOT_CONFIGURED');
    assert.equal(requested.length,3);
    process.env.YIBU_SCENE_MODEL='gpt-4.1';
    process.env.YIBU_BASE_URL='https://unexpected.invalid';
    assert.throws(()=>createSceneTextModel(),error=>error.code==='INVALID_CONFIG');
    assert.equal(requested.length,3);
  `);
});
test('scene config and factories remain unavailable to a client/default condition import', () => {
  const run = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--input-type=module',
      '-e',
      "await import('./src/server/scene-model-config.ts')",
    ],
    { cwd: process.cwd(), encoding: 'utf8', timeout: 15000 },
  );
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /cannot be imported from a Client Component/);
});
test('scene selection cannot bypass the worker database-role guard or start model calls during assembly', () => {
  serverProbe(`
    import assert from 'node:assert/strict';
    import {createWorker} from './src/server/worker-composition.ts';
    let requests=0;
    globalThis.fetch=async()=>{requests++;throw Error('Unexpected provider access');};
    process.env.YIBU_SCENE_MODEL='gpt-4.1';
    process.env.WORKER_DATABASE_URL='postgresql://pl_app:fixture@127.0.0.1:55487/parallel_life_test';
    assert.throws(()=>createWorker(),/WORKER_NOT_CONFIGURED/);
    process.env.WORKER_DATABASE_URL='postgresql://pl_worker:fixture@127.0.0.1:55487/parallel_life_test';
    process.env.YIBU_SCENE_MODEL='invalid/scene-model';
    const worker=createWorker();
    assert.equal(typeof worker.handlers.world,'function');
    assert.equal(requests,0);
    await assert.rejects(worker.handlers.world({kind:'world',input:{type:'scene'}},new AbortController().signal),/SCENE_MODEL_NOT_CONFIGURED/);
    assert.equal(requests,0);
    await worker.queue.close();
  `);
});
