# SCENE-HOME-08 · 首页独立现场应用

负责人 scene-home-08-20261027 / 子任务 scene_input_experience；独立工作树 `.local/worktrees/scene-home-08`，分支 `codex/scene-home-08`，基线 `ad1714e2`。root 唯一集成，实际页与3218/3219/模型操作均归root。按用户本轮要求仅本地，不部署。

## 根因

现有desktopApps已经含scenes、PhoneAppView已有SceneIndexApp、phone-icons已有现场图标，却在两处被屏蔽：phone-shell dock主动filter scenes；navigation.activePhoneRoute把无target的scenes应用直接改回home。自定义PhoneDesktop只画小组件，底部真实App dock仍由PhoneShell渲染，没有另一处自定义home filter。

## 落实

- 首页dock恢复六个真实App（含现场），无target的scenes路由保留并进入原SceneIndexApp；不新增App类型/数据字段/平行路由。
- dock仅调整六列与图标尺寸（正常最多50px，短屏最多38px），日历数字在更紧的App图标里自适应，保持原桌面/PC手机外框。
- 现场应用展示当前现场：根据已有history/map版本选择有效当前scene，按钮只导航读取，不重新调用appointment enter或生成环境。
- 没有进行中现场而位置已知时，显示当前地点和显式“进入这里的现场”按钮，调用原map.enterPlace；不是点击App就创建场景。
- 位置未知、时间暂停、busy/working、pending/unknown行程不能作为新入场授权，提示并保留地图核对入口。
- “前往地点”复用地图target选择与原路线确认，不点击就移动、不伪造人物到场。已有确认约定/历史分页/记录均保留，历史只读打开。
- 新纯sceneHomeEntry仅把现有授权投影整理成入口展示策略，不产生模型调用、任务、轮询或事实，不加入新持久字段。

## 验证

NEW `tests/scene-home08.test.ts`5项：实际PhoneShell SSR含六App现场按钮/active route保留；SceneIndex组件SSR当前位置入口与前往地点、渲染不调用travel/entry；现有scene在暂停/操作时仍可只读打开；未知位置/paused/busy/pending/unknown不入场；新版本投影不借用旧已离场场景。

旧phone-visual-ui测试此前自己filter scenes并宣称5App，会在真实dock恢复后仍假绿；本批更新该用例为六个真实App的唯一性/功能集合，保留其他视觉断言。

聚焦 `scene-home08 + phone-navigation + phone-visual-ui + scene-index + phone-time-removal` **23/23**。`npm run typecheck`通过，`npm run check:boundaries`764 files通过，diff-check通过。

0真实模型/原档写/运行端口/生产操作，0后端/SQL/新请求轮询。SSR和纯策略测试不等于手机/PC浏览器完成；root统一check/build加载后，需实测首页图标→现场App→当前现场/当前位置进入→地图前往→历史回看以及小屏dock。公共时间策略未改，不借此改变既定12x/1x规则。
