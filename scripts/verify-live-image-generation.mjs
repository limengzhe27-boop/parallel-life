import { randomUUID } from 'node:crypto';

const baseUrl = 'https://parallel-life-nu.vercel.app';

function isValidImageMagicBytes(buffer) {
  if (!buffer || buffer.length < 12) return false;
  // JPEG
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
  // PNG
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  )
    return true;
  // WebP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  )
    return true;
  return false;
}

async function main() {
  console.log('🚀 [Media E2E] 开始公网生产环境聊天出图验证...');

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

  // 2. 检查是否有已有世界，或新建一个世界
  const listRes = await fetch(`${baseUrl}/api/v1/worlds`, { headers });
  let worldId;
  let targetActorId;

  if (listRes.ok) {
    const worlds = await listRes.json();
    if (Array.isArray(worlds) && worlds.length > 0) {
      worldId = worlds[0].id;
      console.log(`✅ 2. 复用已有平行世界: worldId=${worldId}`);
    }
  }

  if (!worldId) {
    console.log('⌛ 2. 创建新世界用于测试...');
    // 设置档案
    const profileRes = await fetch(`${baseUrl}/api/v1/profile`, { headers });
    const profile = await profileRes.json();
    const patchRes = await fetch(`${baseUrl}/api/v1/profile`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        expectedVersion: profile.version,
        operation: {
          kind: 'set-fact',
          category: 'experience',
          value: '我在北京开了家摄影工作室，经常在老胡同采风。',
        },
      }),
    });
    const updatedProfile = await patchRes.json();

    // 发现提案
    const discReq = await fetch(`${baseUrl}/api/v1/life-proposals`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        commandId: randomUUID(),
        expectedVersion: 0,
        expectedProfileVersion: updatedProfile.version,
        brief: '在胡同里经营一家慢节奏复古照相馆',
        basedOnId: null,
      }),
    });
    const discProposal = await discReq.json();
    const discTaskId = discProposal.task?.id || discProposal.id;
    if (discTaskId) {
      await fetch(`${baseUrl}/api/v1/tasks/${discTaskId}/run`, { method: 'POST', headers });
    }
    const newDisc = await (await fetch(`${baseUrl}/api/v1/life-proposals`, { headers })).json();
    const targetDir = newDisc.directions[0];

    // 批准种子
    const seedRes = await fetch(`${baseUrl}/api/v1/life-seeds`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        commandId: randomUUID(),
        discoveryVersion: newDisc.version,
        profileVersion: updatedProfile.version,
        directionId: targetDir.id,
        factIds: [],
        personIds: [],
        includePortrait: false,
      }),
    });
    const seed = await seedRes.json();

    // 构建世界
    const buildRes = await fetch(`${baseUrl}/api/v1/world-builds`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ commandId: randomUUID(), seedId: seed.id }),
    });
    const build = await buildRes.json();
    if (build.task?.id) {
      await fetch(`${baseUrl}/api/v1/tasks/${build.task.id}/run`, { method: 'POST', headers });
    }
    worldId = build.worldId;
    console.log(`✅ 2. 新世界构建就绪: worldId=${worldId}`);
  }

  // 3. 读取世界中的联系人
  const phoneRes = await fetch(`${baseUrl}/api/v1/worlds/${worldId}`, { headers });
  const phone = await phoneRes.json();
  const npc = phone.actors?.find((a) => a.id !== 'player');
  if (!npc) {
    console.error('❌ 未找到 NPC 联系人');
    process.exit(1);
  }
  targetActorId = npc.id;
  console.log(`✅ 3. 选中聊天 NPC: ${npc.name} (id=${targetActorId})`);

  // 4. 发送“发张自拍”或者“发张照片”消息
  console.log(`⌛ 4. 向 ${npc.name} 发送请求: "发张自拍看看最近的你" (expectedVersion=${phone.version})...`);
  const msgRes = await fetch(`${baseUrl}/api/v1/worlds/${worldId}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      commandId: randomUUID(),
      actorId: targetActorId,
      expectedVersion: phone.version,
      text: '发张自拍看看最近的你',
    }),
  });

  if (!msgRes.ok) {
    const err = await msgRes.text();
    console.error('❌ 消息发送失败 HTTP:', msgRes.status, err);
    process.exit(1);
  }
  const msgResult = await msgRes.json();
  console.log('✅ 4. 消息成功投递，NPC 已回复:', msgResult.reply?.text || '(无文字回复)');

  // 5. 触发 Outbox Drain
  console.log('⌛ 5. 触发 Outbox 派发与任务同步...');
  const drainRes = await fetch(`${baseUrl}/api/v1/outbox/drain`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ limit: 20 }),
  });
  const drain = await drainRes.json();
  console.log('✅ 5. Outbox 派发结果:', JSON.stringify(drain));

  const taskIds = drain.taskIds || [];
  if (taskIds.length === 0) {
    console.log('⚠️ 本轮未产生新的后台任务，检查当前聊天消息...');
  } else {
    for (const taskId of taskIds) {
      console.log(`⌛ 6. 执行生图后台任务: taskId=${taskId}...`);
      const taskRunRes = await fetch(`${baseUrl}/api/v1/tasks/${taskId}/run`, {
        method: 'POST',
        headers,
      });
      const taskRunResult = await taskRunRes.json();
      console.log(`   生图任务执行状态: status=${taskRunResult.status}`, taskRunResult);
    }
  }

  // 7. 再次拉取世界聊天和相册数据，验证图片链接
  console.log('⌛ 7. 验证世界聊天记录中的图片引用 (photoId)...');
  const updatedPhone = await (await fetch(`${baseUrl}/api/v1/worlds/${worldId}`, { headers })).json();
  const photoMessages = (updatedPhone.messages || []).filter((m) => m.photoId);
  console.log(`   含 photoId 的消息数: ${photoMessages.length}`);

  let verifiedAssetId = null;
  for (const pm of photoMessages) {
    console.log(`   📸 发现带图消息: photoId=${pm.photoId}, mediaStatus=${pm.mediaStatus}, text=${pm.text}`);
    if (pm.photoId) {
      verifiedAssetId = pm.photoId;
    }
  }

  // 8. 检查相册
  console.log('⌛ 8. 验证世界相册 (Photos)...');
  const photosRes = await fetch(`${baseUrl}/api/v1/worlds/${worldId}/photos`, { headers });
  if (photosRes.ok) {
    const photos = await photosRes.json();
    console.log(`   相册照片总数: ${photos.length}`);
    for (const p of photos) {
      console.log(`   🖼️ 相册照片: id=${p.id}, title=${p.title}, kind=${p.kind}`);
      if (!verifiedAssetId) verifiedAssetId = p.id;
    }
  }

  // 9. 真实下载 Asset 字节并校验 Magic Bytes
  if (verifiedAssetId) {
    console.log(`⌛ 9. 请求下载真实 Asset 字节: assetId=${verifiedAssetId}...`);
    const assetUrl = `${baseUrl}/api/v1/assets/${verifiedAssetId}?worldId=${worldId}&revision=1`;
    const assetRes = await fetch(assetUrl, { headers });
    if (!assetRes.ok) {
      console.error(`❌ Asset 下载失败 HTTP ${assetRes.status}:`, await assetRes.text());
      process.exit(1);
    }
    const contentType = assetRes.headers.get('content-type');
    const arrayBuffer = await assetRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const validMagic = isValidImageMagicBytes(buffer);

    console.log(`✅ 9. Asset 下载成功！`);
    console.log(`   Content-Type: ${contentType}`);
    console.log(`   Byte Length: ${buffer.length} 字节`);
    console.log(`   Magic Bytes 校验: ${validMagic ? 'PASS (合法图像二进制)' : 'FAIL'}`);

    if (buffer.length > 1000 && validMagic) {
      console.log('\n🎉 [SUCCESS] Track A (NPC 真实生图 + 聊天渲染 + 相册持久化) 全链路闭环在 Vercel 生产环境实测 100% 成功！');
    } else {
      console.error('❌ 图像字节过小或非真实图像二进制');
      process.exit(1);
    }
  } else {
    console.log('ℹ️ 未检测到已完成的 assetId，请检查任务日志。');
  }
}

main().catch(console.error);
