import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { YibuTextModel } from '../src/modules/ai/infrastructure/yibu-text-model.ts';

test('explicit effort reaches complete and stream without adding retries or changing defaults', async () => {
  const bodies: Record<string, unknown>[] = [];
  const request: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init!.body));
    bodies.push(body);
    return body.stream
      ? new Response(
          'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: [DONE]\n\n',
        )
      : Response.json({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] });
  };
  const config = {
    apiKey: 'fixture',
    baseUrl: 'https://yibuapi.com',
    model: 'grok-4.3',
    timeoutMs: 5000,
  };
  const fast = new YibuTextModel({ ...config, reasoningEffort: 'none' }, request);
  assert.equal(await fast.complete([{ role: 'user', content: 'fixture' }]), 'ok');
  let text = '';
  for await (const c of fast.streamComplete([{ role: 'user', content: 'fixture' }])) text += c;
  assert.equal(text, 'ok');
  await new YibuTextModel(config, request).complete([{ role: 'user', content: 'fixture' }]);
  assert.equal(bodies.length, 3);
  assert.deepEqual(
    bodies.map((b) => b.reasoning_effort),
    ['none', 'none', undefined],
  );
  assert.throws(
    () => new YibuTextModel({ ...config, reasoningEffort: 'invalid' as 'none' }, request),
    { code: 'INVALID_CONFIG' },
  );
  assert.equal(bodies.length, 3);
});

test('fast NPC and scene selection leave director, base and authoring model parameters intact', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--conditions=react-server',
      '--experimental-strip-types',
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';
    import {createTextModel,createSceneTextModel,createManuscriptTextModel} from './src/server/composition.ts';
    const seen=[];
    globalThis.fetch=async(_url,init)=>{seen.push(JSON.parse(init.body));return Response.json({choices:[{message:{content:'{}'},finish_reason:'stop'}]});};
    const schema=name=>({format:'json_schema',name,strict:true,schema:{type:'object',properties:{},additionalProperties:false}});
    const m=createTextModel(),messages=[{role:'user',content:'fixture'}];
    await m.complete(messages,undefined,512,schema('npc_agent_response'));
    await m.complete(messages,undefined,512,schema('director_response_v1'));
    await m.complete(messages);
    await createSceneTextModel().complete(messages);
    await createManuscriptTextModel().complete(messages);
    assert.deepEqual(seen.map(x=>[x.model,x.reasoning_effort]),[['grok-4.7','none'],['grok-4.7',undefined],['grok-4.7',undefined],['grok-4.3','none'],['fixture-preparation',undefined]]);
  `,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 15000,
      env: {
        ...process.env,
        YIBU_API_KEY: 'fixture',
        YIBU_BASE_URL: 'https://yibuapi.com',
        YIBU_TEXT_MODEL: 'grok-4.7',
        YIBU_NPC_MODEL: 'grok-4.7',
        YIBU_DIRECTOR_MODEL: 'grok-4.7',
        YIBU_SCENE_MODEL: 'grok-4.3',
        YIBU_PREPARATION_MODEL: 'fixture-preparation',
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
});
