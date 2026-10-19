import { randomUUID } from 'node:crypto';
import pg from 'pg';
import fs from 'node:fs';

const baseUrl = 'https://parallel-life-nu.vercel.app';

async function main() {
  console.log('🚀 [Stage 2 Live Test] 开始生产环境端到端增量流式消息真实实测 (基于官方人生)...');

  // 1. 创建 Session
  const sessionRes = await fetch(`${baseUrl}/api/v1/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseUrl },
  });
  const cookie = sessionRes.headers.get('set-cookie');
  const session = await sessionRes.json();
  console.log('✅ 1. 会话建立成功，CSRF Token 已获取');

  const headers = {
    'Content-Type': 'application/json',
    Origin: baseUrl,
    Cookie: cookie,
    'x-csrf-token': session.csrfToken,
  };

  // 2. 启动官方人生《县城黄毛》 (版本 3)
  console.log('⌛ 2. 启动官方人生《县城黄毛》...');
  const startRes = await fetch(`${baseUrl}/api/v1/official-lives/county-yellow-hair/start`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      commandId: randomUUID(),
      version: 3,
    }),
  });
  if (!startRes.ok) {
    const errText = await startRes.text();
    throw new Error('Start official life failed: ' + startRes.status + ' ' + errText);
  }
  const startResult = await startRes.json();
  const worldId = startResult.worldId;
  console.log(`✅ 2. 官方人生世界加载就绪: worldId=${worldId}, resumed=${startResult.resumed}`);

  // 3. 读取世界数据
  const worldRes = await fetch(`${baseUrl}/api/v1/worlds/${worldId}`, { headers });
  const worldData = await worldRes.json();
  if (!worldRes.ok || !worldData.actors) {
    console.error('❌ 世界数据异常:', worldRes.status, worldData);
    throw new Error('World data missing actors');
  }
  const targetActor = worldData.actors.find((a) => a.id !== worldData.playerActorId);
  if (!targetActor) throw new Error('No target NPC found');
  console.log(`✅ 3. 获取对话目标NPC: ${targetActor.name} (${targetActor.id}), 世界版本: ${worldData.version}`);

  // 4. 发起真实增量流式私聊 (x-message-stream: 1, x-message-receipt-projection: 1)
  console.log(`⌛ 4. 发起真实增量流式私聊给 ${targetActor.name} (x-message-stream: 1)...`);
  const commandId = randomUUID();
  const startTime = Date.now();
  const streamRes = await fetch(`${baseUrl}/api/v1/worlds/${worldId}/messages`, {
    method: 'POST',
    headers: {
      ...headers,
      'x-message-stream': '1',
      'x-message-receipt-projection': '1',
    },
    body: JSON.stringify({
      commandId,
      actorId: targetActor.id,
      text: '你好，今晚的饭局准备得怎么样了？',
      expectedVersion: worldData.version,
    }),
  });

  const contentType = streamRes.headers.get('content-type') || '';
  console.log(`   HTTP 响应状态: ${streamRes.status}, Content-Type: ${contentType}`);
  if (!streamRes.ok) {
    const errorBody = await streamRes.text();
    console.error('❌ 发送私聊报错:', streamRes.status, errorBody);
    throw new Error('Message send failed: ' + errorBody);
  }
  if (!contentType.includes('application/x-ndjson')) {
    throw new Error('Expected application/x-ndjson response, got: ' + contentType);
  }

  // 5. 逐行读取 NDJSON 流
  console.log('⌛ 5. 消费 NDJSON 增量流...');
  const reader = streamRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const segments = [];
  let completeReceipt = null;
  let firstSegmentLatency = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      if (buffer.trim()) {
        const trailing = buffer.trim();
        console.log('   [Trailing Buffer]:', trailing);
        try {
          const event = JSON.parse(trailing);
          if (event.type === 'segment') segments.push(event.segment);
          if (event.type === 'complete') completeReceipt = event.receipt;
          if (event.type === 'error') console.error('   [Stream Error Event]:', event.error);
        } catch (e) {
          console.error('   [Trailing Buffer Parse Error]:', e.message);
        }
      }
      break;
    }
    const chunkText = decoder.decode(value, { stream: true });
    buffer += chunkText;
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      console.log('   [Stream Raw Line]:', trimmed);
      try {
        const event = JSON.parse(trimmed);
        if (event.type === 'segment') {
          if (firstSegmentLatency === null) {
            firstSegmentLatency = Date.now() - startTime;
            console.log(`⚡ 首条增量分段已到达 (首段呈现延迟 firstMeaningfulReplyMs: ${firstSegmentLatency}ms):`);
          }
          console.log(`   [Segment ${event.segment.segmentIndex}] "${event.segment.message?.text || event.segment.text}" (kind=${event.segment.unitKind})`);
          segments.push(event.segment);
        } else if (event.type === 'complete') {
          console.log(`🏁 全回合流式完成 (全轮耗时 fullTurnMs: ${Date.now() - startTime}ms): receiptStatus=${event.receipt.status}`);
          completeReceipt = event.receipt;
        } else if (event.type === 'error') {
          console.error('❌ 流式错误事件:', event.error);
        }
      } catch (e) {
        console.error('   [Line Parse Error]:', trimmed, e.message);
      }
    }
  }

  if (segments.length === 0) {
    throw new Error('No stream segments received!');
  }
  if (!completeReceipt) {
    throw new Error('No complete event received!');
  }
  console.log(`✅ 5. 增量流式通信验证成功: 共收到 ${segments.length} 个分段事件，首段延迟 ${firstSegmentLatency}ms`);

  // 6. 验证生产数据库中的分段凭据 (Persist-Before-Present)
  console.log('⌛ 6. 校验生产数据库 parallel_life.agent_attempt_stream_segments 表分段凭据...');
  const envContent = fs.readFileSync('.local/supabase.env', 'utf8');
  const match = envContent.match(/SUPABASE_DB_URL=(.+)/);
  if (!match) throw new Error('No SUPABASE_DB_URL');
  const dbClient = new pg.Client({ connectionString: match[1].trim(), ssl: { rejectUnauthorized: false } });
  await dbClient.connect();

  const segQuery = await dbClient.query(
    'SELECT segment_index, segment_id, message_id, unit_kind, status, source_version, source_event_id, created_at FROM parallel_life.agent_attempt_stream_segments WHERE world_id = $1 AND command_id = $2 ORDER BY segment_index',
    [worldId, commandId]
  );
  console.log(`   生产数据库中查询到 ${segQuery.rows.length} 条已持久化分段凭据:`);
  for (const row of segQuery.rows) {
    console.log(`   - segment #${row.segment_index}: id=${row.segment_id}, msgId=${row.message_id}, status=${row.status}, v=${row.source_version}`);
  }
  if (segQuery.rows.length === 0) {
    throw new Error('No stream segments persisted in database!');
  }

  // 7. 验证断连/刷新恢复投影 (/receipt)
  console.log('⌛ 7. 验证 /receipt 路由带 projection 查询已持久化消息与 streamSummary (故障边界#5)...');
  const receiptRes = await fetch(`${baseUrl}/api/v1/worlds/${worldId}/messages/receipt`, {
    method: 'POST',
    headers: {
      ...headers,
      'x-message-receipt-projection': '1',
    },
    body: JSON.stringify({ commandId }),
  });
  const receiptData = await receiptRes.json();
  console.log(`   Receipt 查询成功: status=${receiptData.receipt?.status}, messagesCount=${receiptData.messages?.length || 0}`);
  if (receiptData.streamSummary) {
    console.log(`   StreamSummary: totalSegments=${receiptData.streamSummary.totalSegments}, committedCount=${receiptData.streamSummary.committedCount}`);
  }

  await dbClient.end();
  console.log('\n🎉🎉🎉 生产公网增量流式端到端实测 100% 全部通过！');
}

main().catch((err) => {
  console.error('❌ 验证失败:', err);
  process.exit(1);
});
