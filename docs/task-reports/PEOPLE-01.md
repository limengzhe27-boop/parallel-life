# PEOPLE-01 · 新个人分支的熟人映射与原图落位

状态：待验收；Agent `codex-f-01a0c7c8-people01-20261008`；独立工作树 `.local/worktrees/people01`，基线 `b481425`。已按主目录短锁登记具体文件；现有集成人负责合并、生产迁移和部署。主目录 LIB-04B 在途文件不进入本提交。

## 公共契约及有限方案

1. 个人 Seed/草案选择增加可选 `personRoles`（personId、本分支角色要求），校验只引用已选人物、不重复；新个人 Seed 明确写入该字段开启映射。旧 Seed 缺此字段沿用旧开场，私有设定试演不接此字段。新创建最多选择8位人物（现有世界角色上限），无人物/无图均可。
2. 模型开场 actor 增加可选 sourcePersonId，开启映射的新Seed要求所选人物与角色一一对应；拒绝缺失、重复、未选人物引用。姓名与明确角色要求由服务端定稿，默认虚构角色由模型提出，现实关系快照不回写。
3. 新迁移0035保存 `world_person_bindings`：world/owner/person/actor、原人物快照、可空原图素材及修订。世界创建事务同时写映射；头像与相册投影均从同一映射读取原图，不复制存储对象，不虚构拍摄日期。原图标记为用户带入，素材上传时间只排序/显示为上传时间。
4. 素材URL带worldId，读取同时核对世界所有权、该世界合法素材关联及修订。照片删除若已有不可变Seed/世界引用则拒绝破坏既有引用；删除与遗忘完整产品规则留后续。
5. 草案UI选择人物（可选），可写虚构角色要求；带入该人物时同时带入其已关联照片，头像/相册用途不分选。本人照片仍按原流程选择。原有set-person编辑可关联/更换单张素材；聊天自动关联不在本批。

## 本批不覆盖

聊天自动关联（PEOPLE-02）、同人多图与合照分人、面部识别/自动身份关系推断、已有世界加入、图生图/朋友圈、删除与遗忘的完整产品规则；不推断来源照片代表虚构共同经历。世界角色只获授权起点，不获完整现实访谈。

## 验证、阻塞与接续

正在实现；计划单测、check/build、真实PostgreSQL的归属/幂等/回滚/旧Seed兼容、双宽UI及合成样本真实AI开场和图片读回。暂无上述完成证据。

## 2026-10-08 范围修正

普通头像与人物形象参考不同：本批只展示原图，不读取图像内容，不将熟人原图写入图生图任务。上传/选中均不构成形象生成授权；未分类素材的生成资格为未授权。首批无需增加生成用途字段，未来最小兼容方案是在人物与素材关联上增加可选 referenceIntent（display_only / likeness_reference），缺省按display_only；只有用户明确提供形象参考才写likeness_reference，并另行协调契约/迁移。本批不实现该字段、不接生成服务。既有本人肖像任务不使用熟人映射。

已有分支临时加人尚在讨论，不纳入本批。后续导演按剧情需要或用户明确索图触发生成，生成必须符合当前分支，成功才聊天发送/相册保存，不要求每回合出图；这里只记录需求。现实人物、分支角色/图片、原图、生成图的删除及级联待定，不新增删除产品流程。

已实现映射与原图读取基础；开始验证界面和真实数据库事务。

## 交付能力及文件

新个人分支通过草案确认或Seed批准持久保存选中人物和素材修订；角色映射在模型解析及保存边界校验，明确角色要求覆盖虚构世界关系，不回写现实资料。所选人物原图在同一世界事务中建立映射，供联系人头像及相册读取；相册按人物ID筛选，不从图片或同名字符串识别人。无人物、无图均可创建。原图沿用既有上传标准化（去除元数据、转WebP），没有额外图像生成/人脸裁剪。既有图片删除入口新增保护，拒绝破坏不可变Seed引用，没有新增删除流程。

修改文件（仅登记范围，主表单独短锁更新）：

- src/app/api/v1/assets/[id]/route.ts
- src/contracts/album.ts
- src/contracts/life-drafts.ts
- src/contracts/seeds.ts
- src/contracts/world-build.ts
- src/features/discovery/draft-editor.module.css
- src/features/discovery/draft-editor.tsx
- src/features/discovery/seed-consent.tsx
- src/features/phone/apps/photos.tsx
- src/features/phone/apps/types.ts
- src/features/phone/world-app-data.ts
- src/modules/discovery/infrastructure/draft-repository.ts
- src/modules/discovery/infrastructure/seed-repository.ts
- src/modules/media/infrastructure/album-projection.ts
- src/modules/media/infrastructure/asset-repository.ts
- src/modules/world/domain/types.ts
- src/modules/world/infrastructure/build-handler.ts
- src/modules/world/infrastructure/build-repository.ts
- src/modules/world/infrastructure/world-planner.ts
- tests/world-app-data.test.ts
- db/migrations/0035_world_person_bindings.sql
- tests/people-world.test.ts
- tests/integration/people-world.test.ts
- docs/task-reports/PEOPLE-01.md

## 实际验证结果

- npm run check：边界/类型通过，280项全部通过（含已有真实数据库用例）；沙箱首次EPERM后以可连接本地库权限重跑。独立开发库首次未初始化导致检查挂起，停止本任务检查、应用迁移后重跑通过。
- npm run build：最终通过。git diff --check通过；独立工作树基线b481425，无LIB-04B文件进入提交。
- 新增 tests/integration/people-world.test.ts 在独立PostgreSQL18.4、端口55435通过。真实草案prepare/save/confirm回执重放、Seed approve幂等、world-build租约提交、RLS隔离、原图文件读取、错误修订、同账号无关联世界、不可变映射、改名换图不改旧世界、无人物/无图、失效素材回滚、重复建世界只有一份映射均验证。测试模型为明确标注的fixture，未冒充真实AI。
- npm run test:db：47项中46项通过，1项失败。唯一失败 tests/integration/life-drafts.test.ts:157 的旧断言要求选中人物后不带其照片，和最新规则相反。该文件未获登记，不越界修改。当前不是全量数据库绿灯。
- 真实模型：合成样本用gpt-4o-mini，经真实Task Queue、WorldPlanner、buildHandler事务创建。初始任务08aae9dc-1766-43f6-82ef-c2e50793e2a9失败INVALID_AI_OUTPUT且无世界落库；提示词修正后显式重试任务c94f5758-4f2e-483b-bf98-d8cc6f5c1c95成功（调用2次，第一轮仅1个角色被校验拒绝，纠正后4个角色通过），resultVersion=0。模型返回的是文本开场，没有生成图片。世界3d11061c-b28e-434c-b027-27d964c16cbe的所选人物sourcePersonId保持原ID，姓名由服务端固定，分支关系为“我的下属，负责剪辑”；资料仍为“现实中的老板”。素材44a2d6d6-aec3-40f4-b067-409df89ab9e0是普通合成图形头像，未送到模型。
- 实际HTTP：同素材同时出现在actor.photo与photos；带worldId/revision读取200，3120字节WebP成功解码；错误修订/世界404。390×844手机、1440×1000PC的草案选择、锁屏通知定位、聊天头像、相册详情均检查；无横向溢出。

## 截图与本地证据

- [people-draft-mobile](/Users/limengzhe/Desktop/projects/demo/人生剧本/.local/worktrees/people01/.local/people-draft-mobile.png)
- [people-draft-pc](/Users/limengzhe/Desktop/projects/demo/人生剧本/.local/worktrees/people01/.local/people-draft-pc.png)
- [people-chat-mobile](/Users/limengzhe/Desktop/projects/demo/人生剧本/.local/worktrees/people01/.local/people-chat-mobile.png)
- [people-chat-pc](/Users/limengzhe/Desktop/projects/demo/人生剧本/.local/worktrees/people01/.local/people-chat-pc.png)
- [people-photo-mobile](/Users/limengzhe/Desktop/projects/demo/人生剧本/.local/worktrees/people01/.local/people-photo-mobile.png)
- [people-photo-pc](/Users/limengzhe/Desktop/projects/demo/人生剧本/.local/worktrees/people01/.local/people-photo-pc.png)

完整检查日志、数据库日志、构建日志和合成模型返回保留在此工作树.local/people-*，包含本地合成样本ID，不含密钥。数据库与服务资源均为本任务独立的55435/3226。不是生产库证据，不是公网验收。

## 兼容与集成人接续

1. 迁移0035需先于新服务上线；未合并、未推送、未生产迁移、未部署。线上仍是集成人上一版，不能称本功能已上线。由现有I合并及部署，执行者不接管。
2. 旧ApprovedSeed缺personRoles继续旧开场，旧世界不回填映射；私有setting trial不接personRoles，也不带人物或照片。已有world-build及setting-trials真实数据库测试通过。尚未确认的旧草案保存/确认按新规则带入所选人物原图，需重新核对资料；旧已确认世界不受影响。
3. 请I协调 tests/integration/life-drafts.test.ts 的新照片规则断言：seed.assets应包含f.photo与f.second（比较时按assetId排序），seed.people[0].assetId应是f.second；继续完成其余幂等/崩溃恢复断言。随后全量check/build/test:db，生产应用0035、按既有Vercel身份合并推送、READY后公网验证新分支选择熟人→头像→相册。
4. 后续PEOPLE-02可使用Person原有set-person关联接口，和sourcePersonId/绑定表作为接续点；普通头像默认仅展示，人物形象参考需要用户明确表达与另行协调最小属性。临时加人、生成图发送/保存及分层删除尚未实现，只保留需求，不自动领取。

本批已接真实Repository、任务与HTTP图片读取；没有内存生产仓储。模型fixture用例属于模拟提案验证，真实模型验收单独列出。整体状态待验收，仍缺旧断言更新、集成验证和上线。

## 主任务最终集成验收（2026-10-08）

已完成本批范围。旧照片断言修正，280常规/47真实库、build通过；生产35迁移，586868f / bfyho2qwx Ready；公网完整合成好友带入、真实AI世界/NPC、头像相册和隔离、双端UI通过。详细见PEOPLE-01I报告。历史待验收段为执行者交接时状态，以上为最终结果。
