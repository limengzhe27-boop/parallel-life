"""Thin local-demo HTTP API. A host product supplies authentication in production."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import Field

from .config import Settings
from .interaction import Engine, fingerprint
from .life import confirm_profile, generate_branches, interview
from .models import Action, Job, LifeEvent, Model, Profile
from .providers import OpenAICompatibleProvider, ProviderError
from .store import Store


class UserRequest(Model):
    user_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")


class InterviewRequest(UserRequest):
    text: str = Field(min_length=1, max_length=30000)
    profile_id: str | None = None


class ConfirmRequest(UserRequest):
    identity: str = Field(max_length=3000)
    events: list[LifeEvent] = Field(min_length=1, max_length=100)


class OperationRequest(UserRequest):
    request_id: str = Field(min_length=1, max_length=100)


class TurnRequest(OperationRequest):
    version: int = Field(ge=0)
    character_id: str
    text: str = Field(min_length=1, max_length=3000)
    user_action: Action | None = None
    image_request: str | None = Field(default=None, min_length=1, max_length=1500)
    image_only: bool = False
    conversation_version: int | None = Field(default=None, ge=0)


class AdvanceRequest(OperationRequest):
    version: int = Field(ge=0)
    confirmed: bool


class MemoryEdit(UserRequest):
    character_id: str
    operation: Literal["correct", "forget"]
    text: str = Field(default="", max_length=3000)


class CharacterEdit(UserRequest):
    version: int = Field(ge=0)
    persona: str | None = Field(default=None, max_length=3000)
    voice: str | None = Field(default=None, max_length=1000)
    goal: str | None = Field(default=None, max_length=3000)
    appearance: str | None = Field(default=None, max_length=3000)
    style: str | None = Field(default=None, max_length=3000)
    relationship: str | None = Field(default=None, max_length=3000)


def create_app(settings: Settings | None = None, provider=None, memory_provider=None,
               *, start_worker: bool = True) -> FastAPI:
    settings = settings or Settings.from_env()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    store = Store(settings.data_dir / "life.sqlite3")
    provider = provider or OpenAICompatibleProvider(settings)
    memory_provider = memory_provider or OpenAICompatibleProvider(settings, role="memory")
    engine = Engine(store, provider, memory_provider, settings)

    @asynccontextmanager
    async def lifespan(app):
        worker = asyncio.create_task(engine.worker()) if start_worker else None
        yield
        if worker:
            worker.cancel()
            await asyncio.gather(worker, return_exceptions=True)
        store.close()

    app = FastAPI(title="Parallel Life Kit", version="0.1.0", lifespan=lifespan)
    app.state.engine = engine

    @app.middleware("http")
    async def local_origin(request: Request, call_next):
        origin = request.headers.get("origin")
        if request.method not in {"GET", "HEAD", "OPTIONS"} and origin:
            if urlsplit(origin).netloc != request.headers.get("host"):
                return JSONResponse({"detail": "cross-origin writes are disabled"}, status_code=403)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(ProviderError)
    async def provider_failure(request, exc):
        return JSONResponse({"detail": exc.code, "provider_status": exc.status_code,
                             "uncertain": exc.uncertain}, status_code=502)

    @app.exception_handler(ValueError)
    async def value_failure(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=409)

    @app.exception_handler(KeyError)
    async def missing(request, exc):
        return JSONResponse({"detail": "not_found"}, status_code=404)

    @app.get("/")
    async def index():
        return FileResponse(Path(__file__).parent / "static/index.html")

    @app.get("/api/health")
    async def health():
        return {"mode": "live", "configured": bool(settings.chat_api_key and settings.chat_model),
                "image_configured": bool(settings.image_api_key and settings.image_model),
                "chat_model": settings.chat_model, "image_model": settings.image_model,
                "reply_model": settings.reply_model or settings.chat_model,
                "authentication": "local_demo_only"}

    @app.post("/api/interview")
    async def interview_route(body: InterviewRequest):
        async with engine.locks["profile:" + body.user_id]:
            previous = Profile.model_validate(store.get("profile", body.profile_id, body.user_id)) if body.profile_id else None
            # Preserve original statements before extraction, including provider failures.
            store.put("interview_source", {"id": __import__("uuid").uuid4().hex,
                "user_id": body.user_id, "text": body.text})
            profile = await interview(provider, body.user_id, body.text, previous)
            store.put("profile", profile)
            return profile

    @app.get("/api/profiles")
    async def profiles(user_id: str):
        return {"profiles": store.list("profile", user_id)}

    @app.post("/api/profiles/{profile_id}/confirm")
    async def confirm_route(profile_id: str, body: ConfirmRequest):
        async with engine.locks["profile:" + body.user_id]:
            old = Profile.model_validate(store.get("profile", profile_id, body.user_id))
            if old.confirmed:
                old = old.model_copy(update={"revision": old.revision + 1})
            value = confirm_profile(old, body.events, body.identity)
            with store.transaction():
                store.put("profile", value)
                store.put("profile_version", value, id=f"{value.id}:{value.revision}")
            return value

    @app.post("/api/profiles/{profile_id}/branches")
    async def branches_route(profile_id: str, body: OperationRequest):
        scope = "profile:" + profile_id
        mark = fingerprint({"profile_id": profile_id})
        async with engine.locks["profile:" + body.user_id]:
            cached = store.operation(body.user_id, scope, body.request_id, mark)
            if cached is not None:
                return cached
            profile = Profile.model_validate(store.get("profile", profile_id, body.user_id))
            branches = await generate_branches(provider, profile)
            result = {"branches": [b.model_dump() for b in branches]}
            with store.transaction():
                for branch in branches:
                    store.put("branch", branch)
                store.finish(body.user_id, scope, body.request_id, mark, result)
            return result

    @app.get("/api/branches")
    async def list_branches(user_id: str):
        return {"branches": store.list("branch", user_id)}

    @app.post("/api/branches/{branch_id}/enter")
    async def enter(branch_id: str, body: OperationRequest):
        return await engine.enter(body.user_id, branch_id)

    @app.get("/api/branches/{branch_id}")
    async def get_world(branch_id: str, user_id: str):
        return engine.world(user_id, branch_id)

    @app.post("/api/branches/{branch_id}/interact")
    async def turn(branch_id: str, body: TurnRequest):
        return await engine.interact(body.user_id, branch_id, body.request_id, body.version,
                                     body.character_id, body.text, body.user_action,
                                     image_request=body.image_request, image_only=body.image_only,
                                     conversation_version=body.conversation_version)

    @app.post("/api/branches/{branch_id}/turns/{request_id}/retry")
    async def retry_reply(branch_id: str, request_id: str, body: UserRequest):
        return await engine.retry_reply(body.user_id, branch_id, request_id)

    @app.get("/api/branches/{branch_id}/conversation")
    async def conversation(branch_id: str, user_id: str, character_id: str):
        world = engine.world(user_id, branch_id)
        if character_id not in {c.id for c in world.characters}:
            raise KeyError("character not found")
        return {"state": engine.conversation.state(world, character_id) or {}}

    @app.post("/api/branches/{branch_id}/advance")
    async def advance(branch_id: str, body: AdvanceRequest):
        return await engine.advance(body.user_id, branch_id, body.request_id, body.version, body.confirmed)

    @app.get("/api/branches/{branch_id}/history")
    async def history(branch_id: str, user_id: str):
        engine.world(user_id, branch_id)
        with store.lock:
            rows = store.db.execute("SELECT request_id,body FROM operations WHERE user_id=? AND scope=? ORDER BY rowid DESC LIMIT 30",
                                    (user_id, branch_id)).fetchall()
        turns = []
        for row in reversed(rows):
            result = __import__("json").loads(row["body"])
            if "reply_status" not in result:
                continue
            source = next((m for m in result["messages"] if m["role"] == "user"), None)
            if source:
                turns.append({"request_id": row["request_id"], "character_id": source["visibility"][0],
                              "reply_status": result["reply_status"], "errors": result.get("errors", [])})
        return {"messages": store.list("message", user_id, branch_id),
                "events": store.list("event", user_id, branch_id), "turns": turns}

    @app.get("/api/branches/{branch_id}/decisions")
    async def decisions(branch_id: str, user_id: str):
        engine.world(user_id, branch_id)
        return {"decisions": store.list("decision", user_id, branch_id)}

    @app.get("/api/branches/{branch_id}/memories")
    async def memories(branch_id: str, user_id: str, character_id: str):
        engine.world(user_id, branch_id)
        return {"memories": store.list("memory", user_id, branch_id, character_id)}

    @app.get("/api/branches/{branch_id}/evidence/{source_id}")
    async def evidence(branch_id: str, source_id: str, user_id: str, character_id: str):
        engine.world(user_id, branch_id)
        sources = engine.memory.evidence(user_id, branch_id, character_id)
        if source_id not in sources:
            raise KeyError("evidence not found")
        return sources[source_id]

    @app.post("/api/branches/{branch_id}/memories/{memory_id}")
    async def edit_memory(branch_id: str, memory_id: str, body: MemoryEdit):
        async with engine.locks[branch_id]:
            engine.world(body.user_id, branch_id)
            return engine.memory.edit(body.user_id, branch_id, body.character_id,
                                      memory_id, body.operation, body.text)

    @app.patch("/api/branches/{branch_id}/characters/{character_id}")
    async def edit_character(branch_id: str, character_id: str, body: CharacterEdit):
        fields = body.model_dump(exclude={"user_id", "version"}, exclude_none=True)
        return await engine.edit_character(body.user_id, branch_id, character_id, body.version, fields)

    @app.get("/api/branches/{branch_id}/jobs")
    async def branch_jobs(branch_id: str, user_id: str):
        engine.world(user_id, branch_id)
        return {"jobs": store.list("job", user_id, branch_id)}

    @app.get("/api/jobs/{job_id}")
    async def get_job(job_id: str, user_id: str):
        job = store.get("job", job_id, user_id)
        return {k: v for k, v in job.items() if k != "payload"}

    @app.post("/api/jobs/{job_id}/retry")
    async def retry_job(job_id: str, body: UserRequest):
        job = Job.model_validate(store.get("job", job_id, body.user_id))
        if job.kind == "image":
            raise ValueError("image retries require a new explicit chat request; uncertain requests may be billed")
        if job.status != "failed":
            raise ValueError("only failed memory jobs can be retried")
        job.status, job.attempts = "pending", 0
        store.put("job", job)
        return job

    @app.get("/api/images/{job_id}")
    async def get_image(job_id: str, user_id: str):
        job = Job.model_validate(store.get("job", job_id, user_id))
        if job.kind != "image" or job.status != "done":
            raise HTTPException(404, "image not ready")
        file = settings.data_dir / "images" / Path(job.result["file"]).name
        if not file.is_file():
            raise HTTPException(404, "image asset missing")
        return FileResponse(file, media_type=job.result["mime"])

    return app
