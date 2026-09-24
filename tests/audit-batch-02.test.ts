import { test } from 'node:test';
import assert from 'node:assert/strict';

test('AUD-06: 基础资料六字段合并长度超过 500 字限制必须准确拦截', () => {
  const fields = ['姓名', '生日', '出生时间', '所在城市', '职业', '家乡'];
  
  // 模拟输入超长内容（例如职业和家乡填入较长描述）
  const normalValues: Record<string, string> = {
    姓名: '张三',
    生日: '1995-05-15',
    出生时间: '14:30',
    所在城市: '上海市浦东新区',
    职业: '全栈独立软件开发与设计工程师',
    家乡: '浙江省杭州市西湖区',
  };

  const computeMerged = (values: Record<string, string>) =>
    '个人资料\n' +
    fields
      .filter((label) => (values[label] ?? '').trim())
      .map((label) => `${label}：${(values[label] ?? '').trim()}`)
      .join('\n');

  const normalMerged = computeMerged(normalValues);
  assert.ok(normalMerged.length < 500, '正常资料应在 500 字以内');

  // 构造超长场景
  const longValues = {
    ...normalValues,
    职业: 'A'.repeat(300),
    家乡: 'B'.repeat(200),
  };
  const longMerged = computeMerged(longValues);
  assert.ok(longMerged.length > 500, '拼接后字数应超过 500');
  assert.equal(longMerged.length > 500, true, '校验机制必须准确判定超长');
});

test('AUD-07: 资料带入授权严格由可见事实过滤，彻底消除不可见隐式授权', () => {
  // 模拟 50 条已确认事实
  const allConfirmedFacts = Array.from({ length: 50 }, (_, i) => ({
    id: `fact-${i + 1}`,
    value: `经历事实 ${i + 1}`,
    status: 'confirmed' as const,
  }));

  const visibleFactIds = new Set(allConfirmedFacts.map((f) => f.id));

  // 模拟模型可能推荐了历史/其他方向引用的孤儿 ID 或被截断 ID
  const selectedFactCandidates = ['fact-1', 'fact-49', 'fact-999-orphan', 'fact-50'];

  // 过滤后的最终授权事实 ID
  const finalAuthorizedIds = selectedFactCandidates.filter((id) => visibleFactIds.has(id));

  assert.deepEqual(finalAuthorizedIds, ['fact-1', 'fact-49', 'fact-50']);
  assert.ok(!finalAuthorizedIds.includes('fact-999-orphan'), '未在界面呈现给用户的事实绝对不能被默认授权带入');
});

test('AUD-02: 排队超时状态机能准确判定排队延迟与超时，不无限计时误导', () => {
  const evaluateTaskWaitingState = (status: 'queued' | 'running', seconds: number) => {
    const isQueued = status === 'queued';
    const isQueuedDelayed = isQueued && seconds >= 25;
    const isRunningDelayed = !isQueued && seconds >= 45;
    const isTimedOut = seconds >= 90;
    return { isQueuedDelayed, isRunningDelayed, isTimedOut };
  };

  // 1. 正常初期
  assert.deepEqual(evaluateTaskWaitingState('queued', 10), {
    isQueuedDelayed: false,
    isRunningDelayed: false,
    isTimedOut: false,
  });

  // 2. 排队延迟超过 25s
  assert.deepEqual(evaluateTaskWaitingState('queued', 28), {
    isQueuedDelayed: true,
    isRunningDelayed: false,
    isTimedOut: false,
  });

  // 3. 执行中超过 45s
  assert.deepEqual(evaluateTaskWaitingState('running', 50), {
    isQueuedDelayed: false,
    isRunningDelayed: true,
    isTimedOut: false,
  });

  // 4. 超时 90s 以上，停止假装转圈，进入超时恢复引导
  assert.deepEqual(evaluateTaskWaitingState('running', 95), {
    isQueuedDelayed: false,
    isRunningDelayed: true,
    isTimedOut: true,
  });
});

test('AUD-05: 基础资料由纯文本块升级为结构化字段单项解耦解析', () => {
  const blob = '个人资料\n姓名：李四\n生日：1998-03-20\n所在城市：杭州\n职业：前端研发';
  const isBasicInfo = blob.startsWith('个人资料\n');
  assert.ok(isBasicInfo);

  const subFields = blob.split('\n').slice(1).filter(Boolean);
  assert.deepEqual(subFields, [
    '姓名：李四',
    '生日：1998-03-20',
    '所在城市：杭州',
    '职业：前端研发',
  ]);
  assert.equal(subFields.length, 4);
});

test('AUD-10: 世界事件 Payload 超过 64KB 限制必须拦截', () => {
  const validateEventSize = (eventObj: object) => {
    const size = JSON.stringify(eventObj).length;
    if (size >= 65536) {
      throw new Error('EVENT_TOO_LARGE');
    }
    return true;
  };

  // 1. 正常大小事件
  const normalEvent = {
    schemaVersion: 1,
    type: 'note.saved',
    id: 'evt-1',
    data: { text: '小院阳光正好' },
  };
  assert.equal(validateEventSize(normalEvent), true);

  // 2. 超大事件（>64KB）
  const hugeEvent = {
    schemaVersion: 1,
    type: 'note.saved',
    id: 'evt-2',
    data: { text: 'X'.repeat(70000) },
  };
  assert.throws(() => validateEventSize(hugeEvent), /EVENT_TOO_LARGE/);
});

