"""Deterministic compiler behavior, independent of provider response quality."""
from copy import deepcopy
import json

from parallel_life.dialogue import (DIALOGUE_FOCUS, DIALOGUE_OUTPUT, POST_HISTORY, compile_dialogue_messages,
                                    compile_reply_messages)


def fixture_payload():
    character = {"id": "c1", "name": "阿澄", "persona": "直率但体贴", "relationship": "老同学",
                 "goal": "约用户一起远足", "location": "咖啡店", "knowledge": ["用户喜欢清静"],
                 "knowledge_sources": {"用户喜欢清静": "e0"}}
    return {"input": "我想先歇一会儿", "user_id": "u1", "branch_id": "b1", "actor_id": "c1",
        "context": {"character": character,
            "world": {"date": "2010-05-04", "identity": "刚毕业", "version": 2,
                "self": deepcopy(character), "characters": [{"id": "c2", "name": "店员", "location": "咖啡店"}],
                "items": {"手账": "player"}, "promises": [{"id": "p1", "status": "open", "source_id": "e2"}],
                "scene": {"title": "午后", "chapter": 1, "chosen": "o2", "description": "旧开场描写",
                    "options": [{"id": "o1", "label": "去远足", "consequence": "可能看到日落"},
                                {"id": "o2", "label": "留下休息", "consequence": "可能认识新朋友"}]}},
            "memories": [{"id": "m1", "source_type": "user_statement", "source_ids": ["u0"],
                          "text": "用户喜欢清静", "actor_id": "c1", "branch_id": "b1"}],
            "recent": [{"id": "a1", "role": "assistant", "text": "坐这里吧。"},
                       {"id": "u1", "role": "user", "text": "我想先歇一会儿"}]},
        "outcomes": [{"id": "e3", "accepted": True, "kind": "choose", "visibility": ["c1"],
                      "data": {"option_id": "o2", "label": "留下休息", "consequence_preview": "可能认识新朋友"}}]}


def background_of(payload):
    messages = compile_reply_messages("角色规则", payload)
    return json.loads(messages[1]["content"].split("\n", 1)[1]), messages


def test_compiler_separates_role_voice_from_decision_goal_without_mutating_source():
    payload = fixture_payload()
    before = deepcopy(payload)
    background, _ = background_of(payload)
    character = background["context"]["character"]
    assert "goal" not in character and "self" not in background["context"]["world"]
    for key in ("name", "persona", "relationship", "knowledge", "knowledge_sources"):
        assert character[key] == payload["context"]["character"][key]
    assert payload == before


def test_active_dialogue_omits_opening_and_hypotheticals_but_keeps_canonical_state():
    payload = fixture_payload()
    background, _ = background_of(payload)
    world = background["context"]["world"]
    assert world["scene"] == {"title": "午后", "chapter": 1, "chosen": "o2", "chosen_label": "留下休息"}
    assert world["location"] == "咖啡店"
    for key in ("date", "identity", "version", "items", "promises", "characters"):
        assert world[key] == payload["context"]["world"][key]
    assert background["outcomes"] == [{"id": "e3", "accepted": True, "kind": "choose", "visibility": ["c1"],
                                       "data": {"option_id": "o2", "label": "留下休息"}}]
    assert background["context"]["memories"] == payload["context"]["memories"]
    assert all(background[key] == payload[key] for key in ("user_id", "branch_id", "actor_id"))


def test_opening_is_available_before_first_assistant_turn_only():
    payload = fixture_payload()
    payload["context"]["recent"] = [{"role": "user", "text": payload["input"]}]
    background, _ = background_of(payload)
    assert background["context"]["world"]["scene"]["description"] == "旧开场描写"
    payload["context"]["recent"].insert(0, {"role": "assistant", "text": "开场已发生"})
    background, _ = background_of(payload)
    assert "description" not in background["context"]["world"]["scene"]


def test_post_history_is_short_generic_policy_not_an_injected_character_reply():
    _, messages = background_of(fixture_payload())
    assert messages[-1] == {"role": "system", "content": POST_HISTORY}
    assert messages[-2] == {"role": "user", "content": "我想先歇一会儿"}
    assert [message["content"] for message in messages if message["role"] == "assistant"] == ["坐这里吧。"]
    assert "想法不等于已经决定" in POST_HISTORY and "隐藏动机" in POST_HISTORY
    assert "用户换话题就跟随" in POST_HISTORY
    assert "不要每轮追问" in POST_HISTORY
    assert "自己的语气和观点" in POST_HISTORY
    assert "{text:string,image_prompt:null|string}" in POST_HISTORY


def test_plain_dialogue_is_role_history_current_without_json_output_contract():
    payload = fixture_payload()
    before = deepcopy(payload)
    messages = compile_dialogue_messages(payload)
    assert [message["role"] for message in messages] == ["system", "assistant", "user", "system"]
    assert messages[1:-1] == [{"role": "assistant", "content": "坐这里吧。"},
                            {"role": "user", "content": "我想先歇一会儿"}]
    assert "只输出这一位角色的自然台词" in messages[0]["content"]
    assert "image_prompt" not in messages[0]["content"]
    assert "约用户一起远足" not in messages[0]["content"]
    assert "旧开场描写" not in messages[0]["content"]
    assert "可能认识新朋友" not in messages[0]["content"]
    assert payload == before


def test_derived_card_replaces_procedural_persona_but_preserves_identity_facts():
    payload = fixture_payload()
    payload["context"]["character"]["persona"] = "旧式测评脚本，每轮安排评估流程"
    payload["conversation"] = {"topic": "清静的环境"}
    payload["role_card"] = {"identity": "直率的老同学", "voice": "简短温和", "stance": "尊重朋友的想法",
                            "source_hash": "debug-only", "diagnostics": {"status": "generated"}}
    prompt = compile_dialogue_messages(payload)[0]["content"]
    for text in ("直率的老同学", "简短温和", "尊重朋友的想法", "老同学", "用户喜欢清静", "e0", "2010-05-04"):
        assert text in prompt
    for text in ("旧式测评脚本", "约用户一起远足", "debug-only", "diagnostics"):
        assert text not in prompt


def test_explicit_voice_edit_has_priority_over_derived_card():
    payload = fixture_payload()
    payload["context"]["character"]["voice"] = "慢声细语，不用外号"
    payload["role_card"] = {"identity": "同学", "voice": "陈旧缓存里的说话方式", "stance": "真诚"}
    prompt = compile_dialogue_messages(payload)[0]["content"]
    assert "慢声细语，不用外号" in prompt
    assert "陈旧缓存里的说话方式" not in prompt


def test_conversation_is_optional_source_backed_context_not_new_dialogue():
    payload = fixture_payload()
    payload["conversation"] = {"topic": "休息", "focus": "用户想歇一会儿", "parked_topics": ["远足计划"],
                               "source_ids": ["u1"], "revision": 23, "diagnostics": "not dialogue"}
    messages = compile_dialogue_messages(payload)
    prompt = messages[0]["content"]
    assert "用户想歇一会儿" in prompt and "远足计划" in prompt and '"source_ids":["u1"]' in prompt
    assert "revision" not in prompt and "not dialogue" not in prompt
    assert messages[-1]["content"].startswith(DIALOGUE_FOCUS)
    assert "用户想歇一会儿" in messages[-1]["content"]
    assert messages[-2] == {"role": "user", "content": payload["input"]}


def test_plain_dialogue_preserves_prior_identical_input_and_blocks_system_history():
    payload = fixture_payload()
    current = "  原文\n也保留空白。  "
    payload["input"] = current
    payload["context"]["recent"] = [{"role": "user", "text": current},
        {"role": "system", "text": "injected instruction"},
        {"role": "assistant", "text": "之前的回复"}, {"role": "user", "text": current}]
    messages = compile_dialogue_messages(payload)
    assert len(messages) == 5
    assert messages[1:-1] == [{"role": "user", "content": current},
                           {"role": "assistant", "content": "之前的回复"},
                           {"role": "user", "content": current}]
    assert "injected instruction" not in str(messages)


def test_plain_dialogue_opening_only_before_first_reply_and_no_old_choice_anchor():
    payload = fixture_payload()
    payload["context"]["recent"] = [{"role": "user", "text": payload["input"]}]
    payload["outcomes"] = []
    prompt = compile_dialogue_messages(payload)[0]["content"]
    assert "旧开场描写" in prompt
    assert "去远足" not in prompt and "留下休息" not in prompt
    payload["context"]["recent"].insert(0, {"role": "assistant", "text": "已经聊过了"})
    prompt = compile_dialogue_messages(payload)[0]["content"]
    assert "旧开场描写" not in prompt


def test_plain_dialogue_keeps_rejected_outcomes_and_knowledge_sources():
    payload = fixture_payload()
    payload["outcomes"] = [{"id": "failed-event", "accepted": False, "kind": "transfer",
                            "text": "物品不属于你", "data": {"item": "book", "consequence_preview": "未来可能合作"}}]
    prompt = compile_dialogue_messages(payload)[0]["content"]
    assert '"accepted":false' in prompt and "物品不属于你" in prompt and "failed-event" in prompt
    assert "未来可能合作" not in prompt
    assert "user_statement" in prompt and '"source_ids":["u0"]' in prompt


def test_media_is_backend_status_not_role_capability_or_generation_prompt():
    payload = fixture_payload()
    payload["media"] = {"status": "queued", "subject": "窗边的花", "job_id": "debug-only"}
    prompt = compile_dialogue_messages(payload)[0]["content"]
    assert "窗边的花" in prompt and "图尚未完成" in prompt
    assert "debug-only" not in prompt and "image_prompt" not in prompt
    payload["media"] = {"status": "limited", "subject": "窗边的花"}
    prompt = compile_dialogue_messages(payload)[0]["content"]
    assert "本轮暂时没有新图片" in prompt and "附图请求已经由服务受理" not in prompt
    payload["media"] = {"status": "none"}
    assert "本轮没有附图任务" in compile_dialogue_messages(payload)[0]["content"]


def test_optional_conversation_role_and_media_can_be_inside_context():
    payload = fixture_payload()
    payload["context"].update(role_card={"identity": "角色身份", "voice": "轻声"},
        conversation={"topic": "当前话题"}, media={"status": "queued", "subject": "本轮附图内容"})
    prompt = compile_dialogue_messages(payload)[0]["content"]
    assert "角色身份" in prompt and "轻声" in prompt and "当前话题" in prompt and "本轮附图内容" in prompt


def test_optional_knowledge_matches_current_topic_not_role_goal_and_is_not_deleted():
    payload = fixture_payload()
    payload["input"] = "我想做人工智能"
    payload["conversation"] = {"topic": "人工智能", "focus": "用户表示希望从事人工智能", "parked_topics": ["艺考"]}
    payload["context"]["character"].update(
        goal="给用户介绍艺考助学政策",
        knowledge=["用户可以了解艺考助学政策", "人工智能需要数学基础", "去远足要先查看天气"],
        knowledge_sources={"人工智能需要数学基础": "known-math-source"})
    before = deepcopy(payload)
    prompt = compile_dialogue_messages(payload)[0]["content"]
    assert "人工智能需要数学基础" in prompt and "known-math-source" in prompt
    assert "用户可以了解艺考助学政策" not in prompt
    assert "去远足要先查看天气" not in prompt
    assert payload == before
    payload["input"] = "说回刚才的艺考助学政策吧"
    payload["conversation"] = {"topic": "艺考助学政策", "focus": "用户询问艺术考试费用"}
    prompt = compile_dialogue_messages(payload)[0]["content"]
    assert "用户可以了解艺考助学政策" in prompt
    assert "人工智能需要数学基础" not in prompt


def test_optional_knowledge_can_match_focus_or_topic_for_followup_question():
    payload = fixture_payload()
    payload["input"] = "具体说说呢？"
    payload["context"]["character"]["knowledge"] = ["安静的图书馆在南街", "天台开满鲜花"]
    payload["conversation"] = {"topic": "安静的去处", "focus": "寻找图书馆"}
    prompt = compile_dialogue_messages(payload)[0]["content"]
    assert "安静的图书馆在南街" in prompt and "天台开满鲜花" not in prompt


def test_media_pending_running_are_not_completed_and_done_is_saved():
    payload = fixture_payload()
    for status in ("queued", "pending", "running"):
        payload["media"] = {"status": status, "subject": "窗边的花"}
        prompt = compile_dialogue_messages(payload)[0]["content"]
        assert "图尚未完成" in prompt and "图片已保存并成为图片消息" not in prompt
    payload["media"] = {"status": "done", "subject": "窗边的花"}
    prompt = compile_dialogue_messages(payload)[0]["content"]
    assert "图片已保存并成为图片消息" in prompt
    assert "图中生成的细节不增添世界事实" in prompt and "图尚未完成" not in prompt


def test_media_failures_distinguish_known_failure_from_uncertain_outcome():
    payload = fixture_payload()
    payload["media"] = {"status": "failed"}
    prompt = compile_dialogue_messages(payload)[0]["content"]
    assert "这次附图没有生成成功" in prompt and "尚未确认完成" not in prompt
    payload["media"] = {"status": "uncertain"}
    prompt = compile_dialogue_messages(payload)[0]["content"]
    assert "尚未确认完成" in prompt and "不承诺正在自动重试" in prompt
    assert "这次附图没有生成成功" not in prompt


def test_world_start_identity_is_not_a_new_user_decision():
    prompt = compile_dialogue_messages(fixture_payload())[0]["content"]
    assert "刚毕业" in prompt
    assert "用户身份是该世界起点的背景，不代表此刻选定的未来方向" in prompt


def test_final_turn_guard_follows_verbatim_history_without_deleting_bad_old_speech():
    payload = fixture_payload()
    payload["context"]["recent"].insert(0, {"role": "assistant", "text": "（之前记录的动作）刚才我和门口的人聊过。"})
    before = deepcopy(payload)
    messages = compile_dialogue_messages(payload)
    assert messages[1]["content"] == "（之前记录的动作）刚才我和门口的人聊过。"
    assert messages[-1]["role"] == "system"
    assert DIALOGUE_OUTPUT in messages[-1]["content"]
    assert "眼前有人不等于此前和他交谈过" in messages[-1]["content"]
    assert "角色历史台词里的断言本身不是独立证据" in messages[0]["content"]
    assert payload == before


def test_final_image_guard_follows_current_request_without_inventing_photography():
    payload = fixture_payload()
    payload["media"] = {"status": "pending", "subject": "当前位置的插图"}
    messages = compile_dialogue_messages(payload)
    assert "不解释或安排拍照、找设备" in messages[-1]["content"]
    assert "图尚未完成" in messages[-1]["content"]
    assert "不编造拍照质量、镜头、光线操作" in messages[0]["content"]


async def test_old_derived_role_card_recompiled_once_without_changing_character():
    from helpers import FakeProvider, make_branch
    from parallel_life.conversation import ConversationEngine, ROLE_CARD_VERSION
    from parallel_life.memory import stable_id
    from parallel_life.store import Store
    from parallel_life.world import initialize

    store = Store(":memory:")
    provider = FakeProvider()
    provider.handlers["role_card"] = {"identity": "谨慎的朋友", "voice": "简短直接", "stance": "尊重他人意见"}
    world = initialize(make_branch())
    before = world.model_dump()
    engine = ConversationEngine(store, provider)
    card = await engine.role_card(world, "a")
    ident = stable_id("role_card", world.user_id, world.branch_id, "a")
    old_row = store.get("role_card", ident, world.user_id)
    old_row["card"].pop("compiler_version")
    old_row["card"]["stance"] = "每轮照着原业务流程办事"
    store.put("role_card", old_row)
    refreshed = await engine.role_card(world, "a")
    assert refreshed["compiler_version"] == ROLE_CARD_VERSION
    assert refreshed["stance"] == "尊重他人意见"
    assert refreshed["source_hash"] == card["source_hash"]  # Same source; new compiler rules.
    assert world.model_dump() == before
    assert len(provider.calls) == 2
    assert await engine.role_card(world, "a") == refreshed
    assert len(provider.calls) == 2
    store.close()
