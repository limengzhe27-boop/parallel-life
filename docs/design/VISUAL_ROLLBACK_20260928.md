# 视觉改版前回退点

2026-09-28，源代码改动前保存。

- Git 提交：13b8b2e06a4659e7ea7049fb94e9bc691be1acea。
- 标签：before-visual-20260928，已推送 origin。
- 原生产部署：dpl_2pMSphALfAvSya8UucLgS7i2Ft96（READY）。
- 独立地址：https://parallel-life-nekd0kw7k-limengzhe27-boops-projects.vercel.app。
- 本地代码归档：.local/before-visual-20260928.tar.gz；Git bundle：.local/before-visual-20260928.bundle。

快速恢复线上：在本项目 Vercel 中将上述部署恢复为生产部署；若平台不允许提升旧部署，从标签建立独立分支重新部署。
恢复开发代码：从标签建立独立工作树，或撤销视觉改版提交。不要直接清空当前工作区，不覆盖后续其他人的修改。

此备份仅覆盖代码和部署定位，不是数据库备份。此次界面改版没有数据库迁移，不回滚用户资料、对话和分支。
