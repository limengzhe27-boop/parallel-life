# SCENE-PORTRAIT-MATTING-01 服务端人物去背景

2026-10-26；portrait-matting-20261026；独立工作树 `.local/worktrees/portrait-matting`，分支 `codex/portrait-matting`，基线 `1e989d83`。root 唯一集成。本批不修改HTTP、世界状态、图片投递、数据库或本地运行端口，不部署。

## 接口和职责

- `application/portrait-matting.ts`：`PortraitMatting` 端口。
- `infrastructure/portrait-matting.ts`：`LocalPortraitMatting` 和共享函数 `removePortraitBackground(bytes: Buffer, signal?: AbortSignal): Promise<Buffer>`，输出真正带alpha的PNG。
- 输入先完整解码并限制10MB/2500万像素、最小32px、单帧PNG/JPEG/WebP。按EXIF转正，最长边最多2048px。拒绝非法/空图片。
- 已透明且具有足够透明区与不透明主体的图片仅规范PNG，不加载模型、不请求网络。全透明图拒绝为 `EMPTY_PORTRAIT_IMAGE`。
- 其余图片由真实MODNet人像分割推理；不是颜色阈值抠图。校验输出存在足够透明像素与可见主体，不接受全白/全透明/全不透明结果冒充立绘。
- 模型惰性加载，固定 `Xenova/modnet` revision `fa2fa546052fba4c08921230a26cc69a333fca12`；依赖固定 `@huggingface/transformers@4.3.1`。缓存 `.local/model-cache/portrait-matting`，不把人物像素上传到Hugging Face。网络只下载固定公开模型文件。
- 全进程并发1，最多4个已接纳请求，ONNX CPU intra/inter threads各1、sequential执行。排队中取消不会启动解码/推理；运行中abort立即拒绝调用方并丢弃结果，但原生推理仍须自然结束后才允许下一个任务，避免堆叠CPU。
- 普通聊天/启动不初始化模型；只有调用该函数处理不透明图时才动态导入推理依赖。无外部付费调用、无新业务字段/表/队列。

## 实际样本验证

使用root真实项目Grok输出 `.local/local-play/provider-stage-probe.png`（原图含画出来的棋盘格，且没有alpha）和项目青青头像：

|样本|实际结果|墙钟|RSS增量|
|---|---|---|---|
|Grok输出864×1152|PNG、alpha0–255，深蓝背景合成确认原棋盘格已去除、主体完整|47,011ms（含首次模型下载/初始化）|330,317,824 bytes|
|项目头像640×640|PNG、alpha0–255，原绿树/街景背景已去除|648ms（同进程热模型）|11,960,320 bytes|

固定模型缓存约25MB。图像/测量JSON只保留在独立树忽略目录 `.local/matting-*`。逐张检查了透明像素数值和深蓝底合成效果：头发有轻微浅色边缘，尚不称专业级逐发丝抠图。抠图不会补出输入中没有的身体，也不负责生图的人物一致性。

复测脚本（写入目标必须不存在）：

`node --experimental-strip-types scripts/verify-portrait-matting.mjs input-image output.png`

该脚本不调用付费模型、不修改数据库，只处理指定本地图片，打印时间/CPU/RSS/alpha证据。首次会下载固定模型，已缓存后不重复下载。

## 必要验证

- `tests/portrait-matting.test.ts` 4/4：已有alpha逐像素保留、全透明/非法/字节上限拒绝、已取消请求、像素/最小尺寸上限；不下载模型。
- 两张实际图像已通过真实ONNX分割，不以单元夹具冒充真实效果。
- `npm run typecheck` 通过。
- `npm run check:boundaries` 731 files通过。
- npm audit所报8项来自既有next/sharp/zod/vercel依赖链，本次新增HF链未新增列出的告警；未自动升级项目其他依赖。

## 主 Agent 集成与限制

1. 合并package与源码后安装锁定依赖；当前独立树的node_modules没有改root。
2. 可把本独立树 `.local/model-cache/portrait-matting` 复制到root同路径，避免第一张生图之后才开始47秒下载，超出图片请求总预算。
3. 调用者应在付费生图完成后先持久保存原图，再调用本函数；失败/取消不意味着需要重新生图。
4. Next正式构建尚未由本子任务运行；推理包/onnx原生绑定可能需要root配置 `serverExternalPackages`，以最终构建证据为准。由于用户目前只要求本地运行，未将约315MiB冷初始化峰值与服务端推理成本称为适合Vercel免费CPU。
5. 本模块不解决作者原始图/生成成品的上传授权和unknown恢复；由root与LOCAL-STORE任务接线。无法保证任意复杂遮挡/多人物照片的分割质量，当前按单个人物素材使用。

## 模型来源与许可

- 模型卡： https://huggingface.co/Xenova/modnet （Apache-2.0）
- 固定版本： https://huggingface.co/Xenova/modnet/tree/fa2fa546052fba4c08921230a26cc69a333fca12
- 上游当前许可证： https://github.com/ZHKKKe/MODNet/blob/master/LICENSE （Apache License 2.0）

未使用旧CC-BY-NC结论作为当前许可；以上均已读取主来源。后续生产部署仍应随其依赖保留许可说明。
