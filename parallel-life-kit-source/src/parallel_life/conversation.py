"""Small, derived conversation state: intent is not authoritative world truth."""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import re
from typing import Annotated, Literal

from pydantic import Field, ValidationError

from .memory import MemoryEngine, stable_id
from .models import Model, World
from .providers import ProviderError
from .store import Store


class _Route(Model):
    mode: Literal["chat", "image", "world"]
    source_quote: str = Field(default="", max_length=3000)
    topic: str = Field(max_length=160)
    focus: str = Field(max_length=500)
    parked_topics: list[Annotated[str, Field(max_length=160)]] = Field(default_factory=list, max_length=5)
    image_subject: str | None = Field(default=None, max_length=1500)
    image_only: bool = False
    action_quote: str | None = Field(default=None, max_length=3000)
    proactive_image_subject: str | None = Field(default=None, max_length=1500)


ROLE_CARD_VERSION = 2  # Changing projection rules invalidates derived cards, not characters.


class _RoleCard(Model):
    identity: str = Field(min_length=1, max_length=500)
    voice: str = Field(max_length=1000)
    stance: str = Field(default="", max_length=500)


_NEGATED = re.compile(r"不要|不用|别(?:再|给|发|画|生成|替|帮|取消|转交|移动|承诺)|不想|不需要|无需|do not|don't", re.I)
_HYPOTHETICAL = re.compile(r"如果|假如|假设|要是|比如|例如|曾经|以前|当时|昨天|他说|她说|是否|会不会|还没|尚未", re.I)
_IMAGE = re.compile(r"(?:发|送|给|画|生成|来|看看|想看|想要|要|send|draw|generate|show).{0,50}"
                    r"(?:图|照片|自拍|合照|肖像|image|picture|photo|portrait)|(?:发|来|画)(?:给我)?(?:一|几)?张", re.I)
_WORLD = re.compile(r"(?:我(?:现在|决定|这就|来|愿意)?(?:选择|答应|承诺|接受|取消|履行|转交|交给|递给|走进|走到|前往|去|把))"
                    r"|(?:请|帮我|给我|我们)(?:.{0,12})(?:约定|答应|承诺|取消|转交|交给|递给|移动|前往|改到|改成|约在)"
                    r"|答应我.+"
                    r"|^(?:取消|转交|交给|递给|履行|选择|约定|前往|移动到|告诉).+", re.I)


_VISUAL_SCENE = re.compile(r"风景|景色|场景|窗外|夕阳|日落|晚霞|晨光|阳光|月光|月色|星空|雨景|海边|海浪|"
    r"山景|花园|教室|房间|街景|街道|庭院|森林|湖面|河边|外貌|装扮|衣服|穿着|花瓣|雪景|天空|"
    r"sunset|landscape|scenery|garden|forest|classroom|moonlight|outfit", re.I)
_NO_PROACTIVE_IMAGE = re.compile(r"(?:不要|不用|无需|别|不想|不需要|不发|不配|不画|不生成|不接收|停止|暂停|不许).{0,12}(?:图|照片|画)"
    r"|(?:图|照片|配图).{0,8}(?:不要|不用|先别)|只(?:要|用|想|聊|发)?.{0,5}(?:文字|聊天)"
    r"|纯文字|文字.{0,4}(?:就好|就行)|(?:no|without|don't|do not).{0,15}(?:image|picture|photo)|(?:text|chat).{0,10}only", re.I)
_PRIVATE_SCENE = re.compile(r"秘密|保密|私密|隐私|别告诉|不要告诉|不想公开|secret|private|confidential", re.I)


def _proactive_subject(text: str, route: _Route) -> str | None:
    """Opt-in proposals use only a visual span in this user's current message.

    No stored memory or other actor's knowledge can supply image content. This
    conservative gate intentionally prefers missing an illustration to adding
    an unsolicited image whose subject has no direct, current user evidence.
    """
    subject = (route.proactive_image_subject or "").strip()
    if (route.mode == "chat" and subject and subject in text and route.source_quote
            and route.source_quote in text and _VISUAL_SCENE.search(subject)
            and not _NO_PROACTIVE_IMAGE.search(text) and not _PRIVATE_SCENE.search(text)):
        return subject
    return None


def _explicit(mode: str, text: str, quote: str) -> bool:
    """A model-selected route cannot turn a mention/negation into a tool request.

    This is a conservative eligibility gate, not an action parser. The world
    executor still validates every proposal; no route writes a world fact.
    """
    if not quote or quote not in text:
        return False
    # Inspect the surrounding clause too: quoting only "发图" must not evade "不要".
    start = text.index(quote)
    prefix = re.split(r"[，,。！？!?；;\n]", text[:start])[-1]
    match = (_IMAGE if mode == "image" else _WORLD).search(quote)
    if not match:
        return False
    if mode == "image":
        # A past image *subject* is valid; a report of a past request is not.
        # Inspect only the words before the actual sending/drawing verb.
        verb = re.search(r"发|送|画|生成|来|看看|想看|想要|要|send|draw|generate|show", match.group(), re.I)
        end = match.start() + (verb.start() if verb else 0)
        inspected = prefix + quote[:end]
    else:
        inspected = prefix + quote
    return not (_NEGATED.search(inspected) or _HYPOTHETICAL.search(inspected))


class ConversationEngine:
    """Scoped topic tracking and cached role voice, never a second world writer.

    Callers persist the current user message before ``plan``. Replaying that
    message reuses the route and revision, including after an action failure.
    Public ``state`` returns None when its evidence has become stale or blocked.
    """

    def __init__(self, store: Store, provider, *, proactive_images: bool = False):
        self.store, self.provider = store, provider
        self.proactive_images = proactive_images
        self.memory = MemoryEngine(store, None)

    @staticmethod
    def _character(world: World, actor: str):
        character = next((c for c in world.characters if c.id == actor), None)
        if character is None:
            raise KeyError("character not found")
        return character

    def _record(self, kind: str, world: World, actor: str) -> dict | None:
        self._character(world, actor)
        try:
            row = self.store.get(kind, stable_id(kind, world.user_id, world.branch_id, actor), world.user_id)
        except KeyError:
            return None
        if (row.get("branch_id"), row.get("actor_id")) != (world.branch_id, actor):
            return None
        return row

    def _messages(self, world: World, actor: str) -> list[dict]:
        blocked = self.memory.blocked_sources(world.user_id, world.branch_id, actor)
        return [m for m in self.memory.messages(world.user_id, world.branch_id, actor)
                if m["id"] not in blocked and m["role"] in {"user", "assistant"}]

    def state(self, world: World, actor: str) -> dict | None:
        record = self._record("conversation", world, actor)
        if not record:
            return None
        state = record["state"]
        messages = self._messages(world, actor)
        ids = {m["id"] for m in messages}
        if (state.get("chapter") != world.scene.chapter or not state.get("source_ids")
                or not set(state["source_ids"]) <= ids
                or state.get("last_user_message_id") not in {m["id"] for m in messages[-20:]}):
            return None
        return deepcopy(state)

    async def plan(self, world: World, actor: str, text: str, message_id: str,
                   *, image_request: str | None = None) -> dict:
        self._character(world, actor)
        if image_request is not None and (not isinstance(image_request, str)
                or not image_request.strip() or len(image_request) > 1500):
            raise ValueError("image_request must contain 1 to 1500 characters")
        messages = self._messages(world, actor)
        current = next((m for m in messages if m["id"] == message_id), None)
        if not current or current["role"] != "user" or current["text"] != text:
            raise ValueError("conversation input needs matching visible user evidence")
        previous = self.state(world, actor)
        prior_record = self._record("conversation", world, actor)
        if previous and previous["last_user_message_id"] == message_id:
            if prior_record.get("image_request") != image_request:
                raise ValueError("message_id reused with different image_request")
            replay = deepcopy(prior_record["route"])
            if replay.get("proactive_image") and not self.proactive_images:
                replay.pop("proactive_image")
                replay.pop("image_subject", None)
            return {**replay, "state": previous}
        recent = messages[-20:]
        source_ids = list(dict.fromkeys((previous or {}).get("source_ids", []) + [m["id"] for m in recent]))
        if len(source_ids) > 40:
            # Rebase from retained raw messages instead of orphaning old claims.
            previous, source_ids = None, [m["id"] for m in recent]
        if image_request is not None:
            # The explicit UI/API field is itself intent; no extra inference call.
            route = _Route(mode="image", topic=(previous or {}).get("topic", "聊天配图"),
                focus=text[:500], parked_topics=(previous or {}).get("parked_topics", []),
                image_subject=image_request.strip())
        else:
            payload = {"input": text, "recent": [{k: m[k] for k in ("id", "role", "text")}
                       for m in recent if m["id"] != message_id], "previous_state": previous}
            if self.proactive_images:
                payload["allow_proactive_images"] = True
            raw = await self.provider.json("route", payload)
            try:
                route = _Route.model_validate(raw)
            except ValidationError:
                raise ProviderError("invalid_conversation_route") from None
            if route.mode != "chat" and not _explicit(route.mode, text, route.source_quote):
                route.mode = "chat"
            if route.mode == "world" and route.action_quote is not None:
                if not _explicit("world", text, route.action_quote):
                    route.mode = "chat"
            if route.source_quote not in text:
                route.source_quote = ""  # no fabricated source attribution
        selected = {"mode": route.mode, "topic": route.topic, "focus": route.focus,
                    "source_quote": route.source_quote}
        if route.mode == "image":
            selected["image_subject"] = route.image_subject or route.source_quote
            if route.image_only:
                selected["image_only"] = True
        elif route.mode == "world":
            selected["action_quote"] = route.action_quote or route.source_quote
        if self.proactive_images and (subject := _proactive_subject(text, route)):
            selected.update(image_subject=subject, proactive_image=True)
        revision = prior_record["state"]["revision"] + 1 if prior_record else 1
        state = {"revision": revision, "topic": route.topic, "focus": route.focus,
                 "parked_topics": list(dict.fromkeys(route.parked_topics)), "source_ids": source_ids,
                 "source_quote": route.source_quote, "last_user_message_id": message_id,
                 "chapter": world.scene.chapter, "derived": True}
        if not set(source_ids) <= {m["id"] for m in self._messages(world, actor)}:
            raise ProviderError("conversation_sources_changed")
        self.store.put("conversation", {"id": stable_id("conversation", world.user_id, world.branch_id, actor),
            "user_id": world.user_id, "branch_id": world.branch_id, "actor_id": actor,
            "image_request": image_request, "state": state, "route": selected})
        return {**selected, "state": deepcopy(state)}

    async def role_card(self, world: World, actor: str) -> dict:
        character = self._character(world, actor)
        source = {k: getattr(character, k, "") for k in
                  ("name", "persona", "relationship", "appearance", "style", "voice", "version")}
        digest = hashlib.sha256(json.dumps(source, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
        prior = self._record("role_card", world, actor)
        if prior and prior["card"]["source_hash"] == digest and \
                prior["card"].get("compiler_version") == ROLE_CARD_VERSION:
            return deepcopy(prior["card"])
        try:
            raw = await self.provider.json("role_card", {"character": source})
            parsed = _RoleCard.model_validate(raw)
            card = parsed.model_dump()
            if source["voice"]:
                card["voice"] = source["voice"]  # user-edited delivery always wins
            diagnostic = {"status": "generated"}
        except (ProviderError, ValidationError) as exc:
            card = {"identity": character.name, "voice": source["voice"] or character.persona, "stance": ""}
            diagnostic = {"status": "fallback", "error": exc.code if isinstance(exc, ProviderError)
                          else "invalid_role_card"}
        card.update(source_hash=digest, compiler_version=ROLE_CARD_VERSION, derived=True, diagnostics=diagnostic)
        row = {"id": stable_id("role_card", world.user_id, world.branch_id, actor),
               "user_id": world.user_id, "branch_id": world.branch_id, "actor_id": actor, "card": card}
        if diagnostic["status"] == "generated":
            self.store.put("role_card", row)
        # Keep a bounded explicit diagnostic. A transient fallback is retried on
        # the next call, rather than becoming an invisible permanent cache hit.
        self.store.put("conversation_diagnostic", {**row,
            "id": stable_id("conversation_diagnostic", world.user_id, world.branch_id, actor)})
        return deepcopy(card)
