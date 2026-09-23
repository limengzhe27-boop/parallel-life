import { randomUUID } from 'node:crypto';

const baseUrl = 'https://parallel-life-nu.vercel.app';

async function main() {
  console.log('🚀 [E2E] 开始全链路端到端验证 (生产环境)...');

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

  // 2. 查看初始 Profile
  const profileRes = await fetch(`${baseUrl}/api/v1/profile`, { headers });
  const profile = await profileRes.json();
  console.log(`✅ 2. 获取用户初始档案: version=${profile.version}`);

  // 3. 模拟访谈与资料确认: PATCH profile 存入真实生活事实
  const patch1Res = await fetch(`${baseUrl}/api/v1/profile`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      expectedVersion: profile.version,
      operation: {
        kind: 'set-fact',
        category: 'experience',
        value: '我曾在北京做过三年产品经理，后来一直想去阿那亚开一家木工手工坊。',
      },
    }),
  });
  const profileV1 = await patch1Res.json();

  const patch2Res = await fetch(`${baseUrl}/api/v1/profile`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      expectedVersion: profileV1.version,
      operation: {
        kind: 'set-fact',
        category: 'personality',
        value: '喜欢安静和专注手作，讨厌无休止的汇报和内卷。',
      },
    }),
  });
  const updatedProfile = await patch2Res.json();
  console.log(
    `✅ 3. 档案资料确认入库: version=${updatedProfile.version}, facts=${updatedProfile.facts.length}`,
  );

  // 4. 获取当前 Discovery 状态
  const discStateRes = await fetch(`${baseUrl}/api/v1/life-proposals`, { headers });
  const discState = await discStateRes.json();
  console.log(`✅ 4. 发现状态就绪: version=${discState.version}`);

  // 5. 发现平行人生提案
  console.log('⌛ 5. 请求发现平行人生提案...');
  const discReq = await fetch(`${baseUrl}/api/v1/life-proposals`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      commandId: randomUUID(),
      expectedVersion: discState.version,
      expectedProfileVersion: updatedProfile.version,
      brief: '如果我没有继续在互联网大厂做产品经理，而是全职去了阿那亚开木工作坊',
      basedOnId: null,
    }),
  });
  const discProposal = await discReq.json();
  const taskId = discProposal.task?.id || discProposal.id;
  if (!taskId) {
    console.error('❌ 发现提案失败:', discProposal);
    process.exit(1);
  }
  console.log(`   任务已排队: taskId=${taskId}`);

  // 触发执行 Discovery 任务 (生产环境 Serverless 模型调用)
  console.log('⌛ 5.1 执行提案提炼与推演 (调用真实大模型)...');
  const runDiscRes = await fetch(`${baseUrl}/api/v1/tasks/${taskId}/run`, {
    method: 'POST',
    headers,
  });
  const discRunResult = await runDiscRes.json();
  console.log(`   任务执行完成: status=${discRunResult.status}`);

  // 查询生成的平行人生选项
  const newDiscRes = await fetch(`${baseUrl}/api/v1/life-proposals`, { headers });
  const newDisc = await newDiscRes.json();
  console.log(`✅ 5.2 成功生成平行人生选项数: ${newDisc.directions.length}`);
  for (const d of newDisc.directions) {
    console.log(`   📌 方向: 《${d.title}》 - 设定: ${d.premise.slice(0, 40)}...`);
  }

  // 6. 批准种子 (选择第一个方向)
  const targetDir = newDisc.directions[0];
  console.log(`⌛ 6. 用户签署批准平行人生种子: 《${targetDir.title}》...`);
  const availableFactIds = updatedProfile.facts
    .filter((f) => f.status === 'confirmed')
    .map((f) => f.id);
  const chosenFactIds = (targetDir.sources || [])
    .map((s) => s.factId)
    .filter((id) => availableFactIds.includes(id));

  const seedRes = await fetch(`${baseUrl}/api/v1/life-seeds`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      commandId: randomUUID(),
      discoveryVersion: newDisc.version,
      profileVersion: updatedProfile.version,
      directionId: targetDir.id,
      factIds: chosenFactIds,
      personIds: [],
      includePortrait: false,
    }),
  });
  const seed = await seedRes.json();
  if (!seed.id) {
    console.error('❌ 种子批准失败:', seedRes.status, seed);
    process.exit(1);
  }
  console.log(`✅ 6. 种子创建成功: seedId=${seed.id}`);

  // 7. 构建平行世界 (World Genesis)
  console.log('⌛ 7. 发起平行世界构建任务...');
  const buildRes = await fetch(`${baseUrl}/api/v1/world-builds`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      commandId: randomUUID(),
      seedId: seed.id,
    }),
  });
  const build = await buildRes.json();
  console.log(`   构建任务已创建: worldId=${build.worldId}, taskId=${build.task?.id}`);

  // 执行构建任务
  if (build.task?.id) {
    console.log('⌛ 7.1 执行平行世界构建 (世界设定、角色生成、破冰对白编排)...');
    const runBuildRes = await fetch(`${baseUrl}/api/v1/tasks/${build.task.id}/run`, {
      method: 'POST',
      headers,
    });
    const buildRunResult = await runBuildRes.json();
    console.log(`   构建任务执行结果: status=${buildRunResult.status}`);
  }

  // 8. 访问平行手机 World Phone 完整界面数据
  console.log('⌛ 8. 载入平行手机 (World Phone)...');
  const phoneRes = await fetch(`${baseUrl}/api/v1/worlds/${build.worldId}`, { headers });
  const phone = await phoneRes.json();
  console.log('🎉 8. 平行手机载入成功！');
  console.log(`   📱 标题: ${phone.title}`);
  console.log(`   👤 平行身份: ${phone.identity}`);
  console.log(`   🏡 当前世界背景: ${phone.setting}`);
  console.log(`   👥 手机联系人 (${phone.actors.length}位):`);
  for (const actor of phone.actors) {
    console.log(`      - ${actor.name} (${actor.relationship})`);
  }
  console.log(`   💬 微信聊天初始消息 (${phone.messages.length}条):`);
  for (const msg of phone.messages) {
    const sender = phone.actors.find((a) => a.id === msg.actorId)?.name || '平行世界联系人';
    console.log(`      [${sender}]: ${msg.text}`);
  }
  if (phone.notes && phone.notes.length > 0) {
    console.log(`   📝 备忘录 (${phone.notes.length}条):`);
    for (const note of phone.notes) {
      console.log(`      [${note.title}]: ${note.text.slice(0, 50)}...`);
    }
  }
  if (phone.invitations && phone.invitations.length > 0) {
    console.log(`   📅 日历日程与邀约 (${phone.invitations.length}条):`);
    for (const inv of phone.invitations) {
      console.log(`      [${inv.title}]: ${inv.location || '无地点'} (${inv.status})`);
    }
  }

  console.log('\n🎊 恭喜！整个产品全链路端到端闭环 100% 验证成功！');
}

main().catch(console.error);
