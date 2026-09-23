#!/usr/bin/env python3
"""Real-model compression/retrieval over 35 explicitly constructed test messages.

This is NOT a claim that 35 live conversational turns were executed.
"""
import asyncio
import json
from pathlib import Path
from serve import load_env, ROOT

load_env()
from parallel_life.config import Settings
from parallel_life.memory import MemoryEngine
from parallel_life.models import Character, Message, Scene, World
from parallel_life.providers import OpenAICompatibleProvider
from parallel_life.store import Store
from parallel_life.world import visible_state


async def main():
    settings = Settings.from_env()
    folder = settings.data_dir / "memory-acceptance"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / "test.sqlite3"
    store = Store(path)
    provider = OpenAICompatibleProvider(settings, role="memory")
    world = World(branch_id="compression-check", user_id="synthetic-memory-check",
        date="2008-09-01", identity="测试人物", locations=["画室"], player_location="画室",
        characters=[Character(id="c1", name="阿宁", persona="耐心的朋友", goal="了解朋友",
                              location="画室")], scene=Scene(title="谈画", description="画室里的闲谈"))
    for i in range(35):
        text = "我最喜欢雨后松木的气味，这件事请记住。" if i == 0 else f"第{i}条测试原文：我们今天在画室讨论构图练习。"
        store.put("message", Message(id=f"fixture-{i}", user_id=world.user_id,
            branch_id=world.branch_id, actor_id="player", role="user", text=text,
            visibility=["c1"], request_id=f"fixture-{i}"))
    memory = MemoryEngine(store, provider)
    await memory.compress(world.user_id, world.branch_id, "c1")
    count = len(memory.messages(world.user_id, world.branch_id, "c1"))
    records = [m.model_dump() for m in memory.active(world.user_id, world.branch_id, "c1")]
    assert len(records) >= 2 and count == 35
    store.close()
    store = Store(path)
    memory = MemoryEngine(store, provider)
    context = memory.context(world, "c1", "你还记得我最喜欢哪种气味吗？", visible_state(world, "c1"))
    assert len(context["recent"]) == 20
    assert all("雨后松木" not in m["text"] for m in context["recent"])
    reply = await provider.json("reply", {"context": context, "input": "你还记得我最喜欢哪种气味吗？", "outcomes": []})
    assert "松木" in reply["text"], reply
    report = {"provider": "live Ark", "fixture_messages": 35, "raw_messages_after_compression": count,
              "recent_messages": 20, "reopened_database": True, "summaries": records, "reply": reply,
              "note": "Constructed evidence fixture; real model compression and post-restart reply."}
    target = ROOT / "docs/evidence/live-memory.json"
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    store.close()
    print("PASS real-model compression -> reopen -> recall old preference absent from recent 20 messages")


if __name__ == "__main__":
    asyncio.run(main())
