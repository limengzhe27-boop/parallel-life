# WRITER-UX-12-CLEAN-B 截图指定内容删除

负责人 codex-writer-clean12b-01a11a84-20261013，独立 publication-story-02/人生剧本，codex/writer-clean12-b，基线640747e。用户在本线程截图明确要求删除；不启动另一线程讨论中的整体重构。

删除总体设定“根据总体设定整理”按钮下方说明文字，以及“查看已整理的故事”折叠区和其中的预览，移除不再使用的PublisherReviewView导入，共8行业务源码删除。总体输入、整理按钮、玩家展示编辑、人物和剧情入口、导入核对及全部保存/发布守卫保持原样；没有删除草稿数据。

验证：

- 完整 npm run check 确实运行，423边界/type通过；首轮2118项中2112pass、6fail、0skip。四项是旧本树.env指向已停本地55478导致ECONNREFUSED：album-workflow的unconfigured media generation与M-04 shared uploads两项、rls-tenant-isolation两项。另两项为本次删除预览后必须适配的旧workbench断言，不归因于数据库。
- 已仅适配原有两项workbench测试：默认页不再要求故事概览、断言截图两块已移除；导入不自动保存且回到总体设定，实际作品标题和公开设定仍显示导入后的值，不再查找已删除组件。原23/23 workbench专项通过。此适配完成早于root建议由其接手的交叉消息，已回传说明。
- npm run build退出0，格式与diff检查通过。最终完整check由root已启动的独立55476环境统一复验，不称本树全检查通过。
- 0数据库业务写、0模型、0浏览器、0生产修改；手机/PC、READY与公网验证交唯一集成root。当前待集成验收，不称上线。
