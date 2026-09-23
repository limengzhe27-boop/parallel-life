"""Narrative proposals affect the story, not unconfirmed physical outcomes."""
from parallel_life.models import Action, Decision
from parallel_life.world import initialize, settle
from helpers import make_branch


def test_proposal_is_attributed_not_implemented_or_auto_accepted():
    world = initialize(make_branch())
    updated, events = settle(world, [Decision(actor_id="a", action=Action(
        kind="propose", target="player", content="我们一起开个小工作室，好吗？"))], None, "proposal")
    assert events[0].accepted
    assert events[0].data["status"] == "proposed"
    assert "尚未实施" in events[0].text
    assert events[0].visibility == ["a", "player"]
    assert updated.player_location == world.player_location
    assert updated.items == world.items
    assert updated.scene.chosen is None
    assert updated.promises == []


def test_proposal_requires_known_recipient_and_nonempty_content():
    world = initialize(make_branch())
    for action in (Action(kind="propose", target="ghost", content="你好"),
                   Action(kind="propose", target="player", content="")):
        updated, events = settle(world, [Decision(actor_id="a", action=action)], None, "bad")
        assert not events[0].accepted
        assert updated.scene == world.scene
