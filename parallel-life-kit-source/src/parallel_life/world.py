"""Pure, deterministic world authority: proposals are not accomplished facts.

The application persists returned snapshots and events in one transaction and
deduplicates request IDs. No model, database or network dependency lives here.
"""
from __future__ import annotations

from datetime import date
from uuid import NAMESPACE_URL, uuid5

from .models import Action, Branch, Decision, Event, Promise, Scene, World


def _date(value: str) -> date:
    if not isinstance(value, str):
        raise ValueError("date must use YYYY-MM-DD")
    parsed = date.fromisoformat(value)
    if parsed.isoformat() != value:
        raise ValueError("date must use YYYY-MM-DD")
    return parsed


def _actors(world: World) -> dict:
    return {character.id: character for character in world.characters}


def _location(world: World, actor_id: str) -> str:
    return world.player_location if actor_id == "player" else _actors(world)[actor_id].location


def _validate(world: World) -> None:
    _date(world.date)
    ids = [character.id for character in world.characters]
    if not world.branch_id or not world.user_id or world.version < 0:
        raise ValueError("invalid world identity/version")
    if not ids or len(ids) != len(set(ids)) or "player" in ids or any(not x for x in ids):
        raise ValueError("character IDs must be unique, nonempty and distinct from player")
    if not world.locations or len(set(world.locations)) != len(world.locations):
        raise ValueError("locations must be nonempty and unique")
    if any(not location for location in world.locations):
        raise ValueError("empty location")
    if any(_location(world, actor) not in world.locations for actor in ["player", *ids]):
        raise ValueError("unknown actor location")
    known = {"player", *ids}
    if any(not item or owner not in known for item, owner in world.items.items()):
        raise ValueError("invalid item ownership")
    options = [option.id for option in world.scene.options]
    if len(options) != len(set(options)) or any(not option for option in options):
        raise ValueError("scene option IDs must be nonempty and unique")
    if any(option.move_to is not None and option.move_to not in world.locations
           for option in world.scene.options):
        raise ValueError("scene option move_to must reference an existing location")
    if world.scene.chosen is not None and world.scene.chosen not in options:
        raise ValueError("chosen option is not in scene")
    promise_ids = [promise.id for promise in world.promises]
    if len(set(promise_ids)) != len(promise_ids):
        raise ValueError("duplicate promise IDs")
    for promise in world.promises:
        if promise.actor_id not in known or promise.target_id not in known:
            raise ValueError("unknown promise participant")
        if set(promise.visibility) != {promise.actor_id, promise.target_id}:
            raise ValueError("promise visibility must match its participants")
        if promise.due:
            _date(promise.due)


def initialize(branch: Branch) -> World:
    """Initialize a branch snapshot; do not expose the full real-life profile."""
    if len(branch.characters) != 3:
        raise ValueError("a branch starts with exactly three characters")
    if not branch.locations:
        raise ValueError("a branch needs a location")
    start = _date(branch.start_date)
    if any(_date(event.date) > start for event in branch.past):
        raise ValueError("future life events do not belong in a branch's past")
    first_actor = sorted(character.id for character in branch.characters)[0]
    world = World(
        branch_id=branch.id, user_id=branch.user_id, date=branch.start_date,
        identity=branch.identity, locations=list(branch.locations),
        player_location=branch.locations[0],
        characters=[character.model_copy(deep=True) for character in branch.characters],
        scene=branch.scene.model_copy(deep=True),
        items={"player_notebook": "player", "character_letter": first_actor},
    )
    if world.scene.chosen is not None or world.scene.chapter != 1:
        raise ValueError("initial scene must be unchosen chapter 1")
    _validate(world)
    return world


def visible_state(world: World, actor_id: str) -> dict:
    """Return the model-facing view, not the all-knowing debugging snapshot."""
    _validate(world)
    actors = _actors(world)
    if actor_id != "player" and actor_id not in actors:
        raise ValueError("unknown observing actor")
    location = _location(world, actor_id)
    neighbors = [
        {"id": actor, "name": "用户" if actor == "player" else actors[actor].name,
         "location": location}
        for actor in ["player", *sorted(actors)]
        if actor != actor_id and _location(world, actor) == location
    ]
    visible_owners = {actor_id, *(person["id"] for person in neighbors)}
    return {
        "branch_id": world.branch_id, "version": world.version, "date": world.date,
        "identity": world.identity, "locations": list(world.locations),
        "scene": world.scene.model_dump(),
        "self": ({"id": "player", "identity": world.identity, "location": location}
                 if actor_id == "player" else actors[actor_id].model_dump()),
        "characters": neighbors,
        "items": {item: owner for item, owner in world.items.items() if owner in visible_owners},
        "promises": [promise.model_dump() for promise in world.promises
                     if actor_id in promise.visibility],
    }


def _id(world: World, request_id: str, actor_id: str, kind: str) -> str:
    return uuid5(NAMESPACE_URL, f"parallel-life:{world.branch_id}:{request_id}:{actor_id}:{kind}").hex


def _event(world: World, request_id: str, actor: str, action: Action,
           accepted: bool, text: str, visibility: list[str], **data) -> Event:
    return Event(
        id=_id(world, request_id, actor, action.kind), branch_id=world.branch_id,
        request_id=request_id, date=world.date, actor_id=actor, kind=action.kind,
        accepted=accepted, text=text, visibility=sorted(set(visibility)), data=data,
    )


def _apply(world: World, actor: str, action: Action, request_id: str) -> Event:
    actors = _actors(world)
    known = {"player", *actors}
    name = "用户" if actor == "player" else actors[actor].name
    visibility = [actor]
    data = {}

    def reject(reason: str) -> Event:
        return _event(world, request_id, actor, action, False, reason, [actor], reason=reason)

    def target_error() -> str:
        if action.target not in known or action.target == actor:
            return "接收者须为另一位已存在的人物"
        if _location(world, action.target) != _location(world, actor):
            return "接收者不在同一地点"
        return ""

    if action.kind == "wait":
        text = f"{name}暂未行动。"
    elif action.kind == "propose":
        if action.target not in known or action.target == actor or not action.content.strip():
            return reject("提议需要明确对象和内容")
        visibility = [actor, action.target]
        data = {"target": action.target, "proposal": action.content, "status": "proposed"}
        recipient = "你" if action.target == "player" else actors[action.target].name
        text = f"{name}向{recipient}提出：{action.content}（尚未实施，等待回应）。"
    elif action.kind == "move":
        if action.target not in world.locations:
            return reject("目标地点不存在")
        origin = _location(world, actor)
        visibility = [person for person in sorted(known)
                      if _location(world, person) in {origin, action.target}]
        if actor == "player":
            world.player_location = action.target
        else:
            actors[actor].location = action.target
        data = {"from": origin, "to": action.target}
        text = f"{name}从{origin}移动至{action.target}。"
    elif action.kind == "tell":
        if error := target_error():
            return reject(error)
        if not action.content.strip():
            return reject("交流内容为空")
        if actor != "player":
            knowledge = actors[actor].knowledge
            if action.content not in knowledge:
                return reject("交流内容没有角色已知信息作为依据")
            if action.evidence_id and action.evidence_id != f"knowledge:{knowledge.index(action.content)}":
                return reject("交流证据与已知信息不匹配")
        if action.target != "player":
            statement = f"{name}说：{action.content}"
            if statement not in actors[action.target].knowledge:
                actors[action.target].knowledge.append(statement)
            actors[action.target].knowledge_sources[statement] = _id(world, request_id, actor, action.kind)
        visibility = [actor, action.target]
        data = {"target": action.target, "statement": action.content,
                "epistemic_status": "attributed_statement", "evidence_id": action.evidence_id}
        recipient = "你" if action.target == "player" else actors[action.target].name
        text = f"{name}向{recipient}转述：{action.content}"
    elif action.kind == "promise":
        if action.target not in known or action.target == actor:
            return reject("承诺对象须为另一位已存在的人物")
        if not action.content.strip():
            return reject("承诺内容为空")
        try:
            if action.due and _date(action.due) < _date(world.date):
                return reject("承诺期限早于当前时间")
        except ValueError:
            return reject("承诺期限须为 YYYY-MM-DD")
        promise_id = _id(world, request_id, actor, "promise-record")
        if any(promise.id == promise_id for promise in world.promises):
            return reject("该请求的承诺已经记录")
        visibility = [actor, action.target]
        promise = Promise(
            id=promise_id, actor_id=actor, target_id=action.target,
            content=action.content, condition=action.condition, due=action.due,
            source_id=_id(world, request_id, actor, action.kind), visibility=visibility,
        )
        world.promises.append(promise)
        data = {"promise": promise.model_dump()}
        text = f"{name}承诺：{action.content}（尚未完成）。"
    elif action.kind in {"cancel", "fulfill"}:
        promise = next((p for p in world.promises if p.id == action.promise_id), None)
        if promise is None or actor not in promise.visibility:
            return reject("没有可操作的承诺")
        if promise.status != "open":
            return reject("承诺已经结束")
        if action.kind == "cancel" and promise.actor_id != actor:
            return reject("仅承诺方可以取消自己的承诺")
        if action.kind == "fulfill" and actor != "player":
            return reject("履约需要用户作为参与方明确确认；角色自述不构成完成证据")
        promise.status = "cancelled" if action.kind == "cancel" else "completed"
        visibility = list(promise.visibility)
        data = {"promise": promise.model_dump(), "confirmed_by": actor}
        text = f"承诺“{promise.content}”已{'取消' if action.kind == 'cancel' else '经用户确认完成'}。"
    elif action.kind == "transfer":
        if error := target_error():
            return reject(error)
        if world.items.get(action.item) != actor:
            return reject("该物品不由行动者持有")
        world.items[action.item] = action.target
        visibility = [person for person in sorted(known)
                      if _location(world, person) == _location(world, actor)]
        data = {"item": action.item, "from": actor, "to": action.target}
        recipient = "你" if action.target == "player" else actors[action.target].name
        text = f"{name}将{action.item}交给{recipient}。"
    elif action.kind == "choose":
        if actor != "player":
            return reject("关键人生选择由用户决定")
        if world.scene.chosen is not None:
            return reject("当前场景已作出选择")
        option = next((option for option in world.scene.options if option.id == action.target), None)
        if option is None:
            return reject("选择不在当前场景提供的选项中")
        origin = world.player_location
        destination = option.move_to if option.move_to is not None else origin
        # Only explicit structured effects change truth. Never infer movement
        # or any other outcome from an option's label/consequence prose.
        visibility = [person for person in sorted(known)
                      if _location(world, person) in {origin, destination}]
        world.scene.chosen = option.id
        world.player_location = destination
        data = {"option_id": option.id, "label": option.label,
                "consequence_preview": option.consequence}
        text = f"用户选择了“{option.label}”。"
        if destination != origin:
            data.update(move_from=origin, move_to=destination)
            text += f"用户从{origin}移动至{destination}。"
    else:
        return reject("未知行动")
    return _event(world, request_id, actor, action, True, text, visibility, **data)


def settle(world: World, decisions: list[Decision], user_action: Action | None,
           request_id: str) -> tuple[World, list[Event]]:
    """Player first, then actor ID order; every action rechecks current state."""
    _validate(world)
    if not request_id.strip():
        raise ValueError("request_id is required")
    actor_ids = [decision.actor_id for decision in decisions]
    if len(actor_ids) > 3 or len(actor_ids) != len(set(actor_ids)):
        raise ValueError("at most three distinct character decisions per round")
    if any(actor not in _actors(world) for actor in actor_ids):
        raise ValueError("decisions require known NPC actor IDs")
    result = world.model_copy(deep=True)
    pending = [(d.actor_id, d.action) for d in sorted(decisions, key=lambda d: d.actor_id)]
    if user_action is not None:
        pending.insert(0, ("player", user_action))
    events = [_apply(result, actor, action, request_id) for actor, action in pending]
    result.version += 1
    _validate(result)
    return result, events


def advance(world: World, proposal: dict, confirmed: bool,
            request_id: str) -> tuple[World, list[Event]]:
    """User confirms a scene boundary; time passing never fulfills promises."""
    _validate(world)
    if confirmed is not True:
        raise ValueError("scene advancement requires explicit user confirmation")
    if not request_id.strip():
        raise ValueError("request_id is required")
    if world.scene.options and world.scene.chosen is None:
        raise ValueError("resolve the current scene's choice before advancing")
    if not isinstance(proposal, dict) or set(proposal) != {"date", "scene"}:
        raise ValueError("advance accepts only date and scene")
    if _date(proposal["date"]) < _date(world.date):
        raise ValueError("scene date must not move backwards")
    scene = proposal["scene"]
    if not isinstance(scene, dict) or set(scene) - {"title", "description", "options"}:
        raise ValueError("new scene accepts only title, description and options")
    next_scene = Scene(**scene, chapter=world.scene.chapter + 1)
    if not next_scene.title.strip() or not next_scene.description.strip():
        raise ValueError("new scene requires a title and description")
    result = world.model_copy(deep=True)
    result.date = proposal["date"]
    result.scene = next_scene
    result.version += 1
    _validate(result)
    event = Event(
        id=_id(result, request_id, "player", "advance"), branch_id=result.branch_id,
        request_id=request_id, date=result.date, actor_id="player", kind="advance",
        accepted=True, text=f"用户确认进入第{next_scene.chapter}章：{next_scene.title}",
        visibility=["player", *sorted(_actors(result))],
        data={"from_date": world.date, "chapter": next_scene.chapter,
              "scene": next_scene.model_dump()},
    )
    return result, [event]
