# WORLD-PUBLISH-01AUTH-CORE

2026-10-12。codex-main-publisher-auth-core-20261012，根唯一实现/集成；新文件 publisher-session.ts、publisher-session.test.ts 及本报告。旧访客登录、HTTP、SQL、公共内容合同和UI只读。

## 本轮实现

独立内部身份基础，服务端受控配置决定principal、用户名、显示名、edit/publish权限、启用状态及salted scrypt密码验证值。配置严格校验、唯一身份/用户名、有界20人；不接受普通玩家的会话或其自报角色，不读取或写入玩家档案。登录用随机盐生成的64字节scrypt验证值；配置只应位于忽略的服务端环境，未在本轮创建真实员工凭据或写生产变量。

内部会话独立签名域、随机会话标识、两小时有效期、严格payload及配置修订绑定。停用/删除身份、修改权限/密码或轮换签名密钥会使旧配置下令牌失效；返回身份白名单不包含凭据。角色配置和返回的权限数组复制，不因调用者修改而提高权限。edit不隐含publish。实际作品/组织与数据库权限仍需后续API在事务内核查，这个模块不提供世界写入或发布命令。

CSRF只针对仍有效的内部会话，普通guest CSRF或其他登录会话不可复用；多字节不等长比较安全拒绝。管理写操作的origin纯检查只接受精确服务器配置列表，拒绝跨站与任意host/forwarded-host或其他Vercel项目域名；不修改现有guest同源策略。

公共导出：PublisherPermission、PublisherPrincipal、PublisherPrincipalConfig、parsePublisherPrincipals、hashPublisherPassword、PublisherSessions（login/verify/authorize/csrf/verifyCsrf）、publisherOriginAllowed。输入配置始终属于受控服务端，不能由HTTP请求提交；调用这些helper不代表已有员工登录页面或可公开发布的后台。

## 验证与局限

11项新真实密码/签名专项通过，覆盖guest隔离、错误/未知/停用登录、过期/未来/篡改、身份隔离、撤权/轮换、编辑不授发布、配置不可被外部改、CSRF绑定、额外claims/延长时限拒绝、坏配置与getter、随机盐、严格origin及host伪造。样例为明确虚构测试凭据，不是生产密钥。typecheck与337边界通过，限定新文件Prettier完成。

无API路由、cookie写入、持久登录限流、内部员工账号管理、正式role grant/作品scope、DB RLS、后台页面或发布事务接线。没有生产账号/配置/数据修改、SQL迁移、模型、图片或浏览器。后续HTTP接线需要持久限流、HttpOnly/secure cookie、同源/CSRF、服务端撤权/作品权限核验；不得直接把登录结果当作正式发布权。secret与密码验证值仅在忽略服务端环境，日志/客户端不含配置。

完整check/build、联合内容安全审查及READY/public归档待根集成完成后记录；不能把本11项当数据库/浏览器/正式后台验收。B内容94专项及Q发现的数组原型红例属于独立内容合同，根不并写B源，安全问题修复前不发布联合基础。
