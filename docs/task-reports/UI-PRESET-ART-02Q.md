# UI-PRESET-ART-02Q — 四副本封面、壁纸和人物插画

2026-10-12；Agent codex-f-ui-preset-art02q-01a0c7c8-20261012；独立工作树 /Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本；分支codex/ui-preset-art-02q，基线4b4dd99。旧模型任务已结束，不继承其调用余额。

## 范围和方案

短锁领取成功。仅public/art/lives/**、discovery/life-art.ts、phone/avatar-art.ts、phone/wallpaper.ts、phone/world-app-data.ts、tests/official-life-art.test.ts、本报告和主表本人行。根负责统一卡片及world-phone-app传identity；B负责键盘与公共CSS。本Q不改故事包、契约、shell、SQL或其他测试。

四套原创SVG场景：县城修车的金色街巷、独生子的暮色湖岸、归来女儿的宅门暖光、退隐歌手的蓝色海岸与后台；同一构图系统分别提供横向封面和竖屏壁纸。先县城完整，再其余。联系人采用有限手绘模板，仅官方精确title+identity与已核name+relationship配对；未知为抽象通用头像，不随机真人、不表示真实外貌。用户带入photo优先；sourcePersonId即使没有照片也不映射陌生官方人物。

## 已冻结接口

- resolveOfficialLifeArt(id) → {id,coverUrl,wallpaperUrl,label:'原创插画',alt} | null，未知ID返回null。
- resolveWorldLifeArt({title,identity}) → 同上，仅官方精确成对；不靠标题关键词绑定官方身份，不import服务端完整故事包。
- resolveDefaultWallpaper(title?,identity?)保留旧调用；明确成对才官方。个人关键词仅沿原通用素材，不误绑官方。
- avatar helper优先私有asset世界/revision URL，官方严格角色匹配才插画，未知通用；asset来源说明集中public/art/lives/README.md和helper元数据。根消费封面并显示原创插画标签。

## 验证与资源

尚未实施/运行验证；0付费模型/生图/真实数据库/生产写/部署。当前无HTTP/浏览器资源；若视觉QA需启动将先登记独占端口和空间。纯UI夹具与原创插画不代表生成照片、角色真实肖像或世界事件。代码交付先待验收，最终集成上线归现有集成人。

## 第一批实现与验证

已完成4套横封面+竖壁纸8张原创SVG、10张有限人物模板变体+1张抽象联系人图，新增life-art/avatar-art纯映射，兼容wallpaper(title?,identity?)，worldAppData仅补展示头像URL。官方完整title+identity及角色name+relationship精确配对，不import服务器故事包进入客户端；authorized photo世界/revision优先、sourcePerson无图也不使用官方肖像。每官方世界6人不同图，跨世界可复用模板；画像是装饰意象非人物真实外貌，不写World/Memory/相册/事件。已响应I反馈移除SVG可见字，退圈封面单独裁切上半/2/3乐器，发型/轮廓/色彩装饰细化。

本Q实际新专项9项，连world-app-data/phone-visual共22/22纯测试通过，0skip/todo；typecheck通过；模块边界325通过；npm run build成功exit0、23静态页。三个兼容/头像文件原调用保持，私人原图avatar与album既有专项通过。源码专属格式/diff通过。完整npm run check含rls-tenant-isolation、character-image-flow真实数据库连接/写夹具，超本Q明确0DB范围，由根最终联合验收；不冒称本Q全check或真实PG通过。root已认可focused/typecheck即可，最终完整check/build/迁移/public仍归I。

首张素材contact sheet在忽略.local/ui-preset-art-02q/evidence。3296开前无监听/无任务冲突，已短锁登记Q独占静态art预览端口和新Ego空间，API全部拒绝不转发。正在准备390长短与PC裁切观察，仅素材preview，不是正式产品、真实世界/软键盘验收。本批未动公共CSS、phone-shell、official包、SQL或contracts，根尚需把identity传wallpaper并共用cover。

原头像组件onError回退字母位于apps/messages.tsx，超本Q范围未改；新增模板会正常显示，授权photo失败不应自动替陌生官方人像。如需加载失败改generic应由I协调该组件，不能借本批改其他文件。assets/helper和本报告先提交接口ready给I，视觉证据及最终待验收报告另补；不推main或部署。
