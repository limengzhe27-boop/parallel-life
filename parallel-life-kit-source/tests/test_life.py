import copy

import pytest

from parallel_life.life import confirm_profile, generate_branches, interview
from parallel_life.models import LifeEvent, Profile
from parallel_life.providers import ProviderError


class ScriptedProvider:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    async def json(self, task, context):
        self.calls.append((task, copy.deepcopy(context)))
        return self.responses.pop(0)


def scene_payload(index=0):
    return {"title": f"分支{index}", "changed": f"改变选择{index}", "preserved": "家庭背景",
            "opportunity": "新机会", "cost": "时间成本", "uncertainty": "结果未知",
            "identity": "当年的学生", "locations": ["校园", "车站"],
            "characters": [{"id": f"c{i}", "name": f"人物{i}", "persona": f"性格{i}",
                            "goal": f"目标{i}", "location": "校园", "knowledge": [f"见闻{i}"]}
                           for i in range(1, 4)],
            "scene": {"title": "出发前", "description": "你站在校园门口。",
                      "options": [{"id": "go", "label": "去车站", "consequence": "准备出发"}]}}


def profile():
    return confirm_profile(Profile(user_id="u", identity="未来董事长",
        values=["未来的价值观"], events=[
            LifeEvent(id="past", date="2000-01-01", text="我入学", source_quote="我入学"),
            LifeEvent(id="fork", date="2005-01-01", text="我决定留学", choice="留学", source_quote="我决定留学"),
            LifeEvent(id="future", date="2020-01-01", text="未来绝密经历", source_quote="未来绝密经历"),
        ]))


async def test_interview_evidence_not_model_claims():
    p = ScriptedProvider([{"identity": "学生", "events": [
        {"date": "2005-01-01", "text": "出国", "source_quote": "2005-01-01我出国"},
        {"date": "2007-01-01", "text": "成为富豪", "source_quote": "模型编造的原话"}],
        "values": [], "questions": []}])
    result = await interview(p, "u", "2005-01-01我出国")
    assert len(result.events) == 1
    assert not result.confirmed and not result.events[0].confirmed
    assert any("原话" in question for question in result.questions)


async def test_unknown_dates_are_not_invented():
    p = ScriptedProvider([{"events": [{"date": "2005", "text": "出国", "source_quote": "2005年出国"}]}])
    result = await interview(p, "u", "2005年出国")
    assert result.events[0].date == ""
    with pytest.raises(ValueError, match="YYYY-MM-DD"):
        confirm_profile(result)


async def test_model_cannot_guess_january_first_from_a_year():
    p = ScriptedProvider([{"events": [{"date": "2005-01-01", "text": "出国", "source_quote": "2005年出国"}]}])
    result = await interview(p, "u", "2005年出国")
    assert result.events[0].date == "" and result.questions


async def test_chinese_explicit_date_is_accepted():
    p = ScriptedProvider([{"events": [{"date": "2005-08-01", "text": "出国", "source_quote": "2005年8月1日出国"}]}])
    result = await interview(p, "u", "2005年8月1日出国")
    assert result.events[0].date == "2005-08-01"


async def test_previous_profile_user_isolation_and_revision():
    old = profile()
    with pytest.raises(ValueError, match="another user"):
        await interview(ScriptedProvider([]), "other", "新信息", old)
    p = ScriptedProvider([{"events": [{"date": "2000-01-01", "text": "我入学", "source_quote": "我入学"}]}])
    result = await interview(p, "u", "补充信息", old)
    assert result.id != old.id and result.revision == old.revision + 1
    assert result.events[0].id == "past"
    assert old.confirmed


def test_confirmation_copies_and_user_edits():
    draft = Profile(user_id="u", events=[LifeEvent(id="a", date="2001-01-01", text="选择读书")])
    result = confirm_profile(draft, identity="当年的我")
    assert result.confirmed and result.events[0].confirmed
    assert not draft.confirmed and not draft.events[0].confirmed
    assert result.events[0].source_quote == "选择读书"


@pytest.mark.parametrize("value", ["2001", "2001-02-30", "2001-1-1", "", "not a date"])
def test_confirmation_requires_real_iso_date(value):
    with pytest.raises(ValueError):
        confirm_profile(Profile(user_id="u", events=[LifeEvent(date=value, text="经历")]))


async def test_branch_initialization_excludes_modern_identity_and_future():
    selection = {"branches": [{"divergence_id": "fork"}] * 3}
    provider = ScriptedProvider([selection, *(scene_payload(i) for i in range(3))])
    source = profile()
    branches = await generate_branches(provider, source)
    assert len(branches) == 3 and len({b.id for b in branches}) == 3
    for branch in branches:
        assert branch.start_date == "2005-01-01"
        assert branch.profile_id == source.id and branch.profile_revision == source.revision
        assert {e.id for e in branch.past} == {"past", "fork"}
    for task, context in provider.calls[1:]:
        assert task == "branch"
        assert "未来" not in str(context)
        assert "未来董事长" not in str(context)
        assert "未来的价值观" not in str(context)


async def test_later_candidate_cannot_leak_into_earlier_initialization():
    provider = ScriptedProvider([{"branches": [{"divergence_id": "future"}, {"divergence_id": "past"},
                                              {"divergence_id": "fork"}]},
                                 scene_payload(0), scene_payload(1), scene_payload(2)])
    await generate_branches(provider, profile())
    assert provider.calls[2][1]["avoid"] == []
    assert "未来绝密经历" not in str(provider.calls[2][1])


async def test_unconfirmed_profile_does_not_call_model():
    provider = ScriptedProvider([])
    with pytest.raises(ValueError, match="Confirm"):
        await generate_branches(provider, Profile(user_id="u"))
    assert provider.calls == []


async def test_ungrounded_divergence_is_rejected():
    provider = ScriptedProvider([{"branches": [{"divergence_id": "invented"}] * 3}])
    with pytest.raises(ProviderError, match="ungrounded"):
        await generate_branches(provider, profile())


async def test_duplicate_counterfactual_rejected():
    provider = ScriptedProvider([{"branches": [{"divergence_id": "fork"}] * 3}, scene_payload(), scene_payload(), scene_payload()])
    with pytest.raises(ProviderError, match="duplicate_branch"):
        await generate_branches(provider, profile())


@pytest.mark.parametrize("invalid", ["unknown_location", "duplicate_character", "no_options", "missing_cost"])
async def test_invalid_world_initialization_rejected(invalid):
    payload = scene_payload()
    if invalid == "unknown_location":
        payload["characters"][0]["location"] = "未声明地点"
    elif invalid == "duplicate_character":
        payload["characters"][0]["id"] = "c2"
    elif invalid == "no_options":
        payload["scene"]["options"] = []
    else:
        payload.pop("cost")
    provider = ScriptedProvider([{"branches": [{"divergence_id": "fork"}] * 3}, payload])
    with pytest.raises(ProviderError, match="invalid_branch"):
        await generate_branches(provider, profile())
