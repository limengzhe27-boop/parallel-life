# WORLD-PUBLISH-01AUTH-QA — 发布身份helper限定只读审查

2026-10-12。Agent `codex-worldpublish01auth-qa-01a0c7c8-20261012`；辅助会话01a0c7c8-604f-7dc1-8122-fc7f0af1fd6b；根唯一源码实现/集成。主表短锁已领取进行中。独立报告分支`codex/world-publish-auth-qa`，工作树`/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本`，基线7c74c5b99de05414179b813a7f323ed830c39c25；仅本报告、主目录镜像及本人行，旧QA不复写。

## 准确快照与结论

只读`.local/worktrees/world-publish-intake-01`的根helper及原12test。初次读取允许的WIP后，确认源已冻结为完整`74de967a4cebf9e3bec543c25aafccc99ea17b2f`（含根原身份实现与数组guard）。运行前后逐字核对两个文件和SignedSession依赖均与该提交一致。未修改root WIP、源码、原test、SQL或权限配置；未读取服务端密钥。

本次限定源码审查未发现新的实质缺陷。原12测试实际12/12通过、零skip；五组不落文件的独立stdin反例通过。结论覆盖纯helper/真实Node密码与签名运算、合成配置和Request对象，不覆盖HTTP登录/员工账号、数据库授权、实际撤权链路或线上管理员使用。

|准确快照文件|SHA-256|
|---|---|
|src/modules/identity/infrastructure/publisher-session.ts|d1b8103b65b6961f56e233cba2f913de17cd4e9296b1a6bcc24ae96bc8f93534|
|tests/publisher-session.test.ts|0b97d0df0ba03f0283860937ffb416e4fbe8439192f5030db49224e1389b8828|
|src/modules/identity/infrastructure/signed-session.ts（原test依赖）|c3ebdd078475300c8e2c9e8b4bf42021b206b557182f73c7bf17359026e12fa1|

## 实际核查

- 配置只允许服务端传入的有限principal；普通对象/数组原型及属性描述符先核对，再解构和迭代。原test覆盖字段getter、数组元素getter、自供map和permissions迭代器；独立反例又测permissions getter、数组自定义原型和对象自定义原型，全部拒绝、调用数0。不将有限普通配置证明扩大成任意JavaScript对象无执行陷阱的保证。
- 登录使用实际scrypt及随机salt，返回身份不含passwordHash；guest与publisher签名/CSRF命名空间隔离。原test覆盖错误/未知/disabled/超长凭证、不同身份与签名篡改、额外签名claims。没有真实员工账号或配置上线证据。
- token固定两小时、未来issued/过期拒绝，revision绑定当前服务实例解析的身份/权限/密码配置，角色来自服务器配置而不是客户端claims。edit不能当publish；修改原配置数组或返回的permissions不能提升本实例权限，独立反例确认。
- CSRF只对有效publisher token派生，绑定具体会话；两次登录的CSRF不能混用，guest CSRF/过期/多字节错值拒绝。独立反例再次确认单会话绑定与两小时边界。
- origin仅匹配明确服务器trustedOrigins，cross-site、无origin、带凭据/路径/伪站点或不可信forwarded-host不改变准入。独立反例确认即使伪造same-origin标记和x-forwarded-host，非允许Origin仍拒绝。此函数不等于已将同源和CSRF放在HTTP写入口。

## 三项重要HTTP接续边界（尚未实现/验收）

1. **配置快照撤权，不是实时在线撤权。**独立反例确认：创建实例后将调用者原配置enabled改false，旧实例仍能验证旧token；按新disabled配置重建实例则拒绝。原12项撤权测试也是重建服务读取新配置，未验证长期缓存实例自动刷新。根已确认此限制；HTTP及STORE必须规定配置刷新/撤销策略，并在每次实际数据库事务复核active、当前permission和工作区授权，不能仅用入队时旧身份给未来提交授权。
2. **路由需组合会话、权限、同源与CSRF。**现源码不设置HttpOnly/Secure/SameSite Cookie，不提供登录/写入路由或注销链路，也没有持久限流。未来登录和写入口应从服务器获得身份与可信Origin配置，按实际edit/publish操作授权，叠加会话CSRF；不可从请求自报principal/permission/trustedOrigins，也不可失败后回落guest。密码请求限流及Cookie/退出策略须由根在HTTP层实测，本QA未证明暴力尝试控制或单会话主动撤销。
3. **helper不授予作品/SQL发布权。**有效身份及publish权限仍需绑定当前作品/工作区许可，接RLS、事务回执与实际检查/试演/素材证据，更新/下架等命令也要当前权限。Q本轮未跑PG、HTTP、跨工作区或实际撤权事务负例，不能把token验证当作数据库安全或后台已可发布；后续由根/B STORE精确接线验收。

这些是明确缺失的接线能力，非已启用HTTP漏洞或已经发生的生产问题。根说明本冻结仅发布基础库，尚无后台HTTP身份入口、员工账号及新SQL，不应写成可登录发布的成品。

## 验证与交接

原12用`node --experimental-strip-types --test tests/publisher-session.test.ts`只读运行，运行前后freeze字节一致。独立stdin为5组（不是新增5个持久test）：配置getter/原型、权限克隆、旧实例/重建撤权、会话CSRF、Origin，使用合成账号/凭证和真实密码/签名函数，未持久化账号或测试文件。首次继承原型反例使用Object.assign，因原型id getter没有setter在调用该反例parser前构造报错；修正为设置对象原型后5组通过，源与断言目标未改，非helper缺陷。

本报告做链接/表列/行尾/diff及唯一文件范围核对后冻结交根。没有新增源码/test、没有跑本轮fullcheck/build/PG/模型/浏览器/部署，也不将根报告的1541/check/build/生产校验当自己的执行。原内容QA92/报告保持不变；B STORE与根HTTP/部署工作不因本审查接管。限本helper快照技术审查通过，HTTP/实时撤权/DB发布与整个后台仍待开发验收。

接续点：根归档本精确报告，继续自己的部署；HTTP/STORE登记完成后补真实当前权限/撤权、限流、Cookie、CSRF同源组合与跨作品数据库负例。Q本轮报告冻结后不再占写范围，不自动领取UI或其他任务。

主表：[DEVELOPMENT.md](/Users/limengzhe/Desktop/projects/demo/人生剧本/docs/DEVELOPMENT.md)；本文只给证据和限制，不另设任务状态表。
