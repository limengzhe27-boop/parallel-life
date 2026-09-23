"""Real-provider SDK integration; --help does not open a DB or make a request.

Example (use IDs from your own stored world and export server settings first):
  python examples/product_adapter.py --send --executor my_product.world_rules \
      --user SERVER_SESSION_USER --branch BRANCH_ID --character CHARACTER_ID \
      --request REQUEST_UUID --version WORLD_VERSION --conversation-version 0 \
      --text '我想听听你的看法。'

Explicit image: add --image-request '此刻窗外的街角'.
Reply-only recovery: --send --retry-reply --user USER --branch BRANCH --request REQUEST_UUID.

The host must derive user identity from its authenticated server session.
Never run two Engine workers against the same database in separate processes.
This one-shot CLI does not start a worker: media/memory jobs stay durable for
the long-lived host worker rather than being interrupted when the CLI exits.
"""
from __future__ import annotations

import argparse
import asyncio
import importlib
import json
from typing import Protocol
from uuid import uuid4

from parallel_life.config import Settings
from parallel_life.interaction import Engine
from parallel_life.models import Action, Branch, Decision, Event, World
from parallel_life.providers import OpenAICompatibleProvider
from parallel_life.store import Store


class WorldExecutor(Protocol):
    """Pure synchronous rules. Engine owns the persistence transaction."""

    def initialize(self, branch: Branch) -> World: ...
    def visible_state(self, world: World, actor_id: str) -> dict: ...
    def settle(self, world: World, decisions: list[Decision],
               user_action: Action | None, request_id: str) -> tuple[World, list[Event]]: ...
    def advance(self, world: World, proposal: dict, confirmed: bool,
                request_id: str) -> tuple[World, list[Event]]: ...


def make_engine(settings: Settings, executor: WorldExecutor) -> Engine:
    """Call once per host process; reuse it across authenticated requests."""
    for name in ("initialize", "visible_state", "settle", "advance"):
        if not callable(getattr(executor, name, None)):
            raise TypeError(f"Product executor must implement {name}")
    return Engine(
        Store(settings.data_dir / "life.sqlite3"),
        OpenAICompatibleProvider(settings),
        OpenAICompatibleProvider(settings, role="memory"),
        settings,
        executor=executor,
    )


async def respond(engine: Engine, *, authenticated_user_id: str, branch_id: str,
                  character_id: str, request_id: str, version: int, text: str,
                  conversation_version: int | None = None, image_request: str | None = None,
                  user_action: Action | None = None, image_only: bool = False) -> dict:
    """The product route passes trusted ownership and one stable request ID."""
    return await engine.interact(
        authenticated_user_id, branch_id, request_id, version,
        character_id, text, user_action, conversation_version=conversation_version,
        image_request=image_request, image_only=image_only,
    )


async def retry_response(engine: Engine, *, authenticated_user_id: str,
                         branch_id: str, request_id: str) -> dict:
    """Explicit retry of the latest incomplete reply; no repeated world/media call."""
    return await engine.retry_reply(authenticated_user_id, branch_id, request_id)


async def run(args) -> None:
    settings = Settings.from_env()
    if not settings.chat_api_key or not settings.chat_model:
        raise SystemExit("Export real PARALLEL_LIFE_CHAT_* settings before --send")
    executor = importlib.import_module(args.executor)
    engine = make_engine(settings, executor)
    try:
        if args.retry_reply:
            result = await retry_response(engine, authenticated_user_id=args.user,
                branch_id=args.branch, request_id=args.request)
        else:
            action = Action.model_validate_json(args.action_json) if args.action_json else None
            result = await respond(engine, authenticated_user_id=args.user,
                branch_id=args.branch, character_id=args.character,
                request_id=args.request or uuid4().hex, version=args.version, text=args.text,
                conversation_version=args.conversation_version, image_request=args.image_request,
                user_action=action, image_only=args.image_only)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    finally:
        engine.store.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--send", action="store_true", help="Explicitly make a paid real-model turn")
    parser.add_argument("--retry-reply", action="store_true", help="Retry only a saved incomplete reply, with --send")
    parser.add_argument("--executor", default="parallel_life.world", help="Import path of the product rule module")
    parser.add_argument("--user", help="Authenticated server-side user ID")
    parser.add_argument("--branch", help="Existing branch owned by this user")
    parser.add_argument("--character", help="Existing character ID")
    parser.add_argument("--request", help="Stable ID reused only for this exact logical turn")
    parser.add_argument("--version", type=int, help="World version read for this logical turn; preserve on retry")
    parser.add_argument("--conversation-version", type=int, help="Current actor's conversation revision, 0 if none")
    parser.add_argument("--image-request", help="Explicit image subject, independent of character speech")
    parser.add_argument("--image-only", action="store_true", help="Only request media; requires --image-request")
    parser.add_argument("--action-json", help="Explicit Action JSON; ordinary chat omits this field")
    parser.add_argument("--text", help="Message to send")
    args = parser.parse_args()
    if not args.send:
        parser.print_help()
        return
    if args.retry_reply:
        if not all((args.user, args.branch, args.request)):
            parser.error("--send --retry-reply requires --user, --branch and --request")
    elif not all((args.user, args.branch, args.character, args.text)) or args.version is None:
        parser.error("--send requires --user, --branch, --character, --version and --text")
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
