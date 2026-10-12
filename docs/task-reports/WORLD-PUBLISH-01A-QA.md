# WORLD-PUBLISH-01A-QA — 冻结内容协议独立审查

2026-10-12。Agent codex-worldpublish01a-qa-01a0c7c8-20261012；辅助会话01a0c7c8-604f-7dc1-8122-fc7f0af1fd6b。根唯一集成/B唯一内容源码实现。主表短锁已领取进行中；独立树 `/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本`、`codex/world-publish-01a-qa`，准确基线87f95f5fe37945e1aef540e5f12423fc604f24cc（确认祖先19f70c8e7fc0aefad3526a574e900c03d4bc6a85）；旧设计e1af/703/分类77分支保留。

只新增 tests/publication-content-audit.test.ts 和本报告/主目录镜像/本人行；全部src、B原60tests、旧tests/契约/API/SQL只读。首轮不读B未冻结timeline WIP作验收。0模型PG生产写/图端口浏览器部署。根最终fullcheck/build和上线；本QA不得提前标后台完成。

已读AGENTS/主表与已读项目说明、架构复核及主方案。只读核对冻结published-world-content.ts/publication-content.ts、原tests和报告；新fixture独立构造现代车站/同名但不同key两角色、未知地点/人物、分人知识、公开/私有历史与素材、当前来信/有来源提议邀约/相册、未来候选及内部扩展，不导入原test fixture。实际调用schema、原始入口preview/support与对已解析内容调用domain函数，非镜像regex或源码字符串测试。

先覆盖公开引用/隐私闭包、stablekey/同名、时间/邀约来源、可存≠可运行≠发布权、JSON/getter/原型/UTF8/规模限制。发现疑点：存储guard对数组未校验原型，可能在JSON.stringify触发原型上的toJSON/访问器；两独立反例保留原输入及“不得执行/必须拒绝”断言。下一步运行原60+新审查，准确报告红例并交根由B唯一修复，不擅改源或宽断言；时间线需等新精确freeze再接续。

## 首轮真实调用结果（准确87f95f5）

`node --experimental-strip-types --test tests/published-world-content.test.ts tests/publication-content-audit.test.ts`：116项，114通过、2失败、零skip。原冻结60项通过；独立新增56项54通过、2失败。`tsc --noEmit --incremental false`退出0，模块边界338文件通过，新增测试Prettier及git diff --check通过。没有运行fullcheck/build、PG或真实模型；这是实际调用领域/契约函数的合成输入审查，不是Repository/API/上线验收。

两红例同一存储边界缺陷：`publicationStorageIssues`对非数组检查Object.getPrototypeOf，但Array.isArray分支没有拒绝自定义数组原型，随后JSON.stringify读取/执行继承的toJSON。新test原输入与断言完整保留：

```ts
// case 1，withData将原数组放进显式editorial extension.data。
let calls = 0;
const data = ['source-value'];
Object.setPrototypeOf(data, {
  toJSON() {
    calls++;
    return { changedByCode: 'SECRET_SERIALIZED_REPLACEMENT' };
  },
});
const stored = PublishedWorldContentSchema.safeParse(withData(data));
assert.equal(calls, 0); // 实际3，校验已执行用户自带序列化代码。
assert.equal(stored.success, false);
```

```ts
// case 2，继承访问器同样不应被校验读取。
let reads = 0;
const data = ['source-value'];
Object.setPrototypeOf(data, Object.defineProperty({}, 'toJSON', {
  get() {
    reads++;
    return () => ({ changedByGetter: true });
  },
}));
const stored = PublishedWorldContentSchema.safeParse(withData(data));
assert.equal(reads, 0); // 实际3。
assert.equal(stored.success, false);
```

原文件用明确说明保留“不得执行且必须拒绝”，没有改成只检查最终返回值，也没有修B源。根已收到首轮精确问题，B为唯一修复者。这里不能声称发生生产远程代码执行：普通HTTP JSON本身不能携带函数/自定义原型；当前证据是接受unknown对象的内部JSON边界执行了继承代码，违反拒绝原型/getter、不改变存储资料及纯数据约定。即使最终某一项失败，执行用户方法本身已违反断言。

## 首轮未复现问题及限制

- 原始schema/安全preview与解析后domain preview结果一致；隐藏世界/Persona/未知角色、地点和路线、隐藏关系、私有事实、未列为初知的world事实、未引用私有素材及扩展/候选不出公开投影。
- 公开关系引用未知角色不带出profile；未知人物/地点上的player-visible头像/场景不会通过其他公开数组漏出；同名不同key保持独立，不按名字合并。
- 主角/便签/相册引用私有或未初知事实、另一actor私有知识、未知来信人/邀约参与者地点、错误素材用途或actor-only公开图片、有缺失/错配源消息的邀约均拒绝。
- 真日历非法日期、未来历史/来信、过去邀约、history来信不早于起点、候选早于起点与缺失/自依赖/间接环均拒绝；有条件的合法偏序只是内容条件，不输出eligibleNodes、已完成节点或当前真实资格。
- knownAtStart是作者的开局认识声明，不是员工/内容批准或素材许可；默认runtimeReady=false，全部所需能力匹配时也grantsPublicationAuthority恒false；runtime_required未知扩展不因同名capability变支持。公开文本仍需要真实审批/来源核对，纯schema不识别自由文本隐藏秘密或“未来”语义，publication namespace也不证明资产授权。
- 自有getter/序列化器、原型保留键、函数、非JSON类、symbols、非可枚举属性、稀疏/带额外属性数组、循环/深度/值数/UTF8预算均有负例，null-prototype普通对象可以作为数据保存而不会获得运行权。

下一步：冻结本QA提交/镜像，主表先待验收但明确2红；等I给B准确修复提交后，在独立树接同一原始反例复验。B新的stage/窗口/跳过协议尚未作为本轮证据，不读取未冻结WIP或推断已支持；收到准确freeze后同任务追加独立时间线负例。根负责源合并、fullcheck/build/真实PG/员工API/试演/部署，不能以本轮54通过代替2红或完整后台上线。

## 第二轮：准确fc6时间线（仍非实际推进资格）

首轮QA准确提交7d57e64e2f0c04ed0172fcaa24f264e133738c37。收到根明确续派后，独立树cherry-pick B准确fc6a3fd51d088a838a0520f7f596497a6749f0a2（本地依赖提交dfab638a13928709a104423ecb0b5ff309b07cd8），逐字验证其contract/domain/原tests/B报告四文件和fc6一致。未读未冻结WIP、未自行写源。最初56测试/fixture/两getter断言仍是新文件逐字相同的prefix；只追加36项独立时间线测试。

原94+QA92合计186，180通过、6失败、零skip；原B94通过，QA92中的86过6红（首轮2继承序列化+本轮4）。type退出0，338边界、指定test格式及diff check过。全部源和B原94test相对准确fc6没有QA修改。未运行fullcheck/build/PG/浏览器或真实模型/部署。

新增验证：阶段和候选稳定引用/必要偏序、同阶并行与跳过路径、初始窗口、阶段自依赖/同rank错误/环、候选缺阶段/反向前置/缺失或self resolved节点、重复或空outcomes、完整排除与合法部分排除、后退/不存在/重复自身替代、已过期替代、额外timeline能力、严格区间端点与无世界状态副作用。preview不出阶段/时间线/未来节点/编辑备注，纯时间helper的open不能变成eligible/已发生。after_resolved_node skipped与after_committed_node不可互换：alternative指针可以保存，但不改目标的必要commit前置，也不能因此说它跳过后实际可推进。实际适配器仍需核可信结果与当前阶段。

新增四红例原输入/断言在测试文件末端：

1. 候选显式window为`[2026-10-12T09:15:00Z, 2026-10-12T09:45:00Z)`，结构prerequisite为`not_before=2026-10-12T09:45:00Z`。没有任何合法时刻，raw schema仍success=true，mustReject要求false失败。
2. 删除候选自身window，继承阶段`[09:00Z,10:00Z)`；结构prerequisite为`not_before=10:30Z`，同样success=true。这不是自由timeNote，不能忽略其与有效截止的矛盾。
3. `publicationStoryWindowState({notBefore:'2026-03-01T00:00:00Z',expiresAt:'2026-03-05T00:00:00Z'}, '2026-02-30T09:00:00Z')`预期抛错，实际没有：Date.parse将非法二月三十日归一化。
4. 窗口边界notBefore为`2026-02-30T00:00:00Z`、expiresAt为`2026-03-05T00:00:00Z`，storyAt为`2026-03-03T09:00:00Z`，helper同样未抛错。

第3/4是直接导出纯helper输入边界，**不是**raw PublishedWorldContentSchema失守：原始schema已正确拒绝非法日历日期，HTTP/世界时钟也未在本轮实测。不能将此描述成生产时钟已被篡改。修复由B唯一决定具体验证方式，QA不镜像其日期regex、不宽断言。邀请的活动时间晚于候选提出窗口本身可以合法，专门保留正例，未把“提出邀约的截止”误当活动必须完成时间。

所有6红仍保留，已交根协调B唯一修复；下一步冻结本轮新增QA提交，等待准确修复源后在同一反例上复验。此时只有阶段/窗口/路径元数据和纯检查，无调度器、实际stage状态或资格API，不能用180绿称可发布，更不能写人物已行动或阶段已推进。身份helper由根独占，不纳入本次源QA范围。
