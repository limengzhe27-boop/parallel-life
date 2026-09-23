"""Static prompt-contract checks, not live-model dialogue-quality acceptance.

These guards catch accidental removal of the generic dialogue rules. They make
no provider calls and do not assert that a model will always follow the rules.
"""
from parallel_life.providers import TASKS


def test_decisions_allow_conversation_without_forced_story_action():
    policy = TASKS["decide"]
    assert "普通交流可以wait" in policy
    assert "后续reply仍正常回应" in policy
    assert "不要为了推进剧情而每轮propose" in policy
    assert "不重复已说过的邀约或承诺" in policy


def test_current_intent_outranks_old_goal_without_inventing_user_position():
    assert "用户改变方向时尊重当前意图" in TASKS["decide"]
    policy = TASKS["reply"]
    assert "当前明确表达优先于过去偏好、角色goal和既有提议" in policy
    assert "先回应用户刚提供的新信息" in policy
    assert "不是每轮台词脚本" in policy
    assert "话未说完或含义不清时简短追问，不替用户补立场" in policy
    assert "避免重播自我介绍" in policy


def test_branch_generation_does_not_invent_precise_shared_history():
    policy = TASKS["branch"]
    assert "已知真实人物的共同历史只取自past" in policy
    assert "不补具体关系年数、共同往事或用户原话" in policy
    assert "未知关系细节保持概括" in policy


def test_reply_has_historical_knowledge_and_evidence_boundaries():
    policy = TASKS["reply"]
    assert "以context.world.date为时间边界" in policy
    assert "没有资料来源时表达未知或待查，不声称已经核验" in policy
    assert "旧台词和agent_inference不构成用户经历的独立证据" in policy


def test_memory_does_not_promote_role_speech_to_user_biography():
    policy = TASKS["memory"]
    assert "角色自述只说明角色说过什么，不是用户确认的人生事实" in policy
    assert "不把旧台词当作新的独立证据反复提取关系史" in policy
    assert "保留变化及其来源" in policy
    assert "不替未说完的话补意图" in policy


def test_summary_keeps_speakers_uncertainty_and_changed_preferences():
    policy = TASKS["summary"]
    assert "保留说话者归属" in policy
    assert "不改写为用户事实或共同经历" in policy
    assert "保留用户方向变化" in policy
    assert "未说完的话保留未定状态" in policy
    assert "不把重复邀约写成进展" in policy


def test_dialogue_contracts_keep_existing_json_fields():
    assert "kind:'wait'|'propose'|'tell'|'promise'|'cancel'" in TASKS["decide"]
    assert "{text:string,image_prompt:null|string}" in TASKS["reply"]
    assert "source_type:'user_statement'|'event'|'agent_inference'" in TASKS["memory"]
    assert "source_ids:[string]" in TASKS["memory"]
    assert "返回{text:string}" in TASKS["summary"]


def test_router_classifies_only_current_explicit_tools_and_keeps_chat_default():
    policy = TASKS["route"]
    assert "默认chat" in policy and "不推动世界" in policy
    assert "提到照片、讨论绘画不是索图" in policy
    assert "不把想法、假设、希望或提问当已作出的选择" in policy
    assert "source_quote必须是当前input的连续原文" in policy
    assert "不推测隐藏动机" in policy
    assert "parked_topics" in policy


def test_role_card_is_a_source_bound_projection_not_a_new_biography():
    policy = TASKS["role_card"]
    assert "identity:string,voice:string,stance:string" in policy
    assert "不是新人物创作" in policy and "缺少资料的字段留空" in policy
    assert "删除每轮评估、讲解政策、安排任务等流程性表述" in policy
    assert "已有voice，就逐字保留" in policy
    assert "不提供示范台词" in policy


def test_branch_persona_is_human_and_goal_is_separate():
    policy = TASKS["branch"]
    assert "persona描述身份、性格与价值观" in policy
    assert "程序性目标只写goal" in policy
    assert "voice用简短文字描述自然说话方式" in policy


def test_role_card_stance_is_cross_topic_attitude_not_procedure_or_relationship_copy():
    policy = TASKS["role_card"]
    assert "stance只写换个话题也成立的待人态度" in policy
    assert "stance不重复关系年数、职业业务、能力评价或办事流程" in policy
    assert "人物关系由调用方单独提供" in policy


def test_proactive_route_is_opt_in_source_bound_and_rejection_aware():
    policy = TASKS["route"]
    assert "proactive_image_subject" in policy and "allow_proactive_images为true且mode为chat" in policy
    assert "必须逐字取自当前input" in policy and "不使用旧记忆、秘密或其他角色信息" in policy
    assert "用户本轮拒绝图片" in policy and "主动配图不是每轮必做" in policy
