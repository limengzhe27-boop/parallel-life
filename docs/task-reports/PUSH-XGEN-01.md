# PUSH-XGEN-01

用户要求将项目推送至 XGEN-Labs/parallel-world-demo，后补充只推项目相关代码，排除测试、任务、秋招等无关材料。

- 来源主分支：54be25c05d3fb79f80639ceb530e63a86c7af392。
- 独立导出目录：.local/xgen-code-export-20261023，不修改原项目功能或旧 origin。
- 目标 main：92cf3fac0980edcd3cf03070cab30c44f96fad6b，独立单个 root commit，947 文件。
- 保留 src/public/db、必要配置、local/migrate 脚本，重写仅运行说明 README；去掉 tests/docs/任务报告/AGENTS/旧kit/verification截图/GitHub定时工作流/验收脚本。package/tsconfig 去测试入口，保持构建命令有效。
- 初次完整 main 推送已在用户补充前完成；如实说明后用精确 force-with-lease 只替换该新仓本人刚创建的分支。旧仓/用户数据不改。
- 独立 npm run check（719 源边界+typecheck）和 npm run build 成功；源码/素材/SQL 内容逐字节匹配来源，仅必要清理配置与 README 不同。保留原迁移 checksum，不修已有空白格式。
- GitHub API 验证 main SHA 一致，main 可达历史仅 1 commit；完整 recursive tree 947 blobs，排除目录/凭据/秋招文件均为0。
- 0 模型、0 数据库写入、0 线上业务部署或世界发布。新仓库未接管 Vercel，仍由44-198单独管理部署来源。
