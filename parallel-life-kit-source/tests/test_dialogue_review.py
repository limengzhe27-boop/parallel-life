"""Deletion-only review contracts; no live-model acceptance claims."""
import copy

import pytest

from parallel_life.dialogue import dialogue_sentences, review_context, select_reviewed_dialogue
from parallel_life.providers import ProviderError, TASKS


def test_stage_directions_preserved_for_review_without_regex_content_deletion():
    draft = "（摆了摆手，语气直白）我还有不同看法。茶不加糖，对吧？"
    sentences = dialogue_sentences(draft)
    assert sentences == [{"id": 0, "text": "（摆了摆手，语气直白）我还有不同看法。"}, {"id": 1, "text": "茶不加糖，对吧？"}]
    assert select_reviewed_dialogue(sentences, {"keep": [0, 1], "issues": []}) == draft
    assert select_reviewed_dialogue(sentences, {"keep": [1], "issues": ["首句含动作"]}) == "茶不加糖，对吧？"


@pytest.mark.parametrize("direction", ["翻速写的手顿了顿，抬眼扫你", "把手里的本子扣在桌面", "拿起桌上的茶抿了一口",
    "抬眼扫了圈房间", "轻轻点头", "smiles", "slowly nods"])
def test_bracket_stage_directions_are_not_silently_removed(direction):
    draft = f"好。（{direction}）接着说吧。"
    assert dialogue_sentences(draft) == [{"id": 0, "text": "好。"}, {"id": 1, "text": f"（{direction}）接着说吧。"}]


def test_explanatory_parentheses_and_uncertain_asides_are_not_blindly_deleted():
    draft = "我喜欢人工智能（AI）。我（暂时）还没决定。数值约为3.14。"
    assert "".join(s["text"] for s in dialogue_sentences(draft)) == draft


def test_sentence_boundaries_retain_quotes_newlines_and_unpunctuated_tail():
    draft = '“真的吗？！”\n我还想听听。Really? I agree.\n嗯'
    sentences = dialogue_sentences(draft)
    assert "".join(s["text"] for s in sentences) == draft
    assert [s["text"] for s in sentences] == ['“真的吗？！”', '\n我还想听听。', 'Really?', ' I agree.', '\n嗯']


def test_selection_deletes_whole_sentences_only_and_forces_original_order():
    sentences = dialogue_sentences("原文一。原文二。原文三。")
    assert select_reviewed_dialogue(sentences, {"keep": [2, 0], "issues": ["第二句缺少依据"]}) == "原文一。原文三。"


@pytest.mark.parametrize("review", [
    {"keep": [0], "issues": [], "text": "新增的角色台词。"},
    {"text": "新增的角色台词。", "issues": []},
    {"keep": [0, 0], "issues": []},
    {"keep": [3], "issues": []},
    {"keep": [-1], "issues": []},
    {"keep": [True], "issues": []},
    {"keep": ["0"], "issues": []},
    {"keep": [0.0], "issues": []},
    {"keep": [0], "issues": [{"reason": "not the schema"}]},
    {"keep": [0], "issues": ["x" * 501]},
    {"keep": [0], "issues": ["x"] * 21},
    {"keep": "0", "issues": []},
    {"keep": [0], "issues": None},
])
def test_reviewer_cannot_supply_replacement_text_or_invalid_selection(review):
    with pytest.raises(ProviderError, match="invalid_dialogue_review"):
        select_reviewed_dialogue(dialogue_sentences("唯一的草稿句。"), review)


@pytest.mark.parametrize("draft", ["（点头）", "（把手放在桌上）", "", "唯一草稿。"])
def test_no_acceptable_sentence_requires_explicit_failure_not_canned_reply(draft):
    with pytest.raises(ProviderError, match="dialogue_draft_rejected"):
        select_reviewed_dialogue(dialogue_sentences(draft), {"keep": [], "issues": ["没有合格句子"]})


def test_review_receives_scoped_evidence_and_sentence_ids_not_free_rewrite_candidate():
    payload = {"context": {"character": {"relationship": "朋友"},
        "world": {"date": "2010-01-01", "self": {"location": "车站"}, "characters": [], "promises": []},
        "recent": [{"id": "u", "role": "user", "text": "我只是好奇，还没决定。"}], "memories": []},
        "role_card": {"identity": "朋友"}, "input": "我只是好奇，还没决定。", "media": {"status": "pending"},
        "conversation": {"parked_topics": ["报考选择"]}, "outcomes": []}
    original = copy.deepcopy(payload)
    evidence = review_context(payload, "（点头）慢慢想也好。你刚才已经决定报名了。")
    assert evidence["sentences"] == [{"id": 0, "text": "（点头）慢慢想也好。"}, {"id": 1, "text": "你刚才已经决定报名了。"}]
    assert "candidate" not in evidence and "text" not in evidence
    assert evidence["media"] == {"status": "pending"} and evidence["parked_topics"] == ["报考选择"]
    assert evidence["facts"]["location"] == "车站" and evidence["history"] == [{"role": "user", "text": payload["input"]}]
    assert payload == original
    assert select_reviewed_dialogue(evidence["sentences"], {"keep": [0], "issues": ["用户只表达好奇"]}) == "（点头）慢慢想也好。"


def test_review_policy_has_no_free_generation_permission():
    policy = TASKS["dialogue_review"]
    assert "{keep:[int],issues:[string]}" in policy
    assert "不写新台词" in policy and "不输出text" in policy and "整句删除" in policy
    assert "不强制赞同" in policy and "已搁置话题" in policy
    assert "同场不等于交谈过" in policy and "愿望或好奇不等于已经决定" in policy
    assert "不可声称已发送、已失败、要拍照或找设备" in policy


def test_review_keeps_current_actor_knowledge_and_source_without_private_role_goals():
    payload = {"context": {"character": {"relationship": "朋友", "goal": "不该送给校验器的任务",
            "knowledge": ["小屋钥匙由用户保管", "知道本地办事规则"],
            "knowledge_sources": {"小屋钥匙由用户保管": "settled-tell-event"}},
        "world": {"date": "2010-01-01", "self": {"location": "车站"}}, "recent": [], "memories": []},
        "role_card": {"identity": "朋友"}, "input": "钥匙在谁那里？", "media": {"status": "none"},
        "conversation": {}, "outcomes": []}
    original = copy.deepcopy(payload)
    prepared = review_context(payload, "钥匙在你那里。")
    assert prepared["facts"]["character_knowledge"] == [
        {"text": "小屋钥匙由用户保管", "source_id": "settled-tell-event"}, {"text": "知道本地办事规则"}]
    assert "不该送给校验器的任务" not in str(prepared)
    assert "能力描述不证明任何具体规则或已完成核验" in TASKS["dialogue_review"]
    assert payload == original


def test_period_after_a_number_is_a_boundary_but_decimal_point_is_not():
    sentences = dialogue_sentences("The value is 3.14. The count is 2. Done.")
    assert [s["text"] for s in sentences] == ["The value is 3.14.", " The count is 2.", " Done."]


def test_single_diagnostic_string_is_losslessly_normalized_without_weakening_keep_ids():
    sentences = dialogue_sentences('原句。')
    assert select_reviewed_dialogue(sentences, {'keep': [0], 'issues': '一条说明'}) == '原句。'
    with pytest.raises(ProviderError):
        select_reviewed_dialogue(sentences, {'keep': ['0'], 'issues': '一条说明'})
