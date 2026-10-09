# PHONE-HOME-02 · 手机桌面与直接返回

2026-10-09，codex-main-phonehome02-20261009。独立界面候选待集成；未接正式首页，未上线。照片功能必须先完整验收再发布本项，这是用户本轮明确要求。

## 实现范围与接续

复用已停止、干净的managed lock-02-notifications工作树，新分支codex/phone-home-02，从9eb4480开始，未改原chat-photo分支。仅新增phone-desktop.tsx及phone-desktop.module.css。当前无调用者，由现有唯一集成人在照片交付后串行将WorldPhoneSurface的renderHome替换为PhoneDesktop；传入title、phoneData、open及openPanel。不修改任何聊天/API、资料、共享契约或持久化逻辑。

桌面顶部两个44px点击入口：返回直接到既有聊聊首页 `/`，切换人生直接到既有分支列表 `/possibilities`。这里的返回是离开手机，不是登出、删除或暂停世界；沿用既有离开行为。标题只显示当前人生，可打开身份。日历和相册两小组件读取phoneData同一授权投影：只选择当前故事时刻之后的proposed/confirmed日程，打开对应日历；只展示ready且有URL的相册照片，没有照片如实显示空态，失败图片退回图标。身份/时间/设置仍走既有面板，不新增导演改写。锁屏和底部常用应用不改。

## 验证证据及边界

独立npm run check：435项，431通过、4失败、无跳过。边界及类型检查通过；四失败均旧测试连接127.0.0.1:55448拒绝（character-image-flow两项、rls-tenant-isolation两项）。未启动、接管其他Agent数据库，未跳过失败；不能称全绿。首次npm run build通过。删除临时预览页后的第一次最终构建失败：本工作树.next/dev/types仍引用已删除的phone-home-preview-sandbox路由。该失败输出发现后已立即更正给集成人；仅清理本工作树生成的.next/dev缓存，再次npm run build真实退出0。随后重新npm run check仍为435项、431通过、4项旧数据库连接失败，退出1；边界和类型检查通过。日志工作树.local/phone-home-02/{build-final,build-recheck,check-recheck}.log。保留失败记录，不将首次报告误写的“最终构建通过”作为事实。

Ego空间88、专用Next3250。临时phone-home-preview-sandbox页面明确标“本地合成界面测试 · 无数据库／模型”，使用实际PhoneShell/PhoneDesktop，不调用真实AI、不读取用户照片。用项目插画标为合成图库，仅验证布局，未冒充生成图。此临时路由已删除，不提交；原开发进程已停止。首次关闭空间误传keep:false被拒绝，改keep:[]释放；不会修改他人空间。

实际浏览器验收：

- 390×844首页无横向溢出，桌面两个入口、两小组件与3工具清楚可见。
- 第一次390×560观察到工具标签被Dock裁切，修正小组件高度及间距后desktopBottom418.05、dockTop432，标签完整可见，仍无横向溢出；不是忽略缺陷或只保留最初截图。
- 1440×900为420px居中手机，无横向溢出。
- 日历组件正确跳过更早的已过期和已取消邀约，实际点击打开calendar/next；桌面返回手势正常。
- 实际点击“切换人生”导航到本地/possibilities；点击“返回”到本地首页，不必进设置。
- 最终截图 /tmp/phone-home-02-390-final.png、/tmp/phone-home-02-short-final.png、/tmp/phone-home-02-PC.png（合成测试，非公网）。本报告引用内部定位，只供项目验收。

## 未完成

实际world-phone-app调用接线、旧世界和空相册/无有效日程的真实投影验证、生产完整check/build、38生产迁移一致性检查、提交推送、READY及正式公网双端验证。由现有集成人照片收尾后接续；这两个新增界面文件不等于已交付上线。不开始视觉模型、前史或地图等新任务。

## 2026-10-09 接续：实际页面接线与独占真实库验收

用户要求根协调也参与开发，已通知I暂不挂载旧候选，根接回本人任务。在原 managed 工作树新建 codex/phone-home-02-integration，从eabd025接入f65c647、2c6bbe7（原ce3f10e/758366b的等价提交）；新增修改仅world-phone-app.tsx的import与renderHome、phone-desktop.module.css的500px短屏规则、本报告。未改照片、访谈、公共契约、迁移或真实用户数据。旧历史报告保留，下面是接续结果而非重写此前失败。

实际WorldPhoneSurface/PhoneShell使用PhoneDesktop并传入phoneData/currentReferenceTime，生产入口能够到达首页；日历和相册与原应用读取同一授权投影。返回和切换无需进设置。原锁屏、通知、Dock和管理功能保持既有行为。

独占资源PG55456/HTTP3251/Ego89；发现55451已有他人进程，不触碰。首次尝试启动本工作树旧postgres目录因密码不匹配失败；核对本工作树目录及55456后停掉仅本次启动进程，保留旧数据，改用.local/phone-home-02/postgres新目录。本地运行环境和测试日志全部忽略；没有提供真实网关凭证，仅用无效占位凭证满足服务构造，整个浏览器验收不调用真实模型。世界已暂停，避免主动节拍。

最终源码检查445/445通过，0跳过；边界与类型检查通过。独立真实PG测试92项，87通过、0失败、5明确可选模型跳过；生产build通过。修正短屏后再次check/build成功，日志为.local/phone-home-02/{check-final-integrated,build-final-integrated,db-integrated}.log。无迁移变更，生产38迁移核对仍须I发布时执行，不能把本地数据库当生产。

两个合成访客世界通过实际BuildRepository/世界创建handler/WorldPlanner注入合成输出建立、事务保存；一个相册与日程为空，另一个由实际世界回合提交邀约，并经AssetRepository上传项目插画到私有相册，独立账号读取两个世界均NOT_FOUND。是实际数据库投影与上传，但不是AI创作/真实经历。第一次合成夹具只给2位人物，原校验INVALID_ACTOR拒绝并未建世界；改成3位后通过，没有降低生产校验，失败任务保留在独占本地库。

实际生产构建页面浏览器验证（非临时预览路由）：

- 390×844真实解锁：返回/切换、身份、日历、实际私有相册图片与3工具可见；无横向溢出，图片naturalWidth>0。
- 长标题390×560：desktopBottom392.55、dockTop432，入口不重叠；标题受控省略，完整可访问名称保留。
- 首次390×500：desktopBottom392.55超过dockTop372，发现重叠；新增局部max-height550规则后352.80<372，无溢出。
- 实际点击日历小组件打开正确邀请详情（标题、时间与参加人），未替用户确认；点相册打开同一实际上传的照片。
- 空世界显示暂无待办日程/还没有照片，未补假内容。
- 实際点击切换人生到/possibilities，点击返回到/，不是退出账号或删除世界。
- 1440×900居中420px，无横向溢出；desktopBottom552.94<dockTop740。
- 暂时隐藏仅本任务合成相册文件，图片读取失败后回退“打开相册查看”；finally恢复文件、刷新后图片正常加载。第一次等待调用参数错误，改为文档要求的第三参数后确认回退与恢复；不把脚本错误当产品失败。
- 截图/tmp/phone-home-02-integrated-final.png、/tmp/phone-home-02-live-500-final.png、/tmp/phone-home-02-live-PC-final.png；插画属本地合成测试，不表示生成照片完成。

Ego提示可选版本更新，本轮未升级；任务89已finish keep=[]关闭。独占HTTP/PG停止后交稳定提交给I；集成/推送仍先照片反例公网验收完成再首页。正式公网、照片最终基线与旧用户回归尚需I关闭，本任务仍待验收，不标上线完成。
