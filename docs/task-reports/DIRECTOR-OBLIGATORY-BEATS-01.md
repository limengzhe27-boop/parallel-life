# DIRECTOR-OBLIGATORY-BEATS-01 · 导演必演绎节拍队列（任务四）

执行方：dsh-main-20260923；基线 **origin/main 93b8773**。
状态：**设计 + 代码 + 测试已给出，尚未落到分支**（沙箱限制：工作树在仓库外，写入需逐次授权；建议按下文"落地步骤"在 worktree 内应用）。

## 0. 已核准的真实契约（不要按别的名字写）

`src/contracts/published-world-content.ts`（236–295 行）：

```ts
candidates: Array<{
  key; kind:'candidate'; title(≤120);
  editorialIntent: text(≤1600);                 // 起因/博弈/结局三段式概述
  direction?: { mode:'required'|'optional'; expectedImpact?(≤1200); experience?(≤1200) };
  actorKeys(≤12); placeKey?; prerequisites(≤16); conditionKeys?(≤16);
  mutuallyExclusiveNodeKeys(≤16); intent;
  timeline?: { stageKey; window?; timeNote?; excludeIfResolved(≤16);
               alternatives:{ onDeclined:refs(8); onSkipped:refs(8); onExpired:refs(8) } };
}>  // 上限 32 条
```
现状核查：**世界/导演侧目前完全没有消费 `candidates`**（`git grep candidates` 命中全部在 `src/modules/settings/**`）。`db/migrations/0029_director_attempts.sql`、`0054_publication_director_setting.sql` 已存在，可直接沿用其风格。

---

## 1. 调度模型设计

### 1.1 队列来源与状态

- **入队**：`candidates.filter(c => c.direction?.mode === 'required')`；`optional` 一律不入必发队列（仍可由自由 agenda 采用）。
- **状态**（每世界一份，持久化）：
  `pending`（未播）→ `played`（已演绎，记 `playedAt` + `eventId`）；或 `skipped` / `expired` / `declined`（按 `timeline.alternatives` 记账后移出队列）。
- **幂等键**：`(world_id, candidate.key)` 唯一；重放/崩溃恢复不会重复触发。

### 1.2 前置条件求值（不满足就**不消耗**）

一个必发事件"可播"需同时满足：
1. `prerequisites` 全部满足（复用现有条件求值器；`match:'all'|'any'` 语义与 conditions 节点一致）；
2. `conditionKeys` 若存在，全部为真；
3. `timeline.stageKey` 已到达（世界当前阶段 ≥ 该阶段）；
4. `timeline.window` 若存在，当前故事时间在窗口内；
5. `excludeIfResolved` 中任一 resolution 已发生 → 该事件**不再必发**（转为终止，记 `expired`，并按其 `alternatives` 记账）；
6. `mutuallyExclusiveNodeKeys` 中已有节点被占用 → 该事件本轮不可播（**不消耗**，等互斥节点释放或走 expired）。

> 关键点：**"不满足前置"≠"跳过"**。跳过只发生在窗口过期或互斥永久冲突时，并且必须写入 `expired` 与 alternatives，否则队列会永久卡住（这是这个功能最常见的死锁来源）。

### 1.3 与自由节拍的关系（业务规则的硬约束）

```
第 k 拍：
  1) 先取必发队列中「可播」的最高优先事件（顺序：stageKey 升序 → window 截止时间升序 → 数组原顺序）
  2) 命中 → 用该事件的 editorialIntent 作为舞台指示，走既有 resolveTurn 流水线（actorKeys 指定入局人物）
  3) 未命中（当前无一可播）→ 不消耗，落到自由 agenda（欠回应 > 未定约定 > 承诺 > 聚焦 > 沉默最久）
  4) 只有当队列里 required 全部终止（played/skipped/expired/declined）后，才允许"完全自由"的节拍
```
**每拍最多 1 个必发事件**，一次推进仍受既有 `MAX_BEATS_PER_ADVANCE` 上限与每拍 ≤1 次模型调用的成本约束。

---

## 2. 实现代码（可直接集成）

### 2.1 领域纯函数 `src/modules/world/domain/obligatory-beats.ts`（新增）

```ts
export type CandidateBeat = {
  key: string;
  title: string;
  editorialIntent: string;
  mode: 'required' | 'optional';
  actorKeys: string[];
  stageKey?: string;
  window?: { from?: string; until?: string };
  excludeIfResolved?: string[];
  mutuallyExclusiveNodeKeys?: string[];
  alternatives?: { onDeclined: string[]; onSkipped: string[]; onExpired: string[] };
};
export type BeatStatus = 'pending' | 'played' | 'skipped' | 'expired' | 'declined';
export type BeatState = { key: string; status: BeatStatus; playedAt?: string; eventId?: string };
export type BeatContext = {
  stageKey: string | null;
  storyNow: string;
  resolvedNodes: ReadonlySet<string>;
  occupiedNodes: ReadonlySet<string>;
  prerequisitesMet: (beat: CandidateBeat) => boolean;
};

/** 只把 required 且尚未终止的事件放进队列（optional 由自由节拍处理）。 */
export function obligatoryQueue(
  candidates: readonly CandidateBeat[],
  states: readonly BeatState[],
): { due: CandidateBeat[]; terminated: number; total: number } {
  const byKey = new Map(states.map((s) => [s.key, s]));
  const required = candidates.filter((c) => c.mode === 'required');
  const open = required.filter((c) => (byKey.get(c.key)?.status ?? 'pending') === 'pending');
  return { due: open, terminated: required.length - open.length, total: required.length };
}

const stageIndex = (stage: string | null, order: readonly string[]) =>
  stage === null ? -1 : order.indexOf(stage);

/** 选出这一拍该播的必发事件；不满足前置的一律不选（也不消耗）。 */
export function selectObligatoryBeat(
  due: readonly CandidateBeat[],
  context: BeatContext,
  stageOrder: readonly string[],
): CandidateBeat | null {
  const ready = due.filter((beat) => {
    if (beat.stageKey && stageIndex(context.stageKey, stageOrder) < stageIndex(beat.stageKey, stageOrder))
      return false;
    if (beat.window?.from && context.storyNow < beat.window.from) return false;
    if (beat.window?.until && context.storyNow > beat.window.until) return false;
    if (beat.excludeIfResolved?.some((node) => context.resolvedNodes.has(node))) return false;
    if (beat.mutuallyExclusiveNodeKeys?.some((node) => context.occupiedNodes.has(node))) return false;
    return context.prerequisitesMet(beat);
  });
  if (!ready.length) return null;
  return [...ready].sort((a, b) => {
    const byStage = stageIndex(a.stageKey ?? null, stageOrder) - stageIndex(b.stageKey ?? null, stageOrder);
    if (byStage !== 0) return byStage;
    const aUntil = a.window?.until ?? '9999-12-31T23:59:59.999Z';
    const bUntil = b.window?.until ?? '9999-12-31T23:59:59.999Z';
    return aUntil.localeCompare(bUntil);
  })[0]!;
}

/** 窗口过期：转 expired 并给出要记入的 alternatives，避免队列永久卡住。 */
export function expireOverdue(
  due: readonly CandidateBeat[],
  context: BeatContext,
): { key: string; status: 'expired'; alternatives: string[] }[] {
  return due
    .filter((beat) => beat.window?.until && context.storyNow > beat.window.until)
    .map((beat) => ({
      key: beat.key,
      status: 'expired' as const,
      alternatives: beat.alternatives?.onExpired ?? [],
    }));
}

/** 队列是否已清空——只有清空后才允许完全自由的 agenda 节拍。 */
export function freeImprovisationAllowed(due: readonly CandidateBeat[]): boolean {
  return due.length === 0;
}
```

### 2.2 调度接入 `src/modules/world/application/advance-world.ts`（改造）

```ts
for (const beatAt of advance.beats) {
  const world = await deps.worlds.get(session, worldId);
  const atBeat = { ...world, time: beatAt };
  const context: BeatContext = {
    stageKey: deps.stageKey?.(world) ?? null,
    storyNow: beatAt,
    resolvedNodes: deps.resolvedNodes(world),
    occupiedNodes: deps.occupiedNodes(world),
    prerequisitesMet: (beat) => deps.prerequisitesMet(world, beat),
  };
  const { due } = obligatoryQueue(deps.candidates(world), deps.beatStates(world));

  /* 1) 先清过期，避免死锁（写 expired + alternatives 记账） */
  for (const expired of expireOverdue(due, context)) await deps.recordBeat(expired);

  /* 2) 必发优先：命中则用 editorialIntent 作为舞台指示 */
  const obligatory = selectObligatoryBeat(due, context, deps.stageOrder(world));
  if (obligatory) {
    await deps.recordBeat({ key: obligatory.key, status: 'pending', plannedFor: beatAt }); // 占位防并发
    await resolveTurn(
      { worlds: deps.worlds, planner: deps.obligatoryPlanner, now: () => beatAt, newId: deps.newId,
        ...(deps.memories ? { memories: deps.memories } : {}) },
      session,
      { id: deps.newId(), worldId, actorId: obligatory.actorKeys[0] ?? defaultActor, 
        text: obligatoryCue(obligatory), expectedVersion: world.version },
    );
    await deps.markPlayed(obligatory.key, beatAt);
    continue;
  }

  /* 3) 只有队列清空后才允许完全自由的节拍 */
  const agenda = freeImprovisationAllowed(due)
    ? buildAgenda(atBeat, 5, worldMemories)
    : buildAgendaFromObligations(atBeat, due, context);   // 仍只能围绕必发事件铺垫
  const actorId = selectSpeaker(atBeat, actors, agenda, direction.focusActorIds);
  ...
}
```
> `obligatoryPlanner` 的提示词应把 `editorialIntent` 原文 + `actorKeys` 的公开名片一起给出，并要求"只演绎这一件事的三段式（起因/博弈/结局），不得提前揭示后续事件"。

### 2.3 持久化（迁移 `0055_world_obligatory_beats.sql`）

```sql
CREATE TABLE parallel_life.world_obligatory_beats (
  world_id text NOT NULL, owner_id text NOT NULL,
  candidate_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','played','skipped','expired','declined')),
  played_at timestamptz, event_id text, alternatives text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (world_id, candidate_key),
  FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE
);
ALTER TABLE parallel_life.world_obligatory_beats ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.world_obligatory_beats FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON parallel_life.world_obligatory_beats TO pl_app
  USING(owner_id = current_setting('app.user_id', true))
  WITH CHECK(owner_id = current_setting('app.user_id', true));
CREATE POLICY leased_worker ON parallel_life.world_obligatory_beats TO pl_worker
  USING(parallel_life.worker_owns(owner_id)) WITH CHECK(parallel_life.worker_owns(owner_id));
GRANT SELECT,INSERT,UPDATE,DELETE ON parallel_life.world_obligatory_beats TO pl_app;
GRANT SELECT,INSERT,UPDATE ON parallel_life.world_obligatory_beats TO pl_worker;
```

---

## 3. 守门测试（两份）

### 3.1 纯函数 `tests/obligatory-beats.test.ts`

```ts
test('N 个剧情拍内，全部 required 事件 100% 被推进（绝无遗漏）', () => {
  const candidates = [1,2,3,4,5].map(n => beat(`e${n}`, 'required'));
  const stages = ['s1','s2','s3'];
  const states: BeatState[] = [];
  const playedKeys: string[] = [];
  for (let beat = 0; beat < 20 && playedKeys.length < candidates.length; beat++) {
    const ctx = { stageKey: stages[Math.min(2, Math.floor(beat/7))], storyNow: t(beat),
                  resolvedNodes: new Set<string>(), occupiedNodes: new Set<string>(),
                  prerequisitesMet: () => true };
    const { due } = obligatoryQueue(candidates, states);
    const chosen = selectObligatoryBeat(due, ctx, stages);
    if (!chosen) continue;
    states.push({ key: chosen.key, status: 'played', playedAt: t(beat) });
    playedKeys.push(chosen.key);
  }
  assert.deepEqual(new Set(playedKeys), new Set(candidates.map(c => c.key)));
});

test('已演绎的必发事件不会重复触发（幂等）', () => { /* played → 不再出现在 due */ });
test('前置未满足时不选中，也不消耗（下次仍可播）', () => { /* prerequisitesMet=false → null，due 长度不变 */ });
test('窗口过期的必发事件转 expired 并带出 alternatives（不卡死队列）', () => { /* expireOverdue */ });
test('队列清空前不允许完全自由节拍', () => { assert.equal(freeImprovisationAllowed(due), false); });
test('互斥节点占用时该事件本轮不可播，但保留 pending', () => { /* occupiedNodes */ });
test('optional 事件永不进入必发队列', () => { /* mode:'optional' 被过滤 */ });
```

### 3.2 真实库 `tests/integration/obligatory-beats.test.ts`

```ts
test('世界中 3 个必发事件在受控推进下全部演绎，且期间不产生自由 agenda 节拍', async () => {
  // 1) 建一个带 candidates(3×required) 的发布世界（复用 publication trial 建世界路径）
  // 2) 用假 planner：断言每次被调用的 cue 必须来自 editorialIntent（自由节拍会露出别的 cue 文案）
  // 3) 连续 advance 直到队列清空（上限 10 拍），断言：
  //    - world_obligatory_beats 中 3 条 status='played'，played_at 非空
  //    - 事件不重复（event_id 唯一），world.version 与拍数一致
  //    - 队列清空之前，planner 收到的 cue 全部是必发事件（100% 覆盖，无自由节拍）
  // 4) 清空后再 advance 一拍：此时才允许自由节拍（cue 不再来自 candidates）
});
test('崩溃/重放不重复演绎同一必发事件', async () => { /* 同 commandId 重放 + 已 played 的 key */ });
test('窗口过期的事件被记为 expired 并写入 alternatives，队列可清空', async () => {});
```

---

## 4. 落地步骤（建议顺序）

1. 在 worktree（`人生剧本-records` 或另建 `codex/obligatory-beats`）内：
   `domain/obligatory-beats.ts` → `tests/obligatory-beats.test.ts` → 跑纯函数测试（最快闭环）。
2. 迁移 `0055_world_obligatory_beats.sql` + 仓储读写（含 `markPlayed` / `recordBeat`）。
3. 改 `advance-world.ts` 接入（第 2.2 节），并给 `obligatoryPlanner` 写提示词（editorialIntent + actorKeys 公开名片，禁止提前揭示后续）。
4. 真实库守门测试（第 3.2 节）。
5. `npm run check` + `npm run build`；报告写清"3 个必发事件全部演绎 + 无自由节拍稀释"的证据。

## 5. 风险与边界（务必处理）

1. **死锁**：前置永不满足 → 必须靠 `window.until` 过期走 `expired` + alternatives 兜底，并设"阻塞上限"（例如同一事件连续 K 次不可播则记录原因并在世界 UI 明示），否则玩家会卡在"什么都没发生"。
2. **互斥冲突**：`mutuallyExclusiveNodeKeys` 占用时保留 pending，但要给出替代路径（`alternatives.onSkipped/onDeclined`），避免两个事件互相等待。
3. **成本**：必发事件同样每拍 ≤1 次模型调用；32 个必发事件的极端情况下需要更多拍数，应允许跨多次 `advance` 完成，不要在一次推进里硬塞。
4. **不剧透**：`editorialIntent` 含"结局与冲击"，提示词必须要求只演绎当前三段式，不能把后续候选库内容或结局提前抖出来。
5. **与 `purpose:'runtime_required'` 的关系**：extensions 里已有该枚举，若它表示"运行期强制"，建议与 `direction.mode==='required'` 统一权威来源，避免两套"必发"语义打架。
