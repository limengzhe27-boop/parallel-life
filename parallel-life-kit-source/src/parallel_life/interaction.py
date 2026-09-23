"""Bounded multi-agent turns. Model proposals never write canonical state."""
from __future__ import annotations

import asyncio
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
import time

from . import world as kernel
from .config import Settings
from .memory import MemoryEngine, stable_id
from .conversation import ConversationEngine
from .dialogue import review_context, select_reviewed_dialogue
from .models import Action, Branch, Character, Decision, Job, Message, World
from .providers import ProviderError
from .store import Store


def fingerprint(value: dict) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


class Engine:
    def __init__(self, store: Store, provider, memory_provider, settings: Settings,
                 executor=kernel):
        self.store, self.provider, self.settings, self.executor = store, provider, settings, executor
        self.memory = MemoryEngine(store, memory_provider, settings.context_chars)
        self.conversation = ConversationEngine(store, provider, proactive_images=settings.proactive_images)
        self.locks = defaultdict(asyncio.Lock)
        self.tasks: set[asyncio.Task] = set()
        self.job_slots: dict[str, asyncio.Task] = {}

    def world(self, user: str, branch: str) -> World:
        return World.model_validate(self.store.get("world", branch, user))

    async def enter(self, user: str, branch: str) -> World:
        async with self.locks[branch]:
            try:
                return self.world(user, branch)
            except KeyError:
                value = Branch.model_validate(self.store.get("branch", branch, user))
                world = self.executor.initialize(value)
                self.store.put("world", world)
                return world

    def job(self, user: str, branch: str, actor: str, kind: str, payload: dict, key: str) -> Job:
        ident = stable_id(branch, actor, kind, key)
        try:
            return Job.model_validate(self.store.get("job", ident, user))
        except KeyError:
            job = Job(id=ident, user_id=user, branch_id=branch, actor_id=actor,
                      kind=kind, payload=payload, created_at=time.time())
            self.store.put("job", job)
            return job

    def image_job(self, world: World, actor: str, prompt: str, request: str) -> Job | None:
        now = time.time()
        jobs = [j for j in self.store.list("job", world.user_id, world.branch_id)
                if j["kind"] == "image"]
        day = datetime.fromtimestamp(now, timezone.utc).date()
        daily = [j for j in jobs if datetime.fromtimestamp(j["created_at"], timezone.utc).date() == day]
        if len(daily) >= self.settings.image_daily_limit or any(
            now - j["created_at"] < self.settings.image_cooldown for j in jobs
        ):
            return None
        char = next(c for c in world.characters if c.id == actor)
        full_prompt = f"固定角色外观：{char.appearance}\n画风：{char.style}\n当前场景：{world.scene.title}\n画面：{prompt[:2500]}"
        return self.job(world.user_id, world.branch_id, actor, "image",
                        {"prompt": full_prompt, "caption": prompt[:2500], "request_id": request}, request)

    async def _decide(self, world: World, char: Character, text: str, request: str):
        context = self.memory.context(world, char.id, text,
                                      self.executor.visible_state(world, char.id))
        result = await self.provider.json("decide", {"context": context, "input": text})
        raw = result.get("action", {})
        if not isinstance(raw, dict):
            raise ProviderError("invalid_character_decision")
        optional = {"target", "content", "item", "promise_id", "due", "condition", "evidence_id"}
        raw = {k: v for k, v in raw.items() if not (k in optional and v is None)}
        try:
            action = Action.model_validate(raw)
        except ValueError:
            raise ProviderError("invalid_character_decision") from None
        decision = Decision(actor_id=char.id, action=action,
                            rationale=str(result.get("rationale", ""))[:2000])
        trace = {"id": stable_id(world.branch_id, request, char.id, "decision"),
            "user_id": world.user_id, "branch_id": world.branch_id, "actor_id": char.id,
            "request_id": request, "context_hash": fingerprint(context),
            "source_ids": [m["id"] for m in context["recent"]],
            "goal": char.goal, "decision": decision.model_dump()}
        return decision, trace

    async def interact(self, user: str, branch: str, request: str, version: int,
                       actor: str, text: str, user_action: Action | None = None, *,
                       image_request: str | None = None, image_only: bool = False,
                       conversation_version: int | None = None) -> dict:
        inputs = {"version": version, "actor": actor, "text": text,
                  "action": user_action.model_dump() if user_action else None}
        # Preserve old fingerprints when optional fields are absent.
        if image_request is not None:
            inputs["image_request"] = image_request
        if image_only:
            inputs["image_only"] = True
        if conversation_version is not None:
            inputs["conversation_version"] = conversation_version
        mark = fingerprint(inputs)
        async with self.locks[branch]:
            cached = self.store.operation(user, branch, request, mark)
            if cached is not None:
                return cached
            world = self.world(user, branch)
            if world.version != version:
                raise ValueError("world version conflict; reload before retrying")
            if actor not in {c.id for c in world.characters}:
                raise ValueError("unknown character")
            if not text.strip() or len(text) > 3000:
                raise ValueError("message must contain 1 to 3000 characters")
            if image_request is not None and (not image_request.strip() or len(image_request) > 1500):
                raise ValueError("image request must contain 1 to 1500 characters")
            if image_only and (image_request is None or user_action is not None):
                raise ValueError("image_only requires image_request and no world action")
            ident = stable_id(branch, request, "user")
            state = self.conversation.state(world, actor) or {}
            if (conversation_version is not None and conversation_version != state.get("revision", 0)
                    and state.get("last_user_message_id") != ident):
                raise ValueError("conversation version conflict; reload before retrying")
            self.store.claim(user, branch, request, mark)
            message = Message(id=ident, user_id=user, branch_id=branch, actor_id="player",
                              role="user", text=text, visibility=[actor], request_id=request)
            self.store.put("message", message)  # preserve evidence before model calls
            plan = await self.conversation.plan(world, actor, text, ident, image_request=image_request)
            mode = "world" if user_action is not None else plan["mode"]
            needs_reply = not (image_only or (mode == "image" and plan.get("image_only")))
            # Chat/media do not tick the world. Only explicit action intent invokes it.
            active = [c for c in world.characters if c.id == actor or user_action is not None]
            traces, events = [], []
            updated = world
            if mode == "world":
                planned = await asyncio.gather(*(self._decide(world, char,
                    text if char.id == actor else "根据自己的目标与当前可见场景选择一次行动。", request)
                    for char in active[:3]))
                decisions, traces = [p[0] for p in planned], [p[1] for p in planned]
                updated, events = self.executor.settle(world, decisions, user_action, request)
            output = {"world": updated.model_dump(), "messages": [message.model_dump()],
                      "events": [e.model_dump() for e in events], "jobs": [], "errors": [],
                      "reply_status": "pending" if needs_reply else "not_requested", "turn_mode": mode,
                      "conversation": plan["state"], "media": {"status": "none"},
                      "reply_attempts": 0}
            # Persist effects and image reservation once, before generating role speech.
            with self.store.transaction():
                if mode == "world":
                    self.store.put("world", updated)
                for event in events:
                    self.store.put("event", event, user_id=user)
                for trace in traces:
                    self.store.put("decision", trace)
                subject = plan.get("image_subject")
                if subject and (plan["mode"] == "image" or image_request is not None or plan.get("proactive_image")):
                    job = self.image_job(updated, actor, subject, request)
                    if job:
                        output["jobs"].append(job.model_dump())
                        output["media"] = {"status": "queued", "subject": subject, "job_id": job.id,
                                           "proactive": bool(plan.get("proactive_image"))}
                    else:
                        output["media"] = {"status": "limited", "subject": subject}
                        output["errors"].append("image_limit_reached")
                self.store.finish(user, branch, request, mark, output)
            if needs_reply:
                await self._reply(user, branch, request, actor, text, updated, output)
            self._memory_jobs(updated, actor, request, output)
            self._update_result(user, branch, request, output)
            return output

    def _memory_jobs(self, world: World, actor: str, request: str, output: dict):
        # Derive only from each actor's visible evidence, not everybody's conversation.
        for char in world.characters:
            ids = [m["id"] for m in output["messages"] if char.id in m["visibility"]]
            ids += [e["id"] for e in output["events"] if char.id in e["visibility"]]
            if not ids:
                continue
            job = self.job(world.user_id, world.branch_id, char.id, "memory", {"source_ids": ids}, request)
            # Reply-only retry may append newly generated speech to the same evidence job.
            job.payload["source_ids"] = list(dict.fromkeys(job.payload["source_ids"] + ids))
            if job.status in {"done", "failed"} and set(ids) != set(self.store.get("job", job.id, world.user_id)["payload"]["source_ids"]):
                job.status, job.attempts = "pending", 0
            self.store.put("job", job)
            output["jobs"] = [j for j in output["jobs"] if j["id"] != job.id] + [job.model_dump()]

    async def _reply(self, user: str, branch: str, request: str, actor: str,
                     text: str, world: World, output: dict):
        output["reply_attempts"] = output.get("reply_attempts", 0) + 1
        output["reply_status"] = "pending"
        output["errors"] = [e for e in output["errors"] if e == "image_limit_reached"]
        self._update_result(user, branch, request, output)
        try:
            context = self.memory.context(world, actor, text, self.executor.visible_state(world, actor))
            role_card = await self.conversation.role_card(world, actor)
            media = dict(output.get("media", {"status": "none"}))
            if media.get("job_id"):
                media["status"] = self.store.get("job", media["job_id"], user)["status"]
            payload = {"context": context, "input": text,
                "outcomes": [e for e in output["events"] if actor in e["visibility"]],
                "conversation": self.conversation.state(world, actor) or {},
                "role_card": role_card, "media": media}
            reply = await self.provider.reply(payload)
            review = None
            if self.settings.dialogue_review:
                draft = reply
                prepared = review_context(payload, draft)
                if not prepared["sentences"]:
                    raise ProviderError("dialogue_draft_rejected")
                review = await self.provider.json("dialogue_review", prepared)
                # Retain failed model drafts privately for diagnosis, not as dialogue or memory.
                self.store.put("dialogue_review_attempt", {
                    "id": stable_id(branch, request, actor, str(output["reply_attempts"]), "review_attempt"),
                    "user_id": user, "branch_id": branch, "actor_id": actor, "request_id": request,
                    "draft": draft, "sentences": prepared["sentences"], "review": review})
                reply = select_reviewed_dialogue(prepared["sentences"], review)
                review = {"id": stable_id(branch, request, actor, "review"), "user_id": user,
                    "branch_id": branch, "actor_id": actor, "request_id": request,
                    "draft": draft, "text": reply, "issues": review["issues"],
                    "source_ids": [m["id"] for m in context["recent"]]}
            if not isinstance(reply, str) or not reply.strip() or len(reply) > 6000:
                raise ValueError("invalid character reply")
            response = Message(id=stable_id(branch, request, actor, "reply"), user_id=user,
                branch_id=branch, actor_id=actor, role="assistant", text=reply.strip(),
                visibility=[actor], request_id=request)
            with self.store.transaction():
                self.store.put("message", response)
                if review is not None:
                    self.store.put("dialogue_review", review)
                output.pop("provider_status", None)
                output["messages"] = [m for m in output["messages"] if m["id"] != response.id] + [response.model_dump()]
                output["reply_status"] = "done"
                output["conversation"] = self.conversation.state(world, actor) or {}
                self._memory_jobs(world, actor, request, output)
                self._update_result(user, branch, request, output)
        except (ProviderError, ValueError) as exc:
            output["reply_status"] = "failed"
            output["errors"].append(exc.code if isinstance(exc, ProviderError) else "invalid_reply")
            output["provider_status"] = getattr(exc, "status_code", None)

    async def retry_reply(self, user: str, branch: str, request: str) -> dict:
        """Explicit latest-turn retry; never repeat world effects or image generation."""
        async with self.locks[branch]:
            world = self.world(user, branch)
            with self.store.lock:
                row = self.store.db.execute("SELECT body FROM operations WHERE user_id=? AND scope=? AND request_id=?",
                                           (user, branch, request)).fetchone()
            if not row:
                raise KeyError("turn not found")
            output = json.loads(row["body"])
            if "reply_status" not in output:
                raise ValueError("operation is not a dialogue turn")
            if output["reply_status"] in {"done", "not_requested"}:
                return output
            message = next(m for m in output["messages"] if m["role"] == "user")
            actor = message["visibility"][0]
            if self._reuse_saved_reply(user, branch, request, actor, world, output):
                return output
            recent = self.memory.messages(user, branch, actor)
            latest = next((m for m in reversed(recent) if m["role"] == "user"), None)
            blocked = self.memory.blocked_sources(user, branch, actor)
            if latest is None or latest["id"] != message["id"] or message["id"] in blocked:
                raise ValueError("only the latest unforgotten turn can be retried")
            if world.version != output["world"]["version"]:
                raise ValueError("world changed after this turn; send a new message")
            await self._reply(user, branch, request, actor, message["text"], world, output)
            self._memory_jobs(world, actor, request, output)
            self._update_result(user, branch, request, output)
            return output

    def _reuse_saved_reply(self, user: str, branch: str, request: str, actor: str,
                          world: World, output: dict) -> bool:
        # Recover the pre-atomic-commit version's crash window without rewriting evidence.
        try:
            saved = self.store.get("message", stable_id(branch, request, actor, "reply"), user)
        except KeyError:
            return False
        if saved["branch_id"] != branch or saved["actor_id"] != actor or saved["request_id"] != request:
            raise ValueError("saved reply scope mismatch")
        with self.store.transaction():
            output["messages"] = [m for m in output["messages"] if m["id"] != saved["id"]] + [saved]
            output["reply_status"] = "done"
            output.pop("provider_status", None)
            output["errors"] = [e for e in output["errors"] if e == "image_limit_reached"]
            self._memory_jobs(world, actor, request, output)
            self._update_result(user, branch, request, output)
        return True

    def _update_result(self, user: str, branch: str, request: str, result: dict):
        with self.store.lock:
            self.store.db.execute("UPDATE operations SET body=? WHERE user_id=? AND scope=? AND request_id=?",
                (json.dumps(result, ensure_ascii=False), user, branch, request))

    async def advance(self, user: str, branch: str, request: str, version: int, confirmed: bool):
        mark = fingerprint({"advance": True, "version": version, "confirmed": confirmed})
        async with self.locks[branch]:
            cached = self.store.operation(user, branch, request, mark)
            if cached is not None:
                return cached
            self.store.claim(user, branch, request, mark)
            world = self.world(user, branch)
            if world.version != version or not confirmed:
                raise ValueError("explicit confirmation and current version required")
            if world.scene.options and world.scene.chosen is None:
                raise ValueError("choose the current scene's key decision first")
            audience = {c.id for c in world.characters} | {"player"}
            public_world = {"date": world.date, "scene": world.scene.model_dump(),
                "locations": world.locations, "player_location": world.player_location,
                "characters": [{"id": c.id, "name": c.name, "location": c.location}
                               for c in world.characters if c.location == world.player_location],
                "promises": [p.model_dump() for p in world.promises if audience <= set(p.visibility)]}
            proposal = await self.provider.json("advance", {"world": public_world,
                "events": [e for e in self.store.list("event", user, branch)
                           if audience <= set(e["visibility"])][-30:]})
            scene = {k: proposal[k] for k in ("title", "description", "options")}
            updated, events = self.executor.advance(world, {"date": proposal["date"], "scene": scene}, True, request)
            output = {"world": updated.model_dump(), "messages": [],
                      "events": [e.model_dump() for e in events], "jobs": [], "errors": []}
            with self.store.transaction():
                self.store.put("world", updated)
                for event in events:
                    self.store.put("event", event, user_id=user)
                for char in world.characters:
                    job = self.job(user, branch, char.id, "summary", {"scene_end": True}, request)
                    output["jobs"].append(job.model_dump())
                self.store.finish(user, branch, request, mark, output)
            return output

    async def edit_character(self, user: str, branch: str, actor: str, version: int, fields: dict):
        async with self.locks[branch]:
            world = self.world(user, branch)
            if world.version != version:
                raise ValueError("world version conflict")
            char = next((c for c in world.characters if c.id == actor), None)
            if not char:
                raise KeyError("character not found")
            allowed = {"persona", "voice", "goal", "appearance", "style", "relationship"}
            if not fields or not set(fields) <= allowed or any(len(str(v)) > 3000 for v in fields.values()):
                raise ValueError("invalid character fields")
            edited = Character.model_validate({**char.model_dump(), **fields, "version": char.version + 1})
            world.characters = [edited if c.id == actor else c for c in world.characters]
            world.version += 1
            with self.store.transaction():
                self.store.put("character_revision", char, id=f"{branch}:{actor}:{char.version}",
                               user_id=user, branch_id=branch, actor_id=actor)
                self.store.put("world", world)
            return world

    async def run_job(self, job: Job):
        with self.store.transaction():
            job = Job.model_validate(self.store.get("job", job.id, job.user_id))
            if job.status != "pending" and not (job.kind != "image" and job.status == "failed"):
                return  # A stale/replayed job handle never duplicates an image call.
            job.status, job.attempts = "running", job.attempts + 1
            self.store.put("job", job)
        try:
            if job.kind == "memory":
                await self.memory.derive(job.user_id, job.branch_id, job.actor_id, job.payload["source_ids"])
                await self.memory.compress(job.user_id, job.branch_id, job.actor_id)
            elif job.kind == "summary":
                await self.memory.compress(job.user_id, job.branch_id, job.actor_id, scene_end=True)
            else:
                data, mime = await self.provider.image(job.payload["prompt"])
                ext = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}[mime]
                folder = self.settings.data_dir / "images"
                folder.mkdir(parents=True, exist_ok=True)
                file = folder / f"{job.id}.{ext}"
                temp = file.with_suffix(".tmp")
                temp.write_bytes(data)
                temp.replace(file)
                job.result = {"file": file.name, "mime": mime}
                message = Message(id=stable_id(job.id, "image"), user_id=job.user_id,
                    branch_id=job.branch_id, actor_id=job.actor_id, role="image",
                    text=job.payload["caption"], visibility=[job.actor_id],
                    request_id=job.payload["request_id"], image_id=job.id)
                with self.store.transaction():
                    self.store.put("message", message)
                    job.status = "done"
                    self.store.put("job", job)
                return
            job.status, job.error = "done", ""
        except asyncio.CancelledError:
            job.status = "uncertain" if job.kind == "image" else "pending"
            job.error = "interrupted"
            raise
        except Exception as exc:
            uncertain = isinstance(exc, ProviderError) and exc.uncertain
            job.status = "uncertain" if job.kind == "image" and uncertain else "failed"
            job.error = exc.code if isinstance(exc, ProviderError) else type(exc).__name__
        finally:
            latest = self.store.get("job", job.id, job.user_id)
            if job.kind != "image" and latest["payload"] != job.payload:
                # A manual reply retry added evidence while extraction was in flight.
                job.payload, job.status, job.attempts = latest["payload"], "pending", 0
            self.store.put("job", job)

    def recover_jobs(self):
        with self.store.lock:
            rows = self.store.db.execute("SELECT body FROM records WHERE kind='job'").fetchall()
            operations = self.store.db.execute("SELECT user_id,scope,request_id,body FROM operations").fetchall()
        for operation in operations:
            output = json.loads(operation["body"])
            if output.get("reply_status") == "pending":
                # Never replay already-committed world effects after a process crash.
                output["reply_status"] = "failed"
                output.setdefault("errors", []).append("reply_interrupted_after_world_commit")
                user, branch, request = operation["user_id"], operation["scope"], operation["request_id"]
                world = self.world(user, branch)
                message = next(m for m in output["messages"] if m["role"] == "user")
                if self._reuse_saved_reply(user, branch, request, message["visibility"][0], world, output):
                    continue
                evidence = self.store.list("message", user, branch) + self.store.list("event", user, branch)
                for char in world.characters:
                    ids = [e["id"] for e in evidence if e["request_id"] == request and char.id in e["visibility"]]
                    if not ids:
                        continue
                    job = self.job(user, branch, char.id, "memory", {"source_ids": ids}, request)
                    output.setdefault("jobs", []).append(job.model_dump())
                self._update_result(user, branch, request, output)
        for row in rows:
            snapshot = Job.model_validate_json(row["body"])
            job = Job.model_validate(self.store.get("job", snapshot.id, snapshot.user_id))
            if job.status == "running":
                job.status = "uncertain" if job.kind == "image" else "pending"
                job.error = "previous_process_interrupted"
                self.store.put("job", job)

    async def worker(self):
        self.recover_jobs()
        try:
            while True:
                with self.store.lock:
                    rows = self.store.db.execute("SELECT body FROM records WHERE kind='job' ORDER BY seq").fetchall()
                for row in rows:
                    job = Job.model_validate_json(row["body"])
                    lane = "image" if job.kind == "image" else "memory"
                    if lane in self.job_slots and not self.job_slots[lane].done():
                        continue
                    retry = job.kind != "image" and job.status == "failed" and job.attempts < 3
                    if job.status != "pending" and not retry:
                        continue
                    task = asyncio.create_task(self.run_job(job))
                    self.job_slots[lane] = task
                    self.tasks.add(task)
                    task.add_done_callback(self.tasks.discard)
                await asyncio.sleep(1)
        finally:
            for task in self.tasks:
                task.cancel()
            await asyncio.gather(*self.tasks, return_exceptions=True)
