# SCENE-IMMERSIVE-01B · 沉浸式现场背景层

负责人 scene-backdrop-20261026；基线 023f048a；独立分支 codex/scene-immersive-backdrop。root 唯一集成，本文不表示整体界面或生产已交付。

## 实现

- SceneStage 保持原接口，由卡片改为父容器 absolute inset:0 的连续满屏背景，沿用 sceneArtwork 的世界/来源/权限边界、现存场景配图与明确示意回退。
- 图片 object-fit:cover；透明上下暗化提供可读性，不添加白色聊天底板。不调用模型，不新增字段/迁移。
- 实际在场角色继续通过头像、姓名和公开简介展示，可调用原 onSelectPerson 写入搭话对象。缺图显示姓名首字，不创造立绘，不把人物头像拉伸成全身。
- SceneFace/SceneMedia 导出保持兼容；SceneMedia 使用深色透明背景，适配新的舞台。
- 背景容器 pointer-events:none，只有人物控件 auto。root 阅读/输入区应在 z-index:2，上部人物按已有 stage 层显示；不要把完整 stage 放入滚动记录。

## 素材审查

PhoneContact 只有 avatarUrl 与 publicProfile.appearance；PhonePhoto identity 没有透明立绘/半身/全身语义。项目虽有三视图本地素材，但没有可授权运行时立绘绑定。故本批未新增 portraitUrl，未按人物姓名硬编码素材。实际档无立绘时仅背景+在场头像。后续若要概念图中的人物大图，需要正式制作/绑定受授权立绘；不能声称本批已完成。

## 接口与布局

SceneStage 仅依赖现有 read/contacts/photos/onSelectPerson。父容器 position:relative，stage absolute inset:0,z0。按root最新接线，顶图标签48px、地点标题10px、头像区64px；短屏容器450px以下标题8px、头像64px。root 顶部 controls 为z4，readingArea底部54%/z2；若另设地点标题可由root删去重复caption。

## 检查

- npm run typecheck：通过。
- node --experimental-strip-types --test tests/scene-stage-presentation.test.ts：11/11。
- prettier：通过。
- 未构建、未启动、未模型调用、未生产写、未部署；手机/PC真实几何与交互交root集成验收。
