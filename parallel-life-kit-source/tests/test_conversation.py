"""Injected-provider contracts; these tests are not real-model quality evidence."""
import copy

import pytest

from helpers import FakeProvider, add_message, make_branch
from parallel_life.conversation import ConversationEngine
from parallel_life.memory import MemoryEngine
from parallel_life.models import Memory
from parallel_life.providers import ProviderError
from parallel_life.store import Store
from parallel_life.world import initialize


@pytest.fixture
def setup(tmp_path):
    store, provider = Store(tmp_path / "conversation.db"), FakeProvider()
    provider.handlers["route"] = lambda p: {"mode": "chat", "source_quote": p["input"],
        "topic": "眼前的话题", "focus": p["input"], "parked_topics": []}
    provider.handlers["role_card"] = {"identity": "谨慎的朋友", "voice": "简短直率", "stance": "认真听取新想法"}
    engine = ConversationEngine(store, provider)
    yield store, provider, engine, initialize(make_branch())
    store.close()


async def plan(setup, text="我想做人工智能", *, actor="a", index=0, image_request=None):
    store, _, engine, world = setup
    message = add_message(store, index, actor=actor, text=text)
    return await engine.plan(world, actor, text, message.id, image_request=image_request)


async def test_topic_state_is_durable_scoped_and_not_world_truth(setup):
    store, provider, engine, world = setup
    before = world.model_dump()
    result = await plan(setup)
    assert result["mode"] == "chat" and result["state"]["revision"] == 1
    state = ConversationEngine(store, provider).state(world, "a")
    assert state == result["state"]
    assert state["source_ids"] == ["user-a:branch-a:a:0"] and state["derived"] is True
    assert state["last_user_message_id"] == state["source_ids"][0]
    assert state["source_quote"] == "我想做人工智能"
    assert world.model_dump() == before
    assert not store.list("memory", world.user_id) and not store.list("event", world.user_id)
    assert engine.state(world, "b") is None
    assert engine.state(initialize(make_branch(branch="another-branch")), "a") is None
    assert engine.state(initialize(make_branch(user="another-user")), "a") is None


async def test_router_only_sees_current_scoped_dialogue_not_character_workflow(setup):
    store, provider, _, _ = setup
    add_message(store, 2, actor="b", text="另一角色私聊海豚")
    add_message(store, 3, user="someone-else", text="他人秘密银杏")
    add_message(store, 4, branch="elsewhere", text="平行世界梧桐")
    add_message(store, 5, text="旧话题先搁置")
    add_message(store, 6, role="assistant", text="好。")
    await plan(setup)
    task, payload = provider.calls[-1]
    assert task == "route"
    assert set(payload) == {"input", "recent", "previous_state"}
    assert [m["text"] for m in payload["recent"]] == ["旧话题先搁置", "好。"]
    for hidden in ("海豚", "银杏", "梧桐", "开工作室", "列车", "stay"):
        assert hidden not in str(payload)


async def test_replay_reuses_route_without_duplicate_revision_or_paid_call(setup):
    store, provider, engine, world = setup
    result = await plan(setup)
    replay = await engine.plan(world, "a", "我想做人工智能", result["state"]["last_user_message_id"])
    assert replay == result and len(provider.calls) == 1
    replay["state"]["topic"] = "调用方修改自己的副本"
    assert engine.state(world, "a")["topic"] == "眼前的话题"
    with pytest.raises(ValueError, match="different image_request"):
        await engine.plan(world, "a", "我想做人工智能", result["state"]["last_user_message_id"], image_request="自拍")


@pytest.mark.parametrize("mode,text,quote,expected", [
    ("image", "发一张你的照片给我", "发一张你的照片给我", "image"),
    ("image", "请给我画一张海边的图", "给我画一张海边的图", "image"),
    ("image", "我想看看你现在的样子，给我发张照片", "给我发张照片", "image"),
    ("image", "给我发一张昨天教室的图", "给我发一张昨天教室的图", "image"),
    ("image", "给我画一张以前教室的图", "给我画一张以前教室的图", "image"),
    ("image", "我想要一张别的图", "我想要一张别的图", "image"),
    ("image", "昨天他说给我发图", "给我发图", "chat"),
    ("image", "昨天他说给我发图", "昨天他说给我发图", "chat"),
    ("image", "如果能发图就好了", "如果能发图就好了", "chat"),
    ("image", "不要给我发图", "给我发图", "chat"),
    ("image", "不用发照片", "发照片", "chat"),
    ("image", "我想起以前发的照片", "我想起以前发的照片", "chat"),
    ("image", "如果给我发图会怎样", "给我发图", "chat"),
    ("image", "照片上是我的朋友", "照片上是我的朋友", "chat"),
    ("image", "我们聊天吧", "发张图片", "chat"),
    ("world", "我想做人工智能", "我想做人工智能", "chat"),
    ("world", "我想先听听你的意见", "我想先听听你的意见", "chat"),
    ("world", "我答应你明天再来", "我答应你明天再来", "world"),
    ("world", "请你答应我，明天陪我去看看", "请你答应我，明天陪我去看看", "world"),
    ("world", "答应我明天过来吧", "答应我明天过来吧", "world"),
    ("world", "请取消明天的约定", "请取消明天的约定", "world"),
    ("world", "如果我选择留下呢", "我选择留下", "chat"),
    ("world", "不要替我选择留下", "选择留下", "chat"),
    ("world", "我现在把笔记本交给你", "我现在把笔记本交给你", "world"),
])
async def test_route_requires_explicit_source_grounded_intent(setup, mode, text, quote, expected):
    _, provider, _, _ = setup
    provider.handlers["route"] = {"mode": mode, "source_quote": quote, "topic": "当前话题", "focus": text,
                                  "image_subject": "图像主题", "action_quote": quote}
    result = await plan(setup, text)
    assert result["mode"] == expected
    assert ("image_subject" in result) == (expected == "image")
    assert ("action_quote" in result) == (expected == "world")
    assert result["source_quote"] in text


async def test_action_quote_cannot_hide_ungrounded_secondary_action(setup):
    _, provider, _, _ = setup
    provider.handlers["route"] = {"mode": "world", "source_quote": "我答应明天来", "topic": "约定",
                                  "focus": "来访", "action_quote": "我取消读大学"}
    assert (await plan(setup, "我答应明天来"))["mode"] == "chat"


async def test_explicit_image_field_does_not_depend_on_router_or_character_equipment(setup):
    _, provider, engine, world = setup
    provider.handlers["route"] = ProviderError("router_unavailable")
    result = await plan(setup, "就刚才说的那种感觉", image_request="海边的角色头像")
    assert result["mode"] == "image" and result["image_subject"] == "海边的角色头像"
    assert result["source_quote"] == "" and not provider.calls
    assert engine.state(world, "a")["source_ids"] == ["user-a:branch-a:a:0"]


@pytest.mark.parametrize("value", ["", "  ", "字" * 1501, True, {"subject": "图"}])
async def test_explicit_image_field_validation(setup, value):
    with pytest.raises(ValueError, match="image_request"):
        await plan(setup, image_request=value)


@pytest.mark.parametrize("response", [None, [], {}, {"mode": "automatic", "topic": "x", "focus": "x"},
    {"mode": "chat", "topic": "字" * 161, "focus": "x"},
    {"mode": "chat", "topic": "x", "focus": "字" * 501},
    {"mode": "chat", "topic": "x", "focus": "x", "parked_topics": ["x"] * 6},
    {"mode": "chat", "topic": "x", "focus": "x", "world_fact": "已入学"}])
async def test_invalid_route_fails_explicitly_without_state(setup, response):
    store, provider, engine, world = setup
    provider.handlers["route"] = lambda _: copy.deepcopy(response)
    with pytest.raises(ProviderError, match="invalid_conversation_route"):
        await plan(setup)
    assert engine.state(world, "a") is None
    assert len(store.list("message", world.user_id, world.branch_id)) == 1


async def test_transport_errors_are_not_hidden_as_chat_success(setup):
    _, provider, engine, world = setup
    provider.handlers["route"] = ProviderError("provider_http_error", status_code=429)
    with pytest.raises(ProviderError) as error:
        await plan(setup)
    assert error.value.status_code == 429 and engine.state(world, "a") is None


async def test_source_forgotten_during_route_cannot_return_to_state(setup):
    store, provider, engine, world = setup
    def response(payload):
        source = store.list("message", world.user_id, world.branch_id)[-1]
        store.put("memory", Memory(user_id=world.user_id, branch_id=world.branch_id, actor_id="a",
            kind="preference", key="current", text=source["text"], source_type="user_statement",
            source_ids=[source["id"]], status="forgotten"))
        return {"mode": "chat", "topic": "新话题", "focus": payload["input"]}
    provider.handlers["route"] = response
    with pytest.raises(ProviderError, match="conversation_sources_changed"):
        await plan(setup)
    assert engine.state(world, "a") is None


async def test_unknown_invisible_wrong_or_missing_user_evidence_is_rejected(setup):
    store, provider, engine, world = setup
    own = add_message(store, text="原始输入")
    other = add_message(store, actor="b", text="私聊")
    assistant = add_message(store, 2, role="assistant", text="台词")
    for actor, text, ident in [("z", "原始输入", own.id), ("a", "改写", own.id),
                                ("a", "私聊", other.id), ("a", "台词", assistant.id), ("a", "不存在", "absent")]:
        with pytest.raises((KeyError, ValueError)):
            await engine.plan(world, actor, text, ident)
    assert not provider.calls


@pytest.mark.parametrize("operation", ["correct", "forget"])
async def test_correction_and_forgetting_invalidate_linked_state_and_router_history(setup, operation):
    store, provider, engine, world = setup
    first = await plan(setup, "我喜欢吵闹的地方")
    record = Memory(user_id=world.user_id, branch_id=world.branch_id, actor_id="a", kind="preference",
        key="noise", text="喜欢吵闹", source_type="user_statement", source_ids=first["state"]["source_ids"])
    store.put("memory", record)
    MemoryEngine(store, None).edit(world.user_id, world.branch_id, "a", record.id, operation, "其实我喜欢安静")
    assert engine.state(world, "a") is None
    second = await plan(setup, "聊聊今天吧", index=1)
    assert second["state"]["revision"] == 2
    payload = provider.calls[-1][1]
    assert payload["previous_state"] is None and "吵闹" not in str(payload)


async def test_chapter_change_missing_sources_and_old_state_are_not_injected(setup):
    store, _, engine, world = setup
    await plan(setup)
    later = world.model_copy(deep=True)
    later.scene.chapter = 2
    assert engine.state(later, "a") is None
    for i in range(1, 21):
        add_message(store, i, text=f"较近的对话{i}")
    assert engine.state(world, "a") is None


async def test_long_conversation_has_bounded_history_state_and_complete_provenance(setup):
    store, provider, engine, world = setup
    for index in range(45):
        result = await plan(setup, f"第{index}轮新话题", index=index)
        payload = provider.calls[-1][1]
        assert len(payload["recent"]) <= 19
        assert len(result["state"]["source_ids"]) <= 40
    assert len(store.list("conversation", world.user_id, world.branch_id, "a")) == 1
    assert result["state"]["revision"] == 45
    assert any(p["previous_state"] is None for _, p in provider.calls[35:])
    assert engine.state(world, "a")["last_user_message_id"] == "user-a:branch-a:a:44"
    assert len(store.list("message", world.user_id, world.branch_id)) == 45


async def test_role_card_derived_cache_never_overwrites_persona_or_imports_goals(setup):
    store, provider, engine, world = setup
    before = world.model_dump()
    card = await engine.role_card(world, "a")
    assert card["identity"] == "谨慎的朋友" and card["derived"]
    assert card["diagnostics"] == {"status": "generated"}
    assert await engine.role_card(world, "a") == card and len(provider.calls) == 1
    assert "goal" not in provider.calls[0][1]["character"]
    assert "knowledge" not in provider.calls[0][1]["character"]
    assert world.model_dump() == before
    assert len(store.list("role_card", world.user_id, world.branch_id, "a")) == 1
    edited = world.model_copy(deep=True)
    edited.characters[0].persona = "热情"
    edited.characters[0].version += 1
    new_card = await engine.role_card(edited, "a")
    assert new_card["source_hash"] != card["source_hash"] and len(provider.calls) == 2


async def test_role_cards_are_separate_across_actors_users_and_branches(setup):
    _, provider, engine, world = setup
    await engine.role_card(world, "a")
    await engine.role_card(world, "b")
    await engine.role_card(initialize(make_branch(user="other")), "a")
    await engine.role_card(initialize(make_branch(branch="other")), "a")
    assert len(provider.calls) == 4


async def test_role_card_unknown_delivery_stays_empty_not_invented(setup):
    _, provider, engine, world = setup
    provider.handlers["role_card"] = {"identity": "谨慎的朋友", "voice": "", "stance": ""}
    card = await engine.role_card(world, "a")
    assert card["voice"] == "" and card["diagnostics"]["status"] == "generated"


async def test_explicit_user_voice_is_preserved_and_invalidates_cache(setup):
    _, provider, engine, world = setup
    first = await engine.role_card(world, "a")
    world.characters[0].voice = "干脆直接，不故作热情"
    second = await engine.role_card(world, "a")
    assert second["voice"] == world.characters[0].voice
    assert second["source_hash"] != first["source_hash"]
    assert provider.calls[-1][1]["character"]["voice"] == world.characters[0].voice


@pytest.mark.parametrize("result,code", [(ProviderError("provider_http_error", status_code=503), "provider_http_error"),
                                       ({"identity": "凭空身份"}, "invalid_role_card")])
async def test_role_card_fallback_is_faithful_diagnostic_and_retriable(setup, result, code):
    store, provider, engine, world = setup
    provider.handlers["role_card"] = result
    card = await engine.role_card(world, "a")
    assert card["identity"] == world.characters[0].name and card["voice"] == world.characters[0].persona
    assert card["diagnostics"] == {"status": "fallback", "error": code}
    assert not store.list("role_card", world.user_id, world.branch_id, "a")
    assert store.list("conversation_diagnostic", world.user_id, world.branch_id, "a")[0]["card"] == card
    provider.handlers["role_card"] = {"identity": "老朋友", "voice": "沉稳", "stance": "开放"}
    assert (await engine.role_card(world, "a"))["diagnostics"]["status"] == "generated"
    assert len(provider.calls) == 2


async def test_unexpected_role_card_programming_failure_is_not_swallowed(setup):
    _, provider, engine, world = setup
    provider.handlers["role_card"] = RuntimeError("bug")
    with pytest.raises(RuntimeError, match="bug"):
        await engine.role_card(world, "a")


async def test_proactive_images_disabled_by_default_even_if_router_proposes(setup):
    _, provider, _, _ = setup
    provider.handlers["route"] = lambda p: {"mode": "chat", "source_quote": p["input"],
        "topic": "晚霞", "focus": p["input"], "proactive_image_subject": "窗外晚霞很红"}
    result = await plan(setup, "窗外晚霞很红")
    assert result["mode"] == "chat" and "image_subject" not in result
    assert "proactive_image" not in result
    assert "allow_proactive_images" not in provider.calls[-1][1]


async def test_opt_in_proactive_image_is_same_chat_turn_and_current_user_span_only(setup):
    store, provider, _, world = setup
    engine = ConversationEngine(store, provider, proactive_images=True)
    provider.handlers["route"] = lambda p: {"mode": "chat", "source_quote": p["input"],
        "topic": "晚霞", "focus": p["input"], "proactive_image_subject": "窗外晚霞很红"}
    text = "今天窗外晚霞很红，我好喜欢。"
    message = add_message(store, 17, text=text)
    before = world.model_dump()
    result = await engine.plan(world, "a", text, message.id)
    assert result["mode"] == "chat" and result["proactive_image"] is True
    assert result["image_subject"] == "窗外晚霞很红"
    assert provider.calls[-1][1]["allow_proactive_images"] is True
    assert result["state"]["last_user_message_id"] == message.id
    assert world.model_dump() == before
    assert not store.list("job", world.user_id)  # Engine owns the sole quota/job path.
    assert await engine.plan(world, "a", text, message.id) == result
    assert len(provider.calls) == 1
    disabled = ConversationEngine(store, provider)
    replay = await disabled.plan(world, "a", text, message.id)
    assert "image_subject" not in replay and "proactive_image" not in replay
    assert len(provider.calls) == 1


@pytest.mark.parametrize("text,subject", [
    ("窗外晚霞很红，但不要发图。", "窗外晚霞很红"),
    ("只聊文字就好，窗外晚霞很红。", "窗外晚霞很红"),
    ("窗外晚霞很红，不需要图片。", "窗外晚霞很红"),
    ("窗外晚霞很红，今天不发图。", "窗外晚霞很红"),
    ("窗外晚霞很红，这轮先不配图。", "窗外晚霞很红"),
    ("窗外晚霞很红，纯文字就行。", "窗外晚霞很红"),
    ("窗外晚霞很红，我只想聊天。", "窗外晚霞很红"),
    ("窗外晚霞很红。No pictures please.", "窗外晚霞很红"),
    ("这是秘密，我在海边的小屋。", "海边的小屋"),
    ("窗外晚霞很红。", "海边的小屋"),
    ("我在思考专业选择。", "专业选择"),
])
async def test_proactive_image_respects_rejection_privacy_and_current_visual_grounding(setup, text, subject):
    store, provider, _, world = setup
    engine = ConversationEngine(store, provider, proactive_images=True)
    provider.handlers["route"] = lambda p: {"mode": "chat", "source_quote": p["input"],
        "topic": "当前话题", "focus": p["input"], "proactive_image_subject": subject}
    message = add_message(store, 18, text=text)
    result = await engine.plan(world, "a", text, message.id)
    assert result["mode"] == "chat" and "image_subject" not in result and "proactive_image" not in result


async def test_opt_in_does_not_duplicate_explicit_image_or_world_action(setup):
    store, provider, _, world = setup
    engine = ConversationEngine(store, provider, proactive_images=True)
    for index, text, mode in [(19, "给我发张窗外晚霞的图", "image"), (20, "我选择走进教室", "world")]:
        provider.handlers["route"] = {"mode": mode, "source_quote": text, "topic": "场景",
            "focus": text, "image_subject": "窗外晚霞", "proactive_image_subject": "窗外晚霞" if mode == "image" else "教室"}
        message = add_message(store, index, text=text)
        result = await engine.plan(world, "a", text, message.id)
        assert result["mode"] == mode and "proactive_image" not in result


async def test_proactive_router_never_receives_other_actor_secrets(setup):
    store, provider, _, world = setup
    engine = ConversationEngine(store, provider, proactive_images=True)
    add_message(store, 21, actor="b", text="另外人物的私人花园暗号")
    text = "窗外晚霞很红"
    message = add_message(store, 22, text=text)
    await engine.plan(world, "a", text, message.id)
    assert "私人花园" not in str(provider.calls[-1][1])
    assert "暗号" not in str(provider.calls[-1][1])
