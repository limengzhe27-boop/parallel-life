import asyncio
from dataclasses import replace

import pytest

from helpers import FakeProvider, add_message, make_branch
from parallel_life.config import Settings
from parallel_life.interaction import Engine
from parallel_life.models import Action, Event, Job
from parallel_life.providers import ProviderError
from parallel_life.store import Store


@pytest.fixture
async def setup(tmp_path):
    store = Store(tmp_path / "engine.db")
    provider, memory = FakeProvider(), FakeProvider()
    settings = Settings(data_dir=tmp_path, image_cooldown=0, image_daily_limit=10)
    engine = Engine(store, provider, memory, settings)
    branch = make_branch()
    store.put("branch", branch)
    world = await engine.enter(branch.user_id, branch.id)
    yield store, provider, memory, engine, world
    store.close()


async def turn(engine, world, request="r1", actor="a", text="我喜欢安静", action=None, image_request=None, conversation_version=None):
    return await engine.interact(world.user_id, world.branch_id, request, world.version,
                                 actor, text, action, image_request=image_request, conversation_version=conversation_version)


async def test_independent_role_contexts_and_trace_sources(setup):
    store, provider, _, engine, world = setup
    add_message(store, actor="b", text="小白私聊凭据海星")
    result = await turn(engine, world, text="只告诉阿岚的秘密石榴", action=Action(kind="choose", target="stay"))
    decisions = [payload for task, payload in provider.calls if task == "decide"]
    assert len(decisions) == 3
    assert {d["context"]["character"]["id"] for d in decisions} == {"a", "b", "c"}
    contexts = {d["context"]["character"]["id"]: str(d) for d in decisions}
    assert "秘密石榴" in contexts["a"] and "秘密石榴" not in contexts["b"]
    assert "秘密石榴" not in contexts["c"]
    assert "私聊凭据海星" not in contexts["a"] and "私聊凭据海星" in contexts["b"]
    assert "阿岚私有暗号" not in contexts["b"] and "小白私有暗号" not in contexts["a"]
    traces = store.list("decision", world.user_id, world.branch_id)
    assert len(traces) == 3 and len({trace["context_hash"] for trace in traces}) == 3
    assert result["reply_status"] == "done"
    assert engine.world(world.user_id, world.branch_id).version == 1


async def test_background_memories_cannot_receive_other_roles_private_chat(setup):
    store, _, memory, engine, world = setup
    result = await turn(engine, world, text="只有阿岚知道的萤火虫秘密", action=Action(kind="choose", target="stay"))
    for row in result["jobs"]:
        job = Job.model_validate(row)
        before = len(memory.calls)
        await engine.run_job(job)
        new_calls = memory.calls[before:]
        if job.actor_id != "a":
            assert "萤火虫秘密" not in str(new_calls)
    assert "萤火虫秘密" in str(engine.memory.active(world.user_id, world.branch_id, "a"))
    assert not engine.memory.active(world.user_id, world.branch_id, "b")


async def test_success_replay_never_reruns_models_or_world(setup):
    store, provider, _, engine, world = setup
    result = await turn(engine, world, action=Action(kind="transfer", item="player_notebook", target="a"))
    calls = len(provider.calls)
    replay = await turn(engine, world, action=Action(kind="transfer", item="player_notebook", target="a"))
    assert result == replay and len(provider.calls) == calls
    assert engine.world(world.user_id, world.branch_id).version == 1
    assert len(store.list("message", world.user_id, world.branch_id)) == 2
    assert engine.world(world.user_id, world.branch_id).items["player_notebook"] == "a"
    with pytest.raises(ValueError, match="different input"):
        await turn(engine, world, text="用同一请求号改内容")


async def test_restart_replay_preserves_operations_and_world(setup):
    store, provider, memory, engine, world = setup
    result = await turn(engine, world)
    restarted = Engine(store, provider, memory, engine.settings)
    before = len(provider.calls)
    assert await turn(restarted, world) == result
    assert len(provider.calls) == before
    assert (await restarted.enter(world.user_id, world.branch_id)).version == 0


async def test_failure_before_commit_keeps_evidence_not_world_effects(setup):
    store, provider, _, engine, world = setup
    provider.handlers["decide"] = ProviderError("decide_failed")
    with pytest.raises(ProviderError):
        await turn(engine, world, action=Action(kind="move", target="工作室"))
    assert engine.world(world.user_id, world.branch_id) == world
    messages = store.list("message", world.user_id, world.branch_id)
    assert len(messages) == 1 and messages[0]["text"] == "我喜欢安静"
    assert not store.list("event", world.user_id, world.branch_id)
    del provider.handlers["decide"]
    result = await turn(engine, world, action=Action(kind="move", target="工作室"))
    assert result["world"]["version"] == 1
    assert len(store.list("message", world.user_id, world.branch_id)) == 2


async def test_failed_precommit_request_cannot_overwrite_original_evidence(setup):
    store, provider, _, engine, world = setup
    provider.handlers["route"] = ProviderError("route_failed")
    with pytest.raises(ProviderError):
        await turn(engine, world, text="原始人生陈述")
    del provider.handlers["route"]
    with pytest.raises(ValueError):
        await turn(engine, world, text="被覆盖成另一个陈述")
    assert store.list("message", world.user_id, world.branch_id)[0]["text"] == "原始人生陈述"


async def test_failure_after_commit_returns_failure_without_repeating_effects(setup):
    store, provider, _, engine, world = setup
    provider.handlers["reply"] = ProviderError("reply_failed")
    result = await turn(engine, world, action=Action(kind="move", target="工作室"))
    assert result["reply_status"] == "failed" and result["errors"] == ["reply_failed"]
    assert result["world"]["version"] == 1 and result["world"]["player_location"] == "工作室"
    calls = len(provider.calls)
    assert await turn(engine, world, action=Action(kind="move", target="工作室")) == result
    assert len(provider.calls) == calls


async def test_cancellation_after_commit_returns_pending_replay(setup):
    store, provider, _, engine, world = setup
    provider.handlers["reply"] = asyncio.CancelledError()
    with pytest.raises(asyncio.CancelledError):
        await turn(engine, world, action=Action(kind="move", target="工作室"))
    del provider.handlers["reply"]
    calls = len(provider.calls)
    replay = await turn(engine, world, action=Action(kind="move", target="工作室"))
    assert replay["reply_status"] == "pending" and replay["world"]["version"] == 1
    assert len(provider.calls) == calls


async def test_world_version_conflict_and_user_scope(setup):
    _, _, _, engine, world = setup
    await turn(engine, world, action=Action(kind="move", target="工作室"))
    with pytest.raises(ValueError, match="version"):
        await turn(engine, world, request="r2")
    with pytest.raises(KeyError):
        engine.world("other-user", world.branch_id)


async def test_image_success_persists_before_message_and_does_not_mutate_world(setup):
    store, provider, _, engine, world = setup
    result = await turn(engine, world, image_request="阿岚在站台的插画")
    images = [Job.model_validate(j) for j in result["jobs"] if j["kind"] == "image"]
    assert len(images) == 1 and not provider.image_calls
    assert not any(m["role"] == "image" for m in store.list("message", world.user_id, world.branch_id))
    canonical = engine.world(world.user_id, world.branch_id)
    await engine.run_job(images[0])
    saved = store.get("job", images[0].id, world.user_id)
    assert saved["status"] == "done"
    assert (engine.settings.data_dir / "images" / saved["result"]["file"]).read_bytes() == b"test-image-content"
    image_messages = [m for m in store.list("message", world.user_id, world.branch_id) if m["role"] == "image"]
    assert len(image_messages) == 1 and image_messages[0]["image_id"] == images[0].id
    assert "固定角色外观" in provider.image_calls[0] and "画风" in provider.image_calls[0]
    assert engine.world(world.user_id, world.branch_id) == canonical


@pytest.mark.parametrize("uncertain", [False, True])
async def test_image_errors_preserve_text_and_never_create_image_message(setup, uncertain):
    store, provider, _, engine, world = setup
    provider.image_prompt = "站台"
    provider.image_error = ProviderError("image_timeout", uncertain=uncertain)
    result = await turn(engine, world, image_request="站台")
    job = next(Job.model_validate(j) for j in result["jobs"] if j["kind"] == "image")
    await engine.run_job(job)
    saved = store.get("job", job.id, world.user_id)
    assert saved["status"] == ("uncertain" if uncertain else "failed")
    assert result["reply_status"] == "done"
    assert not any(m["role"] == "image" for m in store.list("message", world.user_id, world.branch_id))


async def test_image_cooldown_and_quota_count_pending_attempts(setup):
    store, provider, _, engine, world = setup
    engine.settings = replace(engine.settings, image_cooldown=300)
    first = engine.image_job(world, "a", "第一张", "i1")
    assert first is not None
    assert engine.image_job(world, "b", "第二张", "i2") is None
    engine.settings = replace(engine.settings, image_cooldown=0, image_daily_limit=1)
    assert engine.image_job(world, "b", "第二张", "i2") is None
    assert not provider.image_calls


async def test_restart_marks_image_uncertain_and_memory_pending(setup):
    store, provider, _, engine, world = setup
    image = engine.image_job(world, "a", "站台", "i1")
    memory = engine.job(world.user_id, world.branch_id, "a", "memory", {"source_ids": []}, "m1")
    for job in (image, memory):
        job.status = "running"
        store.put("job", job)
    engine.recover_jobs()
    assert store.get("job", image.id, world.user_id)["status"] == "uncertain"
    assert store.get("job", memory.id, world.user_id)["status"] == "pending"
    assert not provider.image_calls


async def test_memory_failure_preserves_messages_and_can_retry(setup):
    store, _, memory_provider, engine, world = setup
    result = await turn(engine, world)
    job = next(Job.model_validate(j) for j in result["jobs"] if j["actor_id"] == "a")
    memory_provider.handlers["memory"] = ProviderError("temporary_memory_error")
    before = store.list("message", world.user_id, world.branch_id)
    await engine.run_job(job)
    assert store.get("job", job.id, world.user_id)["status"] == "failed"
    assert store.list("message", world.user_id, world.branch_id) == before
    del memory_provider.handlers["memory"]
    await engine.run_job(job)
    assert store.get("job", job.id, world.user_id)["status"] == "done"
    assert store.get("job", job.id, world.user_id)["attempts"] == 2


async def test_scene_advance_confirmed_and_replayed_once(setup):
    store, provider, _, engine, world = setup
    with pytest.raises(ValueError):
        await engine.advance(world.user_id, world.branch_id, "unconfirmed", 0, False)
    with pytest.raises(ValueError):
        await engine.advance(world.user_id, world.branch_id, "unresolved-choice", 0, True)
    result = await turn(engine, world, action=Action(kind="choose", target="stay"))
    advanced = await engine.advance(world.user_id, world.branch_id, "next", 1, True)
    assert advanced["world"]["version"] == 2 and advanced["world"]["scene"]["chapter"] == 2
    assert len(advanced["jobs"]) == 3 and all(j["kind"] == "summary" for j in advanced["jobs"])
    calls = len(provider.calls)
    assert await engine.advance(world.user_id, world.branch_id, "next", 1, True) == advanced
    assert len(provider.calls) == calls


async def test_public_scene_generation_excludes_private_character_evidence(setup):
    store, provider, _, engine, world = setup
    event = Event(branch_id=world.branch_id, request_id="private", date=world.date,
        actor_id="a", kind="tell", accepted=True, text="只对阿岚说的私聊火山口", visibility=["a"])
    store.put("event", event, user_id=world.user_id)
    await turn(engine, world, action=Action(kind="choose", target="stay"))
    await engine.advance(world.user_id, world.branch_id, "next", 1, True)
    payload = next(payload for task, payload in provider.calls if task == "advance")
    assert "私聊火山口" not in str(payload)
    assert "私有暗号" not in str(payload)

async def test_provider_unused_optional_action_nulls_are_normalized(tmp_path):
    from parallel_life.config import Settings
    from parallel_life.interaction import Engine
    from parallel_life.store import Store
    from parallel_life.world import initialize
    from helpers import FakeProvider, make_branch
    store = Store(tmp_path / 'optional.sqlite3')
    branch = make_branch()
    store.put('world', initialize(branch))
    fake = FakeProvider()
    fake.handlers['decide'] = {'action': {'kind': 'wait', 'evidence_id': None, 'target': None}}
    engine = Engine(store, fake, fake, Settings(data_dir=tmp_path))
    result = await engine.interact('user-a', 'branch-a', 'null-test', 0, 'a', '你好', Action(kind='move', target='工作室'))
    assert result['reply_status'] == 'done'
    assert result['world']['version'] == 1
    store.close()

async def test_crash_recovery_marks_incomplete_reply_without_replaying_world(tmp_path):
    import json
    from parallel_life.config import Settings
    from parallel_life.interaction import Engine
    from parallel_life.store import Store
    from parallel_life.world import initialize
    from helpers import FakeProvider, make_branch
    store = Store(tmp_path / 'recovery.sqlite3')
    store.put('world', initialize(make_branch()))
    fake = FakeProvider()
    engine = Engine(store, fake, fake, Settings(data_dir=tmp_path))
    result = await engine.interact('user-a', 'branch-a', 'turn', 0, 'a', '记住这句话')
    store.db.execute("DELETE FROM records WHERE kind='message' AND actor_id='a'")
    result['messages'] = [m for m in result['messages'] if m['role'] == 'user']
    result['reply_status'] = 'pending'
    engine._update_result('user-a', 'branch-a', 'turn', result)
    before = engine.world('user-a', 'branch-a').version
    engine.recover_jobs()
    row = store.db.execute("SELECT body FROM operations WHERE request_id='turn'").fetchone()
    recovered = json.loads(row['body'])
    assert recovered['reply_status'] == 'failed'
    assert 'reply_interrupted_after_world_commit' in recovered['errors']
    assert engine.world('user-a', 'branch-a').version == before
    store.close()


async def test_private_chat_does_not_tick_unrelated_characters(setup):
    store, provider, _, engine, world = setup
    result = await turn(engine, world, text="我想换个话题，聊聊人工智能")
    decisions = [payload for task, payload in provider.calls if task == "decide"]
    assert decisions == []
    assert [m["text"] for m in result["messages"] if m["role"] == "user"] == ["我想换个话题，聊聊人工智能"]
    assert {j["actor_id"] for j in result["jobs"]} == {"a"}
    assert result["events"] == []
    assert result["world"]["version"] == world.version
    assert result["conversation"]["revision"] == 1
    assert result["world"]["scene"] == world.scene.model_dump()


async def test_chat_revisions_without_world_actions_and_stale_tab_guard(setup):
    store, provider, _, engine, world = setup
    first = await turn(engine, world, conversation_version=0)
    assert first['turn_mode'] == 'chat' and first['events'] == []
    assert first['world'] == world.model_dump()
    assert not store.list('decision', world.user_id, world.branch_id)
    with pytest.raises(ValueError, match='conversation version'):
        await turn(engine, world, request='stale', conversation_version=0)
    assert len(store.list('message', world.user_id, world.branch_id)) == 2
    second = await turn(engine, world, request='r2', conversation_version=1, text='接着说')
    assert second['conversation']['revision'] == 2
    assert not any(task == 'decide' for task, _ in provider.calls)
    # Each actor has a separate conversational revision.
    other = await turn(engine, world, request='other', actor='b', conversation_version=0)
    assert other['conversation']['revision'] == 1


async def test_natural_image_request_is_routed_before_role_speech(setup):
    store, provider, _, engine, world = setup
    text = '给我发一张工作室的图'
    provider.handlers['route'] = {'mode': 'image', 'source_quote': text, 'topic': '配图',
        'focus': '用户请求工作室图片', 'parked_topics': [], 'image_subject': '工作室插画'}
    # A plain reply never needs to return a second JSON image field.
    provider.handlers['reply'] = {'text': '工作室里那张旧桌子，我一直舍不得换。'}
    result = await turn(engine, world, text=text)
    assert result['media']['status'] == 'queued'
    assert result['turn_mode'] == 'image' and result['events'] == []
    assert len([j for j in result['jobs'] if j['kind'] == 'image']) == 1
    assert result['world'] == world.model_dump()
    payload = next(p for t, p in provider.calls if t == 'reply')
    assert payload['media']['status'] == 'pending'
    assert not any(t == 'decide' for t, _ in provider.calls)
    assert not provider.image_calls


async def test_explicit_image_button_replay_and_failed_speech_do_not_duplicate_media(setup):
    store, provider, _, engine, world = setup
    provider.handlers['reply'] = ProviderError('temporary_reply_failure')
    output = await turn(engine, world, image_request='工作室')
    assert output['reply_status'] == 'failed'
    images = [j for j in output['jobs'] if j['kind'] == 'image']
    assert len(images) == 1
    calls = len(provider.calls)
    assert await turn(engine, world, image_request='工作室') == output
    assert len(provider.calls) == calls
    del provider.handlers['reply']
    resumed = await engine.retry_reply(world.user_id, world.branch_id, 'r1')
    assert resumed['reply_status'] == 'done' and resumed['reply_attempts'] == 2
    assert len([j for j in resumed['jobs'] if j['kind'] == 'image']) == 1
    assert not any(task in {'route', 'decide'} for task, _ in provider.calls)
    assert len(store.list('message', world.user_id, world.branch_id)) == 2
    job = Job.model_validate(images[0])
    await engine.run_job(job)
    await engine.run_job(job)  # same stale pending handle
    assert len(provider.image_calls) == 1
    assert len([m for m in store.list('message', world.user_id, world.branch_id) if m['role'] == 'image']) == 1


async def test_reply_retry_never_repeats_committed_action(setup):
    store, provider, _, engine, world = setup
    provider.handlers['reply'] = ProviderError('reply_failed')
    output = await turn(engine, world, action=Action(kind='transfer', item='player_notebook', target='a'))
    before_events = store.list('event', world.user_id, world.branch_id)
    del provider.handlers['reply']
    before = len(provider.calls)
    resumed = await engine.retry_reply(world.user_id, world.branch_id, 'r1')
    assert resumed['reply_status'] == 'done'
    assert all(task not in {'route', 'decide'} for task, _ in provider.calls[before:])
    assert store.list('event', world.user_id, world.branch_id) == before_events
    assert engine.world(world.user_id, world.branch_id).version == 1
    count = len(provider.calls)
    assert await engine.retry_reply(world.user_id, world.branch_id, 'r1') == resumed
    assert len(provider.calls) == count


async def test_old_reply_retry_after_new_user_turn_is_rejected(setup):
    _, provider, _, engine, world = setup
    provider.handlers['reply'] = ProviderError('reply_failed')
    await turn(engine, world)
    await turn(engine, world, request='r2', text='这是较新的消息')
    before = len(provider.calls)
    with pytest.raises(ValueError, match='latest'):
        await engine.retry_reply(world.user_id, world.branch_id, 'r1')
    assert len(provider.calls) == before
    with pytest.raises(KeyError):
        await engine.retry_reply('wrong-user', world.branch_id, 'r2')


async def test_world_route_uses_one_actor_and_its_private_evidence(setup):
    store, provider, _, engine, world = setup
    text = '请你答应我，明天一起去工作室'
    provider.handlers['route'] = {'mode': 'world', 'source_quote': text, 'action_quote': text,
        'topic': '约定', 'focus': '请求明天去工作室', 'parked_topics': []}
    provider.handlers['decide'] = {'action': {'kind': 'promise', 'target': 'player',
        'content': '明天一起去工作室', 'due': '2018-06-02'}}
    result = await turn(engine, world, text=text)
    assert result['turn_mode'] == 'world'
    decisions = [p for task, p in provider.calls if task == 'decide']
    assert len(decisions) == 1 and decisions[0]['context']['character']['id'] == 'a'
    assert result['world']['promises'][0]['status'] == 'open'
    assert len(store.list('decision', world.user_id, world.branch_id)) == 1


async def test_failure_before_world_commit_reuses_route_revision(setup):
    _, provider, _, engine, world = setup
    provider.handlers['decide'] = ProviderError('failed')
    with pytest.raises(ProviderError):
        await turn(engine, world, action=Action(kind='move', target='工作室'), conversation_version=0)
    assert engine.conversation.state(world, 'a')['revision'] == 1
    del provider.handlers['decide']
    await turn(engine, world, action=Action(kind='move', target='工作室'), conversation_version=0)
    assert len([t for t, _ in provider.calls if t == 'route']) == 1


async def test_explicit_voice_edit_is_versioned_and_used_in_next_reply(setup):
    _, provider, _, engine, world = setup
    updated = await engine.edit_character(world.user_id, world.branch_id, 'a', 0, {'voice': '直接，少说客套话'})
    assert updated.version == 1 and updated.characters[0].voice == '直接，少说客套话'
    await turn(engine, updated)
    payload = next(p for task, p in provider.calls if task == 'reply')
    assert payload['role_card']['voice'] == '直接，少说客套话'

@pytest.mark.parametrize('recover', [False, True])
async def test_legacy_saved_reply_is_reused_without_paid_retry_or_raw_overwrite(setup, recover):
    import json
    store, provider, _, engine, world = setup
    result = await turn(engine, world)
    original = next(m for m in result['messages'] if m['role'] == 'assistant')
    result['reply_status'] = 'pending'
    result['messages'] = [m for m in result['messages'] if m['role'] == 'user']
    engine._update_result(world.user_id, world.branch_id, 'r1', result)
    count = len(provider.calls)
    if recover:
        engine.recover_jobs()
        result = json.loads(store.db.execute('SELECT body FROM operations').fetchone()['body'])
    else:
        result = await engine.retry_reply(world.user_id, world.branch_id, 'r1')
    assert result['reply_status'] == 'done'
    assert next(m for m in result['messages'] if m['role'] == 'assistant') == original
    assert store.get('message', original['id'], world.user_id) == original
    assert len(provider.calls) == count
    assert len([m for m in store.list('message', world.user_id, world.branch_id) if m['role'] == 'assistant']) == 1


async def test_reply_message_and_operation_commit_atomically(setup, monkeypatch):
    store, provider, _, engine, world = setup
    original_update = engine._update_result
    def crash_on_done(user, branch, request, result):
        if result.get('reply_status') == 'done':
            raise RuntimeError('simulated process failure before commit')
        return original_update(user, branch, request, result)
    monkeypatch.setattr(engine, '_update_result', crash_on_done)
    with pytest.raises(RuntimeError, match='simulated'):
        await turn(engine, world)
    assert not [m for m in store.list('message', world.user_id, world.branch_id) if m['role'] == 'assistant']
    monkeypatch.setattr(engine, '_update_result', original_update)
    engine.recover_jobs()
    retry = await engine.retry_reply(world.user_id, world.branch_id, 'r1')
    assert retry['reply_status'] == 'done'

async def test_dialogue_review_persists_only_reviewed_reply_and_is_scoped(setup):
    store, provider, _, engine, world = setup
    provider.handlers['reply'] = {'text': '（推开门）未经证实的草稿。想聊什么，慢慢说。'}
    provider.handlers['dialogue_review'] = {'keep': [1], 'issues': ['未经证实的草稿应删除']}
    result = await turn(engine, world)
    assert result['messages'][-1]['text'] == '想聊什么，慢慢说。'
    record = store.list('dialogue_review', world.user_id, world.branch_id, 'a')[0]
    assert record['draft'] == '（推开门）未经证实的草稿。想聊什么，慢慢说。'
    assert not store.list('dialogue_review', world.user_id, world.branch_id, 'b')
    assert all('未经证实的草稿' not in m['text'] for m in store.list('message', world.user_id, world.branch_id))


async def test_failed_review_is_manual_reply_retry_not_world_or_image_replay(setup):
    store, provider, _, engine, world = setup
    provider.handlers['dialogue_review'] = ProviderError('review_failed')
    result = await turn(engine, world, image_request='工作室')
    assert result['reply_status'] == 'failed'
    assert all(m['role'] == 'user' for m in result['messages'])
    del provider.handlers['dialogue_review']
    result = await engine.retry_reply(world.user_id, world.branch_id, 'r1')
    assert result['reply_status'] == 'done'
    assert len([j for j in store.list('job', world.user_id, world.branch_id) if j['kind'] == 'image']) == 1

async def test_opt_in_proactive_image_is_one_bounded_chat_job(tmp_path):
    from parallel_life.config import Settings
    from parallel_life.interaction import Engine
    from parallel_life.store import Store
    from parallel_life.world import initialize
    from helpers import FakeProvider, make_branch
    store = Store(tmp_path / 'proactive.sqlite3')
    world = initialize(make_branch());store.put('world', world)
    provider = FakeProvider()
    provider.handlers['route'] = {'mode': 'chat', 'source_quote': '窗外的夕阳真好看', 'topic': '夕阳',
        'focus': '看风景', 'parked_topics': [], 'proactive_image_subject': '窗外的夕阳'}
    engine = Engine(store, provider, provider, Settings(data_dir=tmp_path, proactive_images=True))
    result = await engine.interact(world.user_id,world.branch_id,'p1',0,'a','窗外的夕阳真好看')
    assert result['turn_mode'] == 'chat' and result['world']['version'] == 0
    assert result['media']['proactive'] and len([j for j in result['jobs'] if j['kind']=='image']) == 1
    second = await engine.interact(world.user_id,world.branch_id,'p2',0,'a','窗外的夕阳真好看')
    assert second['media']['status'] == 'limited'
    assert not [j for j in second['jobs'] if j['kind']=='image']
    store.close()

async def test_natural_image_only_route_skips_speech_but_mixed_request_keeps_it(setup):
    _, provider, _, engine, world = setup
    text='给我发张工作室的图'
    provider.handlers['route']={'mode':'image','source_quote':text,'topic':'索图','focus':text,
        'parked_topics':[],'image_subject':'工作室','image_only':True}
    result=await turn(engine,world,text=text)
    assert result['reply_status']=='not_requested'
    assert all(task not in {'reply','dialogue_review'} for task,_ in provider.calls)
    provider.handlers['route']['image_only']=False
    result=await turn(engine,world,request='mixed',text=text+'。你今天高兴吗？')
    assert result['reply_status']=='done'
    assert any(task=='reply' for task,_ in provider.calls)
