# 44-161-DIRECTOR-PREFLIGHT

状态：待集成验收。独立工作树 director-preflight161，基线 fb950ccb；root 唯一集成、真实验收与部署负责人。

## 原因与改动

三个授权原失败帧实际是本地 model_preflight_rejection，不是导演模型生成的不合格输出。完整请求分别 84447、85409、85409 字符；Director 允许 96000，但共享网关只允许 64000。原 runner 在网关检查前记录 sent，使本地未发送被混入已消费记录。

统一 model-content 与 Director 的请求总文字预算为 96000；不删除人物、作者事件、计划、状态。提取 application/model-request-policy.ts 纯函数，统一消息、图片、输出 token 与 response schema 预检。Director.validateInput 使用实际请求的全部消息、4096 token 和真实 schema，原 runner 已在创建新 attempt/发送标记之前调用此接口，无需新增执行路径或修改 runner。

Yibu complete 与 streamComplete 共用同一预检。保留 schema 24000 字符、输出 token 256–16000、图片大小和格式约束。安全错误只包含 reason/actual/limit 与 not_sent，不含输入正文或密钥。

不修改旧 response、hash、expected version 或已付费结果。历史可信未发送记录恢复由 root 的独立仓储改动处理；真正 unknown 不能由本补丁重试。

## 必要验证

- 六组聚焦测试共 58 项通过：request policy、vision、gateway、Yibu、Director model/runtime；旧 64001/66000 超限夹具调整为共享上限+1，保留超限零发送断言。
- 边界检查通过（664 文件）。TypeScript 检查通过。
- 三个原受保护 snapshot 离线执行完整 validateInput 与 gateway：全部保留原文字长度，schema 分别 16188/16240/16240；均通过预检，到达禁用网络的注入 transport stub。stub 主动抛错，实际 HTTP/模型调用为 0。未保存或输出正文。
- 不做全量重复测试、SQL、生产写入或真实模型。check/build、数据库恢复旅程与公网验收由唯一集成人负责。

## 接续

root 集成后需结合可信 preflight 无发送恢复，验证原实例能再次获得合法导演评估机会；本提交单独不能宣称原存档主动开场已恢复。超过 96000 的材料仍明确拒绝，应另以保留身份/事件覆盖的结构化压缩优化，不自动截尾。
