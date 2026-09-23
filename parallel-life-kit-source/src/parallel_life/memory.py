"""Evidence-first memory; deterministic scope filtering happens BEFORE ranking."""
from __future__ import annotations

import hashlib
import json
import re
import time

from .models import Memory, World, uid
from .store import Store


def terms(text: str) -> set[str]:
    words = set(re.findall(r"[a-z0-9_]+", text.casefold()))
    for run in re.findall(r"[\u3400-\u9fff]+", text):
        words.update(run[i:i + 2] for i in range(max(1, len(run) - 1)))
    return words


def stable_id(*parts: str) -> str:
    return hashlib.sha256("\0".join(parts).encode()).hexdigest()[:32]


class MemoryEngine:
    def __init__(self, store: Store, provider, context_chars: int = 24000):
        self.store, self.provider, self.context_chars = store, provider, context_chars

    def messages(self, user: str, branch: str, actor: str) -> list[dict]:
        return [m for m in self.store.list("message", user, branch)
                if actor in m["visibility"] and m["role"] != "image"]

    def evidence(self, user: str, branch: str, actor: str) -> dict[str, dict]:
        rows = self.messages(user, branch, actor)
        rows += [e for e in self.store.list("event", user, branch)
                 if actor in e["visibility"]]
        return {r["id"]: r for r in rows}

    def active(self, user: str, branch: str, actor: str) -> list[Memory]:
        blocked = self.blocked_sources(user, branch, actor)
        return [Memory.model_validate(m) for m in self.store.list("memory", user, branch, actor)
                if m["status"] == "active" and (m["source_type"] == "user_correction" or
                    (m["id"] not in blocked and not set(m["source_ids"]) & blocked))]

    def _expand_sources(self, user: str, branch: str, actor: str,
                        roots: set[str], records: list[dict]) -> set[str]:
        """Follow provenance forward, not text similarity or summary co-occurrence.

        A reply to the source turn can repeat it, and a summary can repeat that
        reply. Do not turn unrelated messages in the same summary into roots.
        Later paraphrases without a provenance link are not discoverable here.
        """
        blocked = set(roots)
        evidence = self.evidence(user, branch, actor)
        while True:
            before = len(blocked)
            requests = {row["request_id"] for ident, row in evidence.items()
                        if ident in blocked and row.get("request_id")}
            blocked.update(row["id"] for row in evidence.values()
                           if row.get("role") == "assistant" and row.get("request_id") in requests)
            blocked.update(m["id"] for m in records if m["source_type"] != "user_correction"
                           and set(m["source_ids"]) & blocked)
            if len(blocked) == before:
                return blocked

    def blocked_sources(self, user: str, branch: str, actor: str) -> set[str]:
        records = self.store.list("memory", user, branch, actor)
        edits = self.store.list("memory_edit", user, branch, actor)
        covered = {ident for edit in edits for ident in edit["record_ids"]}
        corrected = {m["key"] for m in records if m["source_type"] == "user_correction"}
        # Automatic memory replacement is not a request to forget the original dialogue.
        # New edits retain exact roots separately from invalidated derived summaries.
        roots = {s for edit in edits for s in edit["source_ids"]}
        roots.update(s for m in records if m["id"] not in covered and (m["status"] == "forgotten" or
                     (m["status"] == "superseded" and m["key"] in corrected)) for s in m["source_ids"])
        return self._expand_sources(user, branch, actor, roots, records)

    @staticmethod
    def assistant_only(source_ids: list[str], evidence: dict[str, dict]) -> bool:
        return bool(source_ids) and all(evidence.get(s, {}).get("role") == "assistant"
                                        for s in source_ids)

    def context(self, world: World, actor: str, query: str, visible: dict) -> dict:
        character = next(c for c in world.characters if c.id == actor)
        blocked = self.blocked_sources(world.user_id, world.branch_id, actor)
        character = character.model_copy(deep=True)
        character.knowledge = [k for k in character.knowledge
                               if character.knowledge_sources.get(k) not in blocked]
        character.knowledge_sources = {k: v for k, v in character.knowledge_sources.items()
                                       if v not in blocked}
        visible = json.loads(json.dumps(visible))
        if "self" in visible:
            visible["self"] = character.model_dump()
        recent = [m for m in self.messages(world.user_id, world.branch_id, actor)
                  if m["id"] not in blocked][-20:]
        query_terms = terms(query)
        background_terms = terms(character.goal + " " + world.scene.title)
        recent_ids = {m["id"] for m in recent}
        records = self.active(world.user_id, world.branch_id, actor)
        evidence = self.evidence(world.user_id, world.branch_id, actor)
        # Keep original utterances in recent dialogue, not a second copy as "knowledge".
        records = [m for m in records if m.source_type != "agent_inference" or
                   not self.assistant_only(m.source_ids, evidence)]
        records = [m for m in records if m.source_type == "user_correction" or
                   not (m.source_ids and set(m.source_ids) <= recent_ids)]
        # Old guesses must match what the user is discussing, not just the NPC's goal.
        records = [m for m in records if m.source_type != "agent_inference" or
                   bool(query_terms & terms(m.text))]
        ranked = sorted(records, key=lambda m: (
            m.source_type == "user_correction",
            3 * len(query_terms & terms(m.text)) + m.importance,
            len(background_terms & terms(m.text)),
            m.created_at), reverse=True)
        # System constraints and recent messages are never silently truncated.
        result = {"character": character.model_dump(), "world": visible,
                  "recent": recent, "memories": []}
        size = len(json.dumps(result, ensure_ascii=False))
        if size > self.context_chars:
            raise ValueError("context budget exceeded: shorten input or increase context_chars")
        for record in ranked:
            item = record.model_dump()
            cost = len(json.dumps(item, ensure_ascii=False))
            if size + cost <= self.context_chars:
                result["memories"].append(item)
                size += cost
        result["budget"] = {"characters": size, "limit": self.context_chars}
        return result

    async def derive(self, user: str, branch: str, actor: str, source_ids: list[str]):
        all_evidence = self.evidence(user, branch, actor)
        blocked = self.blocked_sources(user, branch, actor)
        sources = [all_evidence[s] for s in source_ids if s in all_evidence and s not in blocked]
        if not sources:
            return
        response = await self.provider.json("memory", {"sources": sources,
            "existing": [m.model_dump() for m in self.active(user, branch, actor)][-30:]})
        valid_ids = {s["id"] for s in sources}
        candidates = response.get("items", [])
        if not isinstance(candidates, list) or len(candidates) > 12:
            raise ValueError("invalid memory extraction")
        with self.store.transaction():
            blocked = self.blocked_sources(user, branch, actor)
            for item in candidates:
                sources_used = item.get("source_ids", [])
                if not sources_used or not set(sources_used) <= valid_ids:
                    raise ValueError("memory references invisible or nonexistent evidence")
                if set(sources_used) & blocked:
                    continue
                if self.assistant_only(sources_used, all_evidence):
                    continue  # saying something does not create independent evidence for it
                source_type = item.get("source_type", "agent_inference")
                if source_type == "user_statement" and not all(
                    all_evidence[s].get("role") == "user" for s in sources_used
                ):
                    source_type = "agent_inference"
                if source_type == "event" and not all(
                    all_evidence[s].get("accepted") is True for s in sources_used
                ):
                    source_type = "agent_inference"
                if source_type == "event" and any(
                    all_evidence[s].get("kind") in {"propose", "tell"} for s in sources_used
                ):
                    source_type = "agent_inference"  # statement content is not an executed fact
                if source_type not in {"user_statement", "event", "agent_inference"}:
                    source_type = "agent_inference"
                kind = item.get("kind", "belief")
                if kind not in {"preference", "episode", "belief"}:
                    kind = "belief"
                if source_type == "agent_inference":
                    kind = "belief"
                key = str(item.get("key", ""))[:200]
                text = str(item.get("text", "")).strip()[:3000]
                if not key or not text:
                    raise ValueError("empty memory")
                old = [m for m in self.active(user, branch, actor) if m.key == key]
                if any(m.source_type == "user_correction" for m in old):
                    continue  # explicit corrections outrank later inference
                if any(m.source_type == "user_statement" for m in old) and source_type == "agent_inference":
                    continue
                ident = stable_id(branch, actor, key, *sorted(sources_used))
                record = Memory(id=ident, user_id=user, branch_id=branch, actor_id=actor,
                    kind=kind, key=key, text=text, source_type=source_type,
                    source_ids=sources_used, importance=item.get("importance", .5), created_at=time.time())
                for prior in old:
                    if prior.id != ident:
                        prior.status = "superseded"
                        self.store.put("memory", prior)
                self.store.put("memory", record)

    async def compress(self, user: str, branch: str, actor: str, *, scene_end=False):
        blocked = self.blocked_sources(user, branch, actor)
        messages = [m for m in self.messages(user, branch, actor) if m["id"] not in blocked]
        covered = {s for m in self.active(user, branch, actor)
                   if m.kind == "summary" for s in m.source_ids}
        eligible = messages if scene_end else messages[:-20]
        pending = [m for m in eligible if m["id"] not in covered]
        for offset in range(0, len(pending), 10):
            group = pending[offset:offset + 10]
            if not group:
                continue
            response = await self.provider.json("summary", {"messages": group,
                "instruction": "保留关键原话、未答问题、承诺和因果；推断须标明。"})
            text = str(response.get("text", "")).strip()
            if not text or len(text) > 4000:
                raise ValueError("invalid summary")
            ids = [m["id"] for m in group]
            if set(ids) & self.blocked_sources(user, branch, actor):
                continue  # an in-flight compression may finish after user correction
            record = Memory(id=stable_id(branch, actor, "summary", *ids), user_id=user,
                branch_id=branch, actor_id=actor, kind="summary", key="chunk:" + ids[0],
                text=text, source_type="summary", source_ids=ids, created_at=time.time())
            self.store.put("memory", record)

    def edit(self, user: str, branch: str, actor: str, ident: str, operation: str, text: str = ""):
        record = Memory.model_validate(self.store.get("memory", ident, user))
        if (record.branch_id, record.actor_id) != (branch, actor):
            raise KeyError("memory not found")
        if operation not in {"correct", "forget"} or (operation == "correct" and not text.strip()):
            raise ValueError("invalid memory edit")
        with self.store.transaction():
            records = self.store.list("memory", user, branch, actor)
            roots = {s for m in records if m["key"] == record.key for s in m["source_ids"]}
            blocked = self._expand_sources(user, branch, actor, roots, records)
            related = [m for m in records if m["key"] == record.key or m["id"] in blocked
                       or set(m["source_ids"]) & blocked]
            for row in related:
                row["status"] = "forgotten" if operation == "forget" else "superseded"
                self.store.put("memory", row)
            self.store.put("memory_edit", {"id": uid(), "user_id": user, "branch_id": branch,
                "actor_id": actor, "operation": operation, "memory_id": ident,
                "source_ids": sorted(roots), "record_ids": [m["id"] for m in related]})
            if operation == "correct":
                replacement = Memory(user_id=user, branch_id=branch, actor_id=actor,
                    kind="correction", key=record.key, text=text.strip()[:3000],
                    source_type="user_correction", source_ids=record.source_ids,
                    importance=1, created_at=time.time())
                self.store.put("memory", replacement)
                return replacement.model_dump()
        return {"status": "forgotten"}
