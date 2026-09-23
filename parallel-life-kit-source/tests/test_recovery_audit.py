"""Independent fault-window regressions; injected models only, no live calls."""
import asyncio
import json

import pytest

from helpers import FakeProvider, make_branch
from parallel_life.config import Settings
from parallel_life.interaction import Engine
from parallel_life.memory import stable_id
from parallel_life.models import Job, Message
from parallel_life.providers import ProviderError
from parallel_life.store import Store


@pytest.fixture
async def setup(tmp_path):
    store, provider, memory = Store(tmp_path / "audit.sqlite3"), FakeProvider(), FakeProvider()
    engine = Engine(store, provider, memory, Settings(data_dir=tmp_path))
    branch = make_branch()
    store.put("branch", branch)
    world = await engine.enter(branch.user_id, branch.id)
    yield store, provider, memory, engine, world
    store.close()


def saved_result(store, world, request="audit-turn"):
    row = store.db.execute("SELECT body FROM operations WHERE user_id=? AND scope=? AND request_id=?",
                           (world.user_id, world.branch_id, request)).fetchone()
    return json.loads(row["body"])


async def failed_turn(setup):
    _, provider, _, engine, world = setup
    provider.handlers["reply"] = ProviderError("provider_http_error", status_code=429)
    return await engine.interact(world.user_id, world.branch_id, "audit-turn", world.version, "a", "今天想喝热茶")


async def test_recovery_preserves_new_evidence_merged_into_running_job(setup):
    store, provider, _, engine, world = setup
    output = await failed_turn(setup)
    job = Job.model_validate(output["jobs"][0])
    job.status = "running"
    store.put("job", job)
    # Reproduce the legacy window: saved reply, pending operation, running old job.
    output["reply_status"] = "pending"
    engine._update_result(world.user_id, world.branch_id, "audit-turn", output)
    reply = Message(id=stable_id(world.branch_id, "audit-turn", "a", "reply"), user_id=world.user_id,
        branch_id=world.branch_id, actor_id="a", role="assistant", text="好，慢慢喝。",
        visibility=["a"], request_id="audit-turn")
    store.put("message", reply)
    calls = len(provider.calls)
    engine.recover_jobs()
    updated = store.get("job", job.id, world.user_id)
    assert updated["status"] == "pending"
    assert set(updated["payload"]["source_ids"]) == {output["messages"][0]["id"], reply.id}
    assert len(provider.calls) == calls
    assert saved_result(store, world)["reply_status"] == "done"
    assert store.get("message", reply.id, world.user_id) == reply.model_dump()
    assert engine.world(world.user_id, world.branch_id) == world


async def test_successful_manual_retry_clears_previous_http_error_status(setup):
    store, provider, _, engine, world = setup
    output = await failed_turn(setup)
    assert output["provider_status"] == 429
    del provider.handlers["reply"]
    result = await engine.retry_reply(world.user_id, world.branch_id, "audit-turn")
    assert result["reply_status"] == "done" and result["errors"] == []
    assert "provider_status" not in result and "provider_status" not in saved_result(store, world)
    assert len([m for m in store.list("message", world.user_id, world.branch_id) if m["role"] == "assistant"]) == 1
    calls = len(provider.calls)
    assert await engine.retry_reply(world.user_id, world.branch_id, "audit-turn") == result
    assert len(provider.calls) == calls


async def test_inflight_memory_job_requeues_with_retry_reply_evidence(setup):
    store, provider, memory, engine, world = setup
    output = await failed_turn(setup)
    job = Job.model_validate(output["jobs"][0])
    started, release = asyncio.Event(), asyncio.Event()

    async def delayed(payload):
        started.set()
        await release.wait()
        return {"items": []}

    memory.handlers["memory"] = delayed
    running = asyncio.create_task(engine.run_job(job))
    await started.wait()
    del provider.handlers["reply"]
    retried = await engine.retry_reply(world.user_id, world.branch_id, "audit-turn")
    expected = {m["id"] for m in retried["messages"]}
    assert len(expected) == 2
    assert set(store.get("job", job.id, world.user_id)["payload"]["source_ids"]) == expected
    release.set()
    await running
    pending = Job.model_validate(store.get("job", job.id, world.user_id))
    assert pending.status == "pending" and pending.attempts == 0
    assert set(pending.payload["source_ids"]) == expected
    memory.handlers["memory"] = {"items": []}
    await engine.run_job(pending)
    calls = [payload for task, payload in memory.calls if task == "memory"]
    assert len(calls) == 2 and {source["id"] for source in calls[-1]["sources"]} == expected
    assert store.get("job", job.id, world.user_id)["status"] == "done"
    assert engine.world(world.user_id, world.branch_id) == world


async def test_review_failure_is_one_attempt_and_only_explicit_retry_resumes(setup):
    store, provider, _, engine, world = setup
    provider.handlers["dialogue_review"] = ProviderError("provider_http_error", status_code=503)
    result = await engine.interact(world.user_id, world.branch_id, "audit-turn", 0, "a", "今天想喝热茶")
    assert result["reply_status"] == "failed"
    assert [task for task, _ in provider.calls].count("reply") == 1
    assert [task for task, _ in provider.calls].count("dialogue_review") == 1
    assert not [m for m in store.list("message", world.user_id, world.branch_id) if m["role"] == "assistant"]
    calls = len(provider.calls)
    await engine.interact(world.user_id, world.branch_id, "audit-turn", 0, "a", "今天想喝热茶")
    assert len(provider.calls) == calls
    del provider.handlers["dialogue_review"]
    retried = await engine.retry_reply(world.user_id, world.branch_id, "audit-turn")
    assert retried["reply_status"] == "done"
    assert [task for task, _ in provider.calls].count("dialogue_review") == 2
    reviews = store.list("dialogue_review", world.user_id, world.branch_id, "a")
    assert len(reviews) == 1 and not store.list("dialogue_review", world.user_id, world.branch_id, "b")
