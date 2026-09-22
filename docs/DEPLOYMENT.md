# 部署接续

2026-09-22，用户已要求上传GitHub并部署。代码仓库为私有仓库：
https://github.com/limengzhe27-boop/parallel-life

当前代码已推送main，尚未部署到云端。Github与Vercel CLI已登录，但没有为本项目配置云数据库、Worker或持久私有存储。已向用户询问部署目标；不得使用探索原型的生产数据库或环境。

## 完整运行需要

1. 独立PostgreSQL，迁移0001至0006及pl_app/pl_worker运行角色。现有db:migrate只面向本地开发库，生产迁移入口需按托管目标适配，不能直接套用本地脚本。
2. Next.js网页/API服务，HTTPS域名和与其一致的APP_ORIGIN。SESSION_SECRET在平台密钥管理中单独生成。
3. 常驻Worker，使用WORKER_DATABASE_URL，与Web分开启动。普通Vercel函数不能直接运行现有持续循环Worker。
4. 私有素材持久磁盘或对象存储。当前PrivateDiskStore面向持久磁盘，Vercel临时文件系统不能作为永久照片存储；如采用Vercel必须配套独立存储适配。
5. 模型配置由服务端密钥注入，不能提交.env.local或把本地数据库地址用于生产。网关后台启动曾被自动审批拒绝，具体资料外传确认仍见D-06，不把“上传部署”自行等同于该项已确认。

## 当前选项

- 用户提供独立服务器/云平台：准备对应Web、数据库、Worker与持久存储部署，实际验证后交付完整地址。
- 用户选择Vercel网页预览：仅发布可预览界面，并明确未接后端；不能称为完整产品部署。

当前未新建付费云资源、未迁移本地用户资料、未上传密钥或用户照片。此次GitHub上传检查194个被跟踪文件及552个历史对象，未发现当前环境密钥；.local与.env.local未被跟踪。
