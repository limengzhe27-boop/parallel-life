# WRITER-UX-10Q：总体设定作者主框

2026-10-13；Agent codex-writer-overall-10q-01a0c7c8-20261013；待验收。原独立photo-compose-02/codex/writer-overall10-q自ca49787；主表短锁领取已确认。root唯一集成，B图投影/plot，root图UI/import/服务；Q不改其文件。

## 已实现及作者行为

- 总体设定与作品标题成为主输入；旧多项细框收进“玩家进入后看到的内容 / 发布展示”，已整理故事另行折叠，地点/开场等旧信息继续可查可改。主框为空只显示提示，不塞模板。时间安排保留为折叠按需操作。
- 旧稿没有专用原稿时，从既有八组设定汇总回顾，明确“不是原始文稿”，不会因打开页面另存或改写；首次编辑才写私有作者扩展。原文字不裁剪，换行与首尾空格保留；空字符串也是明确编辑，不自动恢复旧回顾。
- 总体稿保存只动editorial extension，原公开背景、人物、剧情、秘密、其他扩展均不自动改动。界面明确总体稿不会直接改变玩家世界；“根据总体设定整理”只作补充，核对后填入，已有人物/剧情不会自动重写。改写已有信息仍需展开核对修改。
- 明确点击整理只打开root真实导入组件，传initialOverallText，模型调用和确认由root组件负责；普通导入/关闭清除该种子，导入应用后重新读实际稿，换作品/版本清局部状态。不自动调用模型、保存、试演或发布。
- 超长输入完整保存在当前编辑框，没有maxLength或截断；显示自然字数与人话提示。不能保存/整理时阻断旧草稿的误保存、保持dirty离开提醒；精简到可保存后正常更新草稿。只读与忙状态回调本身也拒绝修改。

## 冻结纯接口与真实限制

文件src/features/publisher/publisher-overall-setting.ts：

- OVERALL_SETTING_NAMESPACE = parallel_life.authoring_overall。
- readOverallSetting(content)返回{text,source:'authored'|'existing'|'empty',problem?}。
- updateOverallSetting(content,text)返回{ok:true,content}或{ok:false,reason}；reason为invalid_extension/ambiguous_extension/extension_limit/extension_budget/extensions_budget/content_budget/invalid_content。
- 新扩展version1、purpose editorial、description“作者总体设定原稿”、data{text}。发现重复命名、未来版本、非editorial、未知数据结构时不覆盖。其他扩展与原数据保持原样；无新增公开字段。
- 已核对实际PublishedWorldContentSchema并获root确认：namespace只接受下划线形式，原建议连字符非法；extensions最多8项。每份JSON data UTF8最多8192字节、全部data合计16384、全稿65536且服从既有storage结构约束。包含JSON转义与多字节字符，不以固定中文字数冒充预算。没有改schema或放松发布限制。
- 这是前端私有草稿编辑helper；真实API/RLS/编译结果对玩家隔离仍需root集成验证。未把编辑器保存成功等同运行内容已更新。

## 改动文件与依赖

本人源码：publisher-workbench.tsx、publisher-workbench.module.css、新publisher-overall-setting.ts。
本人测试：publisher-workbench.test.ts、新publisher-overall-setting.test.ts。文档：本报告，主目录本人行/报告镜像。
登记允许的publisher-editor.ts及其测试未改，只复用现有字段保留逻辑并运行回归；未改plot/domain/contracts/import。

root真实依赖e0eb210在本树cherry-pick为8904f90（import-dialog及其测试），仅供类型与接线验证，不属于Q交付；集成时仅接Q独立提交，不重复接这个依赖。

## 验证结果及局限

- 40/40专项通过，0跳过：publisher-workbench、publisher-editor、publisher-overall-setting。
- 纯helper7项覆盖：旧稿与空稿、首编写入/清空、合法schema扩展包、公开/幕后与其他内容不动、重复/未知拒覆、中文/emoji/引号/换行的UTF8与转义边界、8项/合计/全稿预算、非法JSON拒绝。
- 界面新增覆盖：总体编辑仅显式保存、公开/秘密不改写、超限末尾完整留文且不能误保存旧内容、缩短恢复、整理只开真实组件且普通导入清种子、忙/只读拒绝。保原导入keepOpen、发布权限/版本/hash/媒体/试演、安排时间等相关回归。
- 初次35/36，唯一失败为旧“空稿展开八细框”断言；改为默认总体主框、发布细项折叠后最终40/40。首次type因root可选prop未接而失败；接e0eb210真实依赖后npm run typecheck通过。5个本人源码/测试Prettier检查、git diff --check通过。
- 这些是纯函数及SSR/Hook合成UI验证，未进行真实模型、PostgreSQL、浏览器、生产或部署操作；无付费调用，不冒充真实Repository或端到端验收。未跑全check/build，依任务分工由root统一运行。

## 集成人接续

接Q独立提交后，root把图UI与B投影一并接入；复核总体稿新旧回读、私有扩展不进入玩家/公开目录、整理仅补空且双确认/旧baseline有效、超长输入末尾保留及保存阻断。手机/PC主视图仅标题+总体稿、细项折叠和原地点长文可达；真实数据库保存回读、全check/build、READY正式alias公网实测后再标完成。长篇上传原稿不强塞此容量较小的扩展，完整原稿仍由root整理回执保留核对。Q冻结不续领、不自行部署。
