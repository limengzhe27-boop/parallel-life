"""Deterministic authority tests, not a substitute for real-model acceptance."""
import pytest

from parallel_life.models import Action, Branch, Character, Decision, LifeEvent, Option, Scene
from parallel_life.world import advance, initialize, settle, visible_state


@pytest.fixture
def branch():
    return Branch(
        id="branch-a", user_id="user-a", profile_id="profile-a", profile_revision=1,
        divergence_id="event-a", title="留在故乡", changed="留下", preserved="专业背景",
        opportunity="与朋友合作", cost="放弃外地机会", uncertainty="尚未确定收入",
        start_date="2018-06-01", identity="刚毕业的设计师", locations=["车站", "工作室"],
        past=[LifeEvent(id="past-1", date="2018-05-01", text="收到邀请", confirmed=True)],
        characters=[
            Character(id="a", name="阿岚", persona="谨慎", goal="开工作室", location="车站",
                      knowledge=["工作室有一台旧电脑", "私人暗号是松树"]),
            Character(id="b", name="小白", persona="乐观", goal="去外地", location="车站",
                      knowledge=["自己的车票是明天的"]),
            Character(id="c", name="陈老师", persona="严谨", goal="完成课程", location="工作室",
                      knowledge=["只有老师知道的评语"]),
        ],
        scene=Scene(title="站台", description="阿岚来送行。", options=[
            Option(id="stay", label="留下", consequence="你决定留下讨论合作。"),
            Option(id="leave", label="离开", consequence="你决定继续原来的行程。"),
        ]),
    )


@pytest.fixture
def world(branch):
    return initialize(branch)


def decide(actor, kind, **kwargs):
    return Decision(actor_id=actor, action=Action(kind=kind, **kwargs))


def test_initialize_clones_and_keeps_future_out(branch):
    world = initialize(branch)
    world.characters[0].knowledge.append("new")
    assert "new" not in branch.characters[0].knowledge
    assert world.items == {"player_notebook": "player", "character_letter": "a"}
    branch.past.append(LifeEvent(date="2020-01-01", text="未来经历"))
    with pytest.raises(ValueError, match="future"):
        initialize(branch)


@pytest.mark.parametrize("mutation", [
    lambda b: b.characters.pop(),
    lambda b: setattr(b.characters[0], "id", "player"),
    lambda b: setattr(b.characters[0], "id", "b"),
    lambda b: setattr(b.characters[0], "location", "unknown"),
    lambda b: setattr(b, "locations", []),
    lambda b: setattr(b, "locations", ["车站", "车站"]),
    lambda b: setattr(b, "start_date", "yesterday"),
    lambda b: setattr(b.scene, "chosen", "stay"),
    lambda b: b.scene.options.append(b.scene.options[0]),
])
def test_invalid_initial_world(branch, mutation):
    mutation(branch)
    with pytest.raises(ValueError):
        initialize(branch)


def test_view_hides_other_personas_goals_knowledge_and_locations(world):
    view = visible_state(world, "b")
    assert view["self"]["goal"] == "去外地"
    assert {c["id"] for c in view["characters"]} == {"player", "a"}
    assert all(set(c) == {"id", "name", "location"} for c in view["characters"])
    assert "私人暗号" not in str(view)
    assert "评语" not in str(view)
    assert "开工作室" not in str(view)
    with pytest.raises(ValueError):
        visible_state(world, "stranger")


def test_views_are_detached(world):
    view = visible_state(world, "a")
    view["self"]["knowledge"].append("外部写入")
    view["scene"]["description"] = "外部修改"
    assert "外部写入" not in world.characters[0].knowledge
    assert world.scene.description == "阿岚来送行。"


def test_settle_is_pure_deterministic_and_increments_once(world):
    updated, events = settle(world, [decide("b", "wait"), decide("a", "wait")], Action(), "r1")
    repeated, duplicate_events = settle(world, [decide("a", "wait"), decide("b", "wait")], Action(), "r1")
    assert updated == repeated
    assert events == duplicate_events
    assert [event.actor_id for event in events] == ["player", "a", "b"]
    assert world.version == 0 and updated.version == 1


@pytest.mark.parametrize("decisions", [
    [decide("stranger", "wait")], [decide("player", "wait")],
    [decide("a", "wait"), decide("a", "wait")],
    [decide(c, "wait") for c in ["a", "b", "c", "d"]],
])
def test_invalid_decision_set_is_atomic(world, decisions):
    original = world.model_dump()
    with pytest.raises(ValueError):
        settle(world, decisions, Action(kind="move", target="工作室"), "r1")
    assert world.model_dump() == original


def test_move_only_acting_character(world):
    updated, events = settle(world, [decide("a", "move", target="工作室")], None, "r1")
    assert updated.characters[0].location == "工作室"
    assert world.characters[0].location == "车站"
    assert updated.player_location == "车站"
    assert set(events[0].visibility) == {"a", "b", "c", "player"}
    failed, events = settle(updated, [decide("a", "move", target="月球")], None, "r2")
    assert not events[0].accepted
    assert failed.characters[0].location == "工作室"
    assert events[0].visibility == ["a"]


def test_npc_cannot_take_players_item(world):
    updated, events = settle(world, [decide("a", "transfer", item="player_notebook", target="b")], None, "r1")
    assert not events[0].accepted
    assert updated.items["player_notebook"] == "player"


def test_fixed_order_rechecks_owner_and_location(world):
    updated, events = settle(world, [
        decide("b", "transfer", item="character_letter", target="player"),
        decide("a", "transfer", item="character_letter", target="b"),
    ], None, "r1")
    assert [e.actor_id for e in events] == ["a", "b"]
    assert all(e.accepted for e in events)
    assert updated.items["character_letter"] == "player"
    updated, events = settle(world, [decide("a", "transfer", item="character_letter", target="player")],
                             Action(kind="move", target="工作室"), "r2")
    assert events[0].accepted and not events[1].accepted
    assert updated.items["character_letter"] == "a"


@pytest.mark.parametrize("action", [
    Action(kind="transfer", item="character_letter", target="a"),
    Action(kind="transfer", item="character_letter", target="c"),
    Action(kind="transfer", item="invented", target="b"),
    Action(kind="transfer", item="character_letter", target="stranger"),
])
def test_invalid_transfer(world, action):
    updated, events = settle(world, [Decision(actor_id="a", action=action)], None, "r")
    assert not events[0].accepted
    assert updated.items == world.items


def test_tell_requires_known_evidence_and_private_visibility(world):
    updated, events = settle(world, [decide("a", "tell", target="b", content="私人暗号是松树",
                                          evidence_id="knowledge:1")], None, "r1")
    assert events[0].accepted and events[0].visibility == ["a", "b"]
    assert "阿岚说：私人暗号是松树" in updated.characters[1].knowledge
    assert "私人暗号是松树" not in updated.characters[2].knowledge
    assert events[0].data["epistemic_status"] == "attributed_statement"
    _, events = settle(world, [decide("a", "tell", target="b", content="陌生秘密")], None, "r2")
    assert not events[0].accepted
    _, events = settle(world, [decide("a", "tell", target="b", content="私人暗号是松树",
                                    evidence_id="knowledge:0")], None, "r3")
    assert not events[0].accepted


def test_user_statement_is_attributed_not_automatically_true(world):
    updated, events = settle(world, [], Action(kind="tell", target="a", content="我来自未来"), "r")
    assert events[0].accepted
    assert "用户说：我来自未来" in updated.characters[0].knowledge
    assert updated.date == world.date and updated.identity == world.identity
    assert "我来自未来" not in str(visible_state(updated, "b"))


def promise(world, actor="a", target="player", request="r1"):
    action = Action(kind="promise", target=target, content="一起看工作室", due="2018-06-03")
    return settle(world, [] if actor == "player" else [Decision(actor_id=actor, action=action)],
                  action if actor == "player" else None, request)


def test_promise_is_private_open_and_source_linked(world):
    updated, events = promise(world, target="b")
    p = updated.promises[0]
    assert p.status == "open" and p.source_id == events[0].id
    assert visible_state(updated, "a")["promises"]
    assert visible_state(updated, "b")["promises"]
    assert not visible_state(updated, "c")["promises"]
    assert not visible_state(updated, "player")["promises"]


@pytest.mark.parametrize("due", ["2018-05-01", "tomorrow", "20180603"])
def test_invalid_promise_date(world, due):
    updated, events = settle(world, [decide("a", "promise", target="player", content="约定", due=due)], None, "r")
    assert not events[0].accepted and not updated.promises


def test_npc_self_claim_is_not_fulfillment_but_user_confirmation_is(world):
    updated, _ = promise(world)
    pid = updated.promises[0].id
    failed, events = settle(updated, [decide("a", "fulfill", promise_id=pid, content="完成了")], None, "r2")
    assert not events[0].accepted and failed.promises[0].status == "open"
    completed, events = settle(failed, [], Action(kind="fulfill", promise_id=pid), "r3")
    assert events[0].accepted and completed.promises[0].status == "completed"
    _, events = settle(completed, [], Action(kind="fulfill", promise_id=pid), "r4")
    assert not events[0].accepted


def test_user_cannot_confirm_a_private_npc_promise(world):
    updated, _ = promise(world, target="b")
    result, events = settle(updated, [], Action(kind="fulfill", promise_id=updated.promises[0].id), "r2")
    assert not events[0].accepted and result.promises[0].status == "open"


def test_only_owner_can_cancel_open_promise(world):
    updated, _ = promise(world)
    pid = updated.promises[0].id
    _, events = settle(updated, [], Action(kind="cancel", promise_id=pid), "r2")
    assert not events[0].accepted
    cancelled, events = settle(updated, [decide("a", "cancel", promise_id=pid)], None, "r3")
    assert events[0].accepted and cancelled.promises[0].status == "cancelled"


def test_promise_id_stable_and_not_added_twice(world):
    updated, _ = promise(world)
    duplicated, events = promise(updated)
    assert len(duplicated.promises) == 1 and not events[0].accepted


def test_only_player_can_choose_a_valid_option_once(world):
    unchanged, events = settle(world, [decide("a", "choose", target="stay")], None, "r1")
    assert not events[0].accepted and unchanged.scene.chosen is None
    unchanged, events = settle(world, [], Action(kind="choose", target="invented"), "r2")
    assert not events[0].accepted and unchanged.scene.chosen is None
    updated, events = settle(world, [], Action(kind="choose", target="stay"), "r3")
    assert updated.scene.chosen == "stay" and events[0].accepted
    assert events[0].data["consequence_preview"] == world.scene.options[0].consequence
    unchanged, events = settle(updated, [], Action(kind="choose", target="leave"), "r4")
    assert not events[0].accepted and unchanged.scene.chosen == "stay"


def test_explicit_option_move_only_happens_on_user_choice(branch):
    branch.scene.options[0].move_to = "工作室"
    world = initialize(branch)
    assert world.player_location == "车站"
    npc_attempt, events = settle(world, [decide("a", "choose", target="stay")], None, "npc-choice")
    assert not events[0].accepted
    assert npc_attempt.player_location == "车站" and npc_attempt.scene.chosen is None
    updated, events = settle(world, [], Action(kind="choose", target="stay"), "player-choice")
    assert updated.player_location == "工作室" and world.player_location == "车站"
    assert updated.characters == world.characters  # a label cannot move a companion
    assert events[0].data["move_from"] == "车站" and events[0].data["move_to"] == "工作室"
    assert set(events[0].visibility) == {"player", "a", "b", "c"}  # observers at both sites
    assert "用户从车站移动至工作室" in events[0].text


def test_legacy_option_prose_does_not_imply_effects_and_future_is_preview(world):
    world.scene.options[0].label = "跟阿岚去工作室"
    world.scene.options[0].consequence = "你将成为百万富翁，与阿岚共创公司。"
    assert world.scene.options[0].move_to is None
    updated, events = settle(world, [], Action(kind="choose", target="stay"), "legacy-choice")
    assert updated.player_location == "车站"  # no migrations or NLP state mutation
    assert "百万富翁" not in events[0].text and "共创公司" not in events[0].text
    assert events[0].data["consequence_preview"] == world.scene.options[0].consequence
    assert "consequence" not in events[0].data and "move_to" not in events[0].data
    assert updated.identity == world.identity and updated.items == world.items


def test_option_move_to_current_location_is_not_reported_as_movement(world):
    world.scene.options[0].move_to = "车站"
    updated, events = settle(world, [], Action(kind="choose", target="stay"), "same-location")
    assert updated.player_location == world.player_location
    assert "move_from" not in events[0].data and "move_to" not in events[0].data
    assert set(events[0].visibility) == {"player", "a", "b"}


@pytest.mark.parametrize("target", ["不存在的河堤", ""])
def test_invalid_option_destination_rejected_at_initialization(branch, target):
    branch.scene.options[0].move_to = target
    with pytest.raises(ValueError, match="move_to"):
        initialize(branch)


def test_invalid_option_destination_rejected_before_any_round_effect(world):
    world.scene.options[0].move_to = "不存在的河堤"
    original = world.model_dump()
    with pytest.raises(ValueError, match="move_to"):
        settle(world, [], Action(kind="choose", target="stay"), "invalid-choice")
    assert world.model_dump() == original


def test_new_scene_option_movement_is_validated_and_not_executed_by_advance(world):
    chosen, _ = settle(world, [], Action(kind="choose", target="stay"), "first-choice")
    proposal = next_scene(scene={"title": "讨论合作", "description": "仍然站在车站。",
        "options": [{"id": "visit", "label": "去工作室", "consequence": "也许谈成合作",
                     "move_to": "工作室"}]})
    advanced, _ = advance(chosen, proposal, True, "next-scene")
    assert advanced.player_location == "车站" and advanced.scene.options[0].move_to == "工作室"
    moved, _ = settle(advanced, [], Action(kind="choose", target="visit"), "second-choice")
    assert moved.player_location == "工作室"
    proposal["scene"]["options"][0]["move_to"] = "凭空出现的地点"
    with pytest.raises(ValueError, match="move_to"):
        advance(chosen, proposal, True, "bad-next-scene")


def next_scene(**changes):
    return {"date": "2018-06-10", "scene": {"title": "新的一周", "description": "你再次来到了这里。"}, **changes}


def test_advance_requires_confirmation_and_current_choice(world):
    with pytest.raises(ValueError, match="confirmation"):
        advance(world, next_scene(), False, "r1")
    with pytest.raises(ValueError, match="choice"):
        advance(world, next_scene(), True, "r1")
    chosen, _ = settle(world, [], Action(kind="choose", target="stay"), "r1")
    updated, events = advance(chosen, next_scene(), True, "r2")
    assert updated.version == 2 and chosen.version == 1
    assert updated.scene.chapter == 2 and updated.scene.chosen is None
    assert updated.date == "2018-06-10" and events[0].accepted
    assert updated.characters == chosen.characters and updated.items == chosen.items


def test_time_skip_never_completes_promises_or_leaks_private_ids(world):
    promised, _ = promise(world, target="b")
    chosen, _ = settle(promised, [], Action(kind="choose", target="stay"), "r2")
    updated, events = advance(chosen, next_scene(), True, "r3")
    assert updated.promises[0].status == "open"
    assert updated.promises[0].id not in str(events[0].model_dump())


@pytest.mark.parametrize("proposal", [
    next_scene(date="2010-01-01"), next_scene(date="tomorrow"), next_scene(date=None),
    next_scene(items={}), next_scene(characters=[]),
    next_scene(scene={"title": "新场景", "description": "...", "chosen": "x"}),
    next_scene(scene={"title": "新场景", "description": "...", "chapter": 4}),
    next_scene(scene={"title": "", "description": "..."}),
])
def test_invalid_scene_proposal(world, proposal):
    chosen, _ = settle(world, [], Action(kind="choose", target="stay"), "r1")
    before = chosen.model_dump()
    with pytest.raises(ValueError):
        advance(chosen, proposal, True, "r2")
    assert chosen.model_dump() == before
