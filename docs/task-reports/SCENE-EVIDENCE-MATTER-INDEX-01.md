# SCENE-EVIDENCE-MATTER-INDEX-01

根2026-10-12；独占planner与newmatterindex测试，基线0de9bad。真实说明原任务85,125ms response TIMEOUT/unknown，resultVersion null，仅新input v6；核对仍保存。确认原任务后单次manual复测7793ms failed/INVALID_AI_OUTPUT，固定diagnostic scene_step_evidence:matter_id；所有预算保留，保守12/18，不称完整链通过。

新增仅内部显式indexed-observations-v2：step.matterIndex必须取本次已授权structuredStepContexts列表的整型序号，adapter映射已有world matterId；observationIndex仍引用实际原观察段。禁止mixed matterId/旧quote，非法/缺失/越界/无对应context拒固定matter_index，无实际值泄露。旧v1/classic照原条件拒坏ID，不推测修复。原文、动作、观察、receiver、否定未来、source和交易规则保持，NPC不能由导演代执行。没有自动模型纠错或新调用，也不修改domain/公共contract/SQL。

新测试首轮正确映射测失败因测试用pending action误接领域resolved契约，修正fixture为实际resolved/event；未来句反例精确断言Unsupported player execution quote，保留强拒绝而不误以source失败作语义通过。后续纯检查/真实PG/上线证据待追加。

根最终968check/332边界/type0/build0通过；新版v2wire实际PG8/8（合成提案非供应商）。Q投影独立反例在途；准备发布候选，未READY/public前不标交付完成。
