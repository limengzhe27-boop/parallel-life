import asyncio
import json

import pytest

from helpers import FakeProvider, add_message, make_branch
from parallel_life.memory import MemoryEngine, terms
from parallel_life.models import Action, Event, Memory
from parallel_life.store import Store
from parallel_life.world import initialize, settle, visible_state


@pytest.fixture
def setup(tmp_path):
    store = Store(tmp_path / "memory.db")
    provider = FakeProvider()
    engine = MemoryEngine(store, provider, 50000)
    world = initialize(make_branch())
    yield store, provider, engine, world
    store.close()


def test_chinese_and_ascii_terms():
    assert {"喜欢", "安静", "cafe", "2020"} <= terms("我喜欢安静 CAFE 2020")
    assert terms("我") == {"我"}


async def test_private_user_branch_actor_evidence_filtered_before_model(setup):
    store, provider, engine, world = setup
    own = add_message(store, text="自己的原话")
    other_actor = add_message(store, actor="b", text="另一个角色的私聊")
    other_branch = add_message(store, branch="other", text="另一个人生的私聊")
    other_user = add_message(store, user="other", text="另一个用户的私聊")
    await engine.derive(world.user_id, world.branch_id, "a", [
        own.id, other_actor.id, other_branch.id, other_user.id])
    assert [s["id"] for s in provider.calls[0][1]["sources"]] == [own.id]
    context = engine.context(world, "a", "原话", visible_state(world, "a"))
    assert "自己的原话" in str(context)
    assert "另一个" not in str(context)
    assert "小白私有暗号" not in str(context)


async def test_derive_stable_id_and_preserves_original(setup):
    store, _, engine, world = setup
    message = add_message(store)
    await engine.derive(world.user_id, world.branch_id, "a", [message.id])
    first = engine.active(world.user_id, world.branch_id, "a")[0]
    await engine.derive(world.user_id, world.branch_id, "a", [message.id])
    records = store.list("memory", world.user_id, world.branch_id, "a")
    assert len(records) == 1 and records[0]["id"] == first.id
    assert store.get("message", message.id, world.user_id) == message.model_dump()


async def test_invalid_source_rolls_back_whole_extraction(setup):
    store, provider, engine, world = setup
    message = add_message(store)
    provider.handlers["memory"] = {"items": [
        {"key": "valid", "text": "合法", "source_ids": [message.id]},
        {"key": "bad", "text": "虚构", "source_ids": ["nonexistent"]}]}
    with pytest.raises(ValueError, match="evidence"):
        await engine.derive(world.user_id, world.branch_id, "a", [message.id])
    assert not engine.active(world.user_id, world.branch_id, "a")


@pytest.mark.parametrize("claim", ["user_statement", "event", "user_correction"])
async def test_assistant_claim_is_not_recycled_as_independent_memory(setup, claim):
    store, provider, engine, world = setup
    message = add_message(store, role="assistant", text="我猜用户喜欢红色")
    provider.handlers["memory"] = {"items": [{"key": "color", "text": "用户喜欢红色",
        "source_type": claim, "source_ids": [message.id]}]}
    await engine.derive(world.user_id, world.branch_id, "a", [message.id])
    assert not engine.active(world.user_id, world.branch_id, "a")
    assert store.get("message", message.id, world.user_id)["text"] == message.text


async def test_only_accepted_event_is_event_memory(setup):
    store, provider, engine, world = setup
    event = Event(id="event", branch_id=world.branch_id, request_id="r", date=world.date,
        actor_id="a", kind="transfer", accepted=False, text="没有转交", visibility=["a"])
    store.put("event", event, user_id=world.user_id)
    provider.handlers["memory"] = {"items": [{"key": "event", "text": "物品已经转交",
        "source_type": "event", "source_ids": [event.id]}]}
    await engine.derive(world.user_id, world.branch_id, "a", [event.id])
    assert engine.active(world.user_id, world.branch_id, "a")[0].source_type == "agent_inference"


async def test_compression_keeps_originals_recent_twenty_and_exact_sources(setup):
    store, provider, engine, world = setup
    messages = [add_message(store, i) for i in range(35)]
    await engine.compress(world.user_id, world.branch_id, "a")
    summaries = engine.active(world.user_id, world.branch_id, "a")
    assert [len(s.source_ids) for s in summaries] == [10, 5]
    assert {s for summary in summaries for s in summary.source_ids} == {m.id for m in messages[:15]}
    assert store.list("message", world.user_id, world.branch_id) == [m.model_dump() for m in messages]
    context = engine.context(world, "a", "安静", visible_state(world, "a"))
    assert [m["id"] for m in context["recent"]] == [m.id for m in messages[-20:]]
    calls = len(provider.calls)
    await engine.compress(world.user_id, world.branch_id, "a")
    assert len(provider.calls) == calls
    await engine.compress(world.user_id, world.branch_id, "a", scene_end=True)
    assert len(store.list("message", world.user_id, world.branch_id)) == 35
    assert {s for m in engine.active(world.user_id, world.branch_id, "a")
            for s in m.source_ids} == {m.id for m in messages}


async def test_summary_failure_retains_all_originals(setup):
    store, provider, engine, world = setup
    for i in range(25):
        add_message(store, i)
    provider.handlers["summary"] = {"text": ""}
    with pytest.raises(ValueError):
        await engine.compress(world.user_id, world.branch_id, "a")
    assert len(store.list("message", world.user_id, world.branch_id)) == 25
    assert not engine.active(world.user_id, world.branch_id, "a")


async def test_correction_hides_old_source_and_outranks_inference(setup):
    store, provider, engine, world = setup
    message = add_message(store, text="我喜欢热闹")
    await engine.derive(world.user_id, world.branch_id, "a", [message.id])
    old = engine.active(world.user_id, world.branch_id, "a")[0]
    engine.edit(world.user_id, world.branch_id, "a", old.id, "correct", "我现在喜欢安静")
    context = engine.context(world, "a", "偏好", visible_state(world, "a"))
    assert "我现在喜欢安静" in str(context) and "我喜欢热闹" not in str(context)
    newer = add_message(store, 1, role="assistant", text="我猜他又喜欢热闹了")
    provider.handlers["memory"] = {"items": [{"key": "quiet", "text": "喜欢热闹",
        "source_type": "agent_inference", "source_ids": [newer.id]}]}
    await engine.derive(world.user_id, world.branch_id, "a", [newer.id])
    active = engine.active(world.user_id, world.branch_id, "a")
    assert len(active) == 1 and active[0].source_type == "user_correction"
    assert store.get("message", message.id, world.user_id)["text"] == "我喜欢热闹"


async def test_forgetting_prevents_reconstruction_from_same_evidence(setup):
    store, provider, engine, world = setup
    message = add_message(store, text="需要遗忘的原话")
    await engine.derive(world.user_id, world.branch_id, "a", [message.id])
    await engine.compress(world.user_id, world.branch_id, "a", scene_end=True)
    record = engine.active(world.user_id, world.branch_id, "a")[0]
    engine.edit(world.user_id, world.branch_id, "a", record.id, "forget")
    calls = len(provider.calls)
    await engine.derive(world.user_id, world.branch_id, "a", [message.id])
    await engine.compress(world.user_id, world.branch_id, "a", scene_end=True)
    assert len(provider.calls) == calls
    assert not engine.active(world.user_id, world.branch_id, "a")
    assert "需要遗忘" not in str(engine.context(world, "a", "", visible_state(world, "a")))


async def test_memory_edit_scope_isolation(setup):
    store, _, engine, world = setup
    message = add_message(store)
    await engine.derive(world.user_id, world.branch_id, "a", [message.id])
    record = engine.active(world.user_id, world.branch_id, "a")[0]
    for user, branch, actor in [("other", world.branch_id, "a"),
                                 (world.user_id, "other", "a"), (world.user_id, world.branch_id, "b")]:
        with pytest.raises(KeyError):
            engine.edit(user, branch, actor, record.id, "forget")


async def test_context_budget_keeps_persona_or_explicitly_errors(setup):
    store, _, engine, world = setup
    for i in range(20):
        add_message(store, i, text="很长的原始证据" * 400)
    engine.context_chars = 1000
    with pytest.raises(ValueError, match="budget"):
        engine.context(world, "a", "", visible_state(world, "a"))
    assert len(store.list("message", world.user_id, world.branch_id)) == 20


async def test_forget_during_extraction_does_not_resurrect_memory(setup):
    store, provider, engine, world = setup
    message = add_message(store, text="要遗忘的秘密")
    await engine.derive(world.user_id, world.branch_id, "a", [message.id])
    record = engine.active(world.user_id, world.branch_id, "a")[0]
    started, release = asyncio.Event(), asyncio.Event()

    async def delayed(payload):
        started.set()
        await release.wait()
        return {"items": [{"key": "quiet", "text": "要遗忘的秘密", "source_ids": [message.id]}]}

    provider.handlers["memory"] = delayed
    task = asyncio.create_task(engine.derive(world.user_id, world.branch_id, "a", [message.id]))
    await started.wait()
    engine.edit(world.user_id, world.branch_id, "a", record.id, "forget")
    release.set()
    await task
    assert not engine.active(world.user_id, world.branch_id, "a")


async def test_forget_during_compression_does_not_restore_summary(setup):
    store, provider, engine, world = setup
    message = add_message(store, text="要遗忘的秘密")
    await engine.derive(world.user_id, world.branch_id, "a", [message.id])
    record = engine.active(world.user_id, world.branch_id, "a")[0]
    started, release = asyncio.Event(), asyncio.Event()

    async def delayed(payload):
        started.set()
        await release.wait()
        return {"text": "要遗忘的秘密"}

    provider.handlers["summary"] = delayed
    task = asyncio.create_task(engine.compress(world.user_id, world.branch_id, "a", scene_end=True))
    await started.wait()
    engine.edit(world.user_id, world.branch_id, "a", record.id, "forget")
    release.set()
    await task
    assert not engine.active(world.user_id, world.branch_id, "a")


async def test_forgotten_tell_does_not_bypass_filter_through_character_knowledge(setup):
    store, provider, engine, world = setup
    updated, events = settle(world, [], Action(kind="tell", target="a", content="动态秘密星尘"), "tell-1")
    event = events[0]
    store.put("event", event, user_id=world.user_id)
    provider.handlers["memory"] = {"items": [{"key": "secret", "text": "用户告诉我动态秘密星尘",
        "source_type": "event", "source_ids": [event.id]}]}
    await engine.derive(world.user_id, world.branch_id, "a", [event.id])
    record = engine.active(world.user_id, world.branch_id, "a")[0]
    engine.edit(world.user_id, world.branch_id, "a", record.id, "forget")
    context = engine.context(updated, "a", "", visible_state(updated, "a"))
    assert "动态秘密星尘" not in str(context)


async def test_legacy_self_claim_not_recalled_twice_but_original_kept(setup):
    store, _, engine, world = setup
    message = add_message(store, role="assistant", text="我猜你更喜欢美术")
    record = Memory(user_id=world.user_id, branch_id=world.branch_id, actor_id="a",
        kind="belief", key="guess", text=message.text, source_type="agent_inference",
        source_ids=[message.id])
    store.put("memory", record)
    context = engine.context(world, "a", "我想学计算机", visible_state(world, "a"))
    assert not context["memories"]
    assert context["recent"][0]["text"] == message.text
    assert engine.active(world.user_id, world.branch_id, "a")[0].id == record.id


async def test_automatic_memory_replacement_keeps_recent_dialogue(setup):
    store, provider, engine, world = setup
    first = add_message(store, text="我喜欢安静")
    await engine.derive(world.user_id, world.branch_id, "a", [first.id])
    second = add_message(store, 1, text="我也喜欢朋友来家里聊天")
    await engine.derive(world.user_id, world.branch_id, "a", [second.id])
    assert len(engine.active(world.user_id, world.branch_id, "a")) == 1
    assert not engine.blocked_sources(world.user_id, world.branch_id, "a")
    context = engine.context(world, "a", "偏好", visible_state(world, "a"))
    assert [m["id"] for m in context["recent"]] == [first.id, second.id]
    active = engine.active(world.user_id, world.branch_id, "a")[0]
    engine.edit(world.user_id, world.branch_id, "a", active.id, "correct", "我更喜欢独处")
    assert {first.id, second.id} <= engine.blocked_sources(world.user_id, world.branch_id, "a")


async def test_inference_is_belief_not_shared_episode(setup):
    store, provider, engine, world = setup
    message = add_message(store, text="我还没决定选哪个专业")
    provider.handlers["memory"] = {"items": [{"kind": "episode", "key": "guess",
        "text": "用户可能在犹豫", "source_type": "agent_inference", "source_ids": [message.id]}]}
    await engine.derive(world.user_id, world.branch_id, "a", [message.id])
    memory = engine.active(world.user_id, world.branch_id, "a")[0]
    assert memory.kind == "belief" and memory.source_type == "agent_inference"


def test_recent_evidence_not_duplicated_and_stale_goal_inference_not_recalled(setup):
    store, _, engine, world = setup
    user = add_message(store, text="我想做人工智能")
    store.put("memory", Memory(user_id=world.user_id, branch_id=world.branch_id, actor_id="a",
        kind="preference", key="current", text=user.text, source_type="user_statement",
        source_ids=[user.id]))
    event = Event(id="prior-invite", branch_id=world.branch_id, request_id="old", date=world.date,
        actor_id="a", kind="propose", accepted=True, text="建议去开工作室", visibility=["a"])
    store.put("event", event, user_id=world.user_id)
    store.put("memory", Memory(user_id=world.user_id, branch_id=world.branch_id, actor_id="a",
        kind="belief", key="old_goal", text="用户可能想开工作室", source_type="agent_inference",
        source_ids=[event.id], importance=1))
    context = engine.context(world, "a", user.text, visible_state(world, "a"))
    assert not context["memories"]
    assert context["recent"][0]["text"] == user.text
    # The old belief is still inspectable and can be recalled when explicitly relevant.
    relevant = engine.context(world, "a", "开工作室的事怎么样", visible_state(world, "a"))
    assert relevant["memories"][0]["key"] == "old_goal"


def save_memory(store, world, key, text, sources, *, actor="a", kind="preference", source_type="user_statement"):
    memory = Memory(user_id=world.user_id, branch_id=world.branch_id, actor_id=actor, kind=kind,
        key=key, text=text, source_type=source_type, source_ids=sources)
    store.put("memory", memory)
    return memory


@pytest.mark.parametrize("operation", ["forget", "correct"])
async def test_explicit_edit_hides_same_turn_echo_and_dependent_summary_not_other_sources(setup, operation):
    store, _, engine, world = setup
    source = add_message(store, 10, ident="secret-source", text="我的暗号是秘密银河")
    echo = add_message(store, 10, ident="secret-echo", role="assistant", text="好，我记住秘密银河了")
    unrelated = add_message(store, 11, text="我喜欢热茶")
    original = save_memory(store, world, "secret", source.text, [source.id])
    summary = save_memory(store, world, "chunk", "谈到了秘密银河，也喜欢热茶", [echo.id, unrelated.id],
                          kind="summary", source_type="summary")
    safe = save_memory(store, world, "tea", unrelated.text, [unrelated.id])
    before_world = world.model_dump()
    engine.edit(world.user_id, world.branch_id, "a", original.id, operation, "改成代号天青")
    context = engine.context(world, "a", "暗号", visible_state(world, "a"))
    assert "秘密银河" not in str(context)
    assert "我喜欢热茶" in str(context)
    assert ("改成代号天青" in str(context)) == (operation == "correct")
    blocked = engine.blocked_sources(world.user_id, world.branch_id, "a")
    assert {source.id, echo.id, original.id, summary.id} <= blocked
    assert unrelated.id not in blocked and safe.id not in blocked
    assert world.model_dump() == before_world
    assert store.get("message", source.id, world.user_id) == source.model_dump()
    assert store.get("message", echo.id, world.user_id) == echo.model_dump()
    assert any(m.id == safe.id for m in engine.active(world.user_id, world.branch_id, "a"))


async def test_forgotten_echo_is_filtered_before_extraction_and_recompression(setup):
    store, provider, engine, world = setup
    source = add_message(store, 10, ident="secret-source", text="只说一次的暗号水星")
    echo = add_message(store, 10, ident="secret-echo", role="assistant", text="记住暗号水星")
    safe = add_message(store, 11, text="下一次喝茶吧")
    original = save_memory(store, world, "secret", source.text, [source.id])
    save_memory(store, world, "chunk", "水星与喝茶", [source.id, echo.id, safe.id],
                kind="summary", source_type="summary")
    engine.edit(world.user_id, world.branch_id, "a", original.id, "forget")
    await engine.derive(world.user_id, world.branch_id, "a", [source.id, echo.id, safe.id])
    await engine.compress(world.user_id, world.branch_id, "a", scene_end=True)
    assert len(provider.calls) == 2
    assert provider.calls[0][0] == "memory" and provider.calls[1][0] == "summary"
    assert [s["id"] for s in provider.calls[0][1]["sources"]] == [safe.id]
    assert [m["id"] for m in provider.calls[1][1]["messages"]] == [safe.id]
    assert "水星" not in str(provider.calls)
    summaries = [m for m in engine.active(world.user_id, world.branch_id, "a") if m.kind == "summary"]
    assert len(summaries) == 1 and summaries[0].source_ids == [safe.id]


def test_legacy_tombstone_expands_forward_through_summary_ids_without_raw_deletion(setup):
    store, _, engine, world = setup
    source = add_message(store, 10, ident="secret-source", text="过去的秘密蒲公英")
    echo = add_message(store, 10, ident="secret-echo", role="assistant", text="蒲公英")
    original = save_memory(store, world, "secret", source.text, [source.id])
    original.status = "forgotten"
    store.put("memory", original)
    first = save_memory(store, world, "legacy-chunk", "蒲公英摘要", [echo.id], kind="summary", source_type="summary")
    second = save_memory(store, world, "legacy-derived", "蒲公英再次摘要", [first.id], kind="summary", source_type="summary")
    blocked = engine.blocked_sources(world.user_id, world.branch_id, "a")
    assert {source.id, echo.id, first.id, second.id} <= blocked
    assert not engine.active(world.user_id, world.branch_id, "a")
    assert not store.list("memory_edit", world.user_id)
    assert store.get("memory", first.id, world.user_id)["status"] == "active"  # read filtering, not deletion


@pytest.mark.parametrize("operation", ["forget", "correct"])
def test_echo_expansion_is_scoped_before_request_id_matching(setup, operation):
    store, _, engine, world = setup
    source = add_message(store, 7, ident="own-secret", text="本角色暗号星河")
    own_echo = add_message(store, 7, ident="own-echo", role="assistant", text="星河")
    others = [add_message(store, 7, ident="other-role", actor="b", role="assistant", text="另一角色同名请求"),
              add_message(store, 7, ident="other-branch", branch="elsewhere", role="assistant", text="另一分支同名请求"),
              add_message(store, 7, ident="other-user", user="someone-else", role="assistant", text="另一用户同名请求")]
    original = save_memory(store, world, "secret", source.text, [source.id])
    engine.edit(world.user_id, world.branch_id, "a", original.id, operation, "改成新代号")
    blocked = engine.blocked_sources(world.user_id, world.branch_id, "a")
    assert own_echo.id in blocked and not {m.id for m in others} & blocked
    assert not engine.blocked_sources(world.user_id, world.branch_id, "b")
    assert not engine.blocked_sources(world.user_id, "elsewhere", "a")
    assert not engine.blocked_sources("someone-else", world.branch_id, "a")
    assert others[0].id in {m["id"] for m in engine.context(world, "b", "", visible_state(world, "b"))["recent"]}


def test_shared_visible_turn_is_forgotten_for_one_actor_not_every_observer(setup):
    store, _, engine, world = setup
    source = add_message(store, 10, ident="public-source", text="公开的旧代号星辉")
    echo = add_message(store, 10, ident="public-echo", role="assistant", text="旧代号星辉")
    for message in (source, echo):
        message.visibility = ["a", "b"]
        store.put("message", message)
    own = save_memory(store, world, "secret", source.text, [source.id])
    other = save_memory(store, world, "secret", source.text, [source.id], actor="b")
    engine.edit(world.user_id, world.branch_id, "a", own.id, "forget")
    assert "星辉" not in str(engine.context(world, "a", "", visible_state(world, "a")))
    assert "星辉" in str(engine.context(world, "b", "", visible_state(world, "b")))
    assert store.get("memory", other.id, world.user_id)["status"] == "active"


async def test_automatic_supersession_does_not_hide_its_assistant_reply(setup):
    store, _, engine, world = setup
    first = add_message(store, 10, ident="old-user", text="我喜欢热茶")
    reply = add_message(store, 10, ident="old-reply", role="assistant", text="热茶确实不错")
    await engine.derive(world.user_id, world.branch_id, "a", [first.id])
    second = add_message(store, 11, text="今天想喝凉茶")
    await engine.derive(world.user_id, world.branch_id, "a", [second.id])
    assert not engine.blocked_sources(world.user_id, world.branch_id, "a")
    assert reply.id in {m["id"] for m in engine.context(world, "a", "茶", visible_state(world, "a"))["recent"]}


def test_late_reply_of_forgotten_request_is_blocked_when_it_arrives(setup):
    store, _, engine, world = setup
    source = add_message(store, 10, ident="source", text="暗号金星")
    original = save_memory(store, world, "secret", source.text, [source.id])
    engine.edit(world.user_id, world.branch_id, "a", original.id, "forget")
    echo = add_message(store, 10, ident="late-echo", role="assistant", text="记住金星了")
    assert echo.id in engine.blocked_sources(world.user_id, world.branch_id, "a")
    assert "金星" not in str(engine.context(world, "a", "", visible_state(world, "a")))


def test_no_keyword_global_deletion_of_unlinked_later_paraphrase(setup):
    store, _, engine, world = setup
    source = add_message(store, 10, ident="source", text="我昨天梦到了星星")
    original = save_memory(store, world, "dream", source.text, [source.id])
    # There is no stored dependency connecting this different request to source.
    unlinked = add_message(store, 11, role="assistant", text="星星很好看")
    engine.edit(world.user_id, world.branch_id, "a", original.id, "forget")
    assert unlinked.id not in engine.blocked_sources(world.user_id, world.branch_id, "a")
    assert store.get("message", unlinked.id, world.user_id) == unlinked.model_dump()


async def test_forgetting_source_during_echo_extraction_blocks_inflight_result(setup):
    store, provider, engine, world = setup
    source = add_message(store, 10, ident="source", text="保密代号土星")
    echo = add_message(store, 10, ident="echo", role="assistant", text="代号土星我记住了")
    safe = add_message(store, 11, text="我们慢慢聊")
    original = save_memory(store, world, "secret", source.text, [source.id])
    started, release = asyncio.Event(), asyncio.Event()

    async def delayed(payload):
        started.set()
        await release.wait()
        return {"items": [{"key": "echo-guess", "text": "土星", "source_type": "agent_inference",
                           "source_ids": [echo.id, safe.id]}]}

    provider.handlers["memory"] = delayed
    task = asyncio.create_task(engine.derive(world.user_id, world.branch_id, "a", [echo.id, safe.id]))
    await started.wait()
    engine.edit(world.user_id, world.branch_id, "a", original.id, "forget")
    release.set()
    await task
    assert not engine.active(world.user_id, world.branch_id, "a")
