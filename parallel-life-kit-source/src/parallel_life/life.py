"""Confirmed life snapshots and time-filtered counterfactual initialization."""
from __future__ import annotations

import asyncio
import re
from datetime import date

from pydantic import ValidationError

from .models import Branch, Character, LifeEvent, Profile, Scene
from .providers import Provider, ProviderError


def _valid_date(value: str) -> bool:
    try:
        return bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", value)) and date.fromisoformat(value) is not None
    except (ValueError, TypeError):
        return False


def _explicit_dates(text: str) -> set[str]:
    values = set()
    for year, month, day in re.findall(r"(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})(?:日)?", text):
        value = f"{int(year):04d}-{int(month):02d}-{int(day):02d}"
        if _valid_date(value):
            values.add(value)
    return values


async def interview(provider: Provider, user_id: str, text: str,
                    previous: Profile | None = None) -> Profile:
    if not text.strip() or len(text) > 30000:
        raise ValueError("Interview text must contain 1 to 30000 characters")
    if previous and previous.user_id != user_id:
        raise ValueError("Profile belongs to another user")
    result = await provider.json("interview", {"text": text,
        "previous": previous.model_dump() if previous else None})
    try:
        questions = result.get("questions", [])
        if not isinstance(questions, list) or not all(isinstance(item, str) for item in questions):
            raise ValueError
        events = []
        stated_dates = _explicit_dates(text)
        prior_quotes = {event.source_quote for event in previous.events} if previous else set()
        prior_by_quote = {event.source_quote: event for event in previous.events} if previous else {}
        for item in result.get("events", []):
            event = LifeEvent.model_validate(item)
            if not event.source_quote or (event.source_quote not in text and event.source_quote not in prior_quotes):
                questions.append("请补充这一经历的原话以便确认：" + event.text[:100])
                continue
            old = prior_by_quote.get(event.source_quote)
            if old:
                event.id = old.id
            event.confirmed = False
            date_supported = event.date in stated_dates or (old is not None and event.date == old.date)
            if not _valid_date(event.date) or not date_supported:
                event.date = ""
                questions.append("这件事发生在哪一天？请确认日期：" + event.text[:100])
            events.append(event)
        return Profile(user_id=user_id, revision=previous.revision + 1 if previous else 1,
                       identity=result.get("identity", ""), events=events,
                       values=result.get("values", []), questions=list(dict.fromkeys(questions)))
    except (ValidationError, ValueError, TypeError, AttributeError):
        raise ProviderError("invalid_interview_result") from None


def confirm_profile(profile: Profile, events: list[LifeEvent] | None = None,
                    identity: str | None = None) -> Profile:
    selected = [event.model_copy(deep=True) for event in (events if events is not None else profile.events)]
    if not selected:
        raise ValueError("At least one life event is required")
    if any(not _valid_date(event.date) for event in selected):
        raise ValueError("Every event needs a confirmed YYYY-MM-DD date")
    if len({event.id for event in selected}) != len(selected):
        raise ValueError("Life event IDs must be unique")
    for event in selected:
        event.confirmed = True
        # The confirmation UI is an explicit user edit, not automatic extraction.
        event.source_quote = event.source_quote or event.text
    return profile.model_copy(update={"events": selected, "identity": identity if identity is not None else profile.identity,
                                      "confirmed": True, "questions": []}, deep=True)


async def generate_branches(provider: Provider, profile: Profile) -> list[Branch]:
    if not profile.confirmed or not profile.events or any(not e.confirmed or not _valid_date(e.date) for e in profile.events):
        raise ValueError("Confirm dated life events before generating branches")
    # Selection sees dates/choices; initialization never sees modern identity,
    # modern values, or later events. No generated outline can smuggle them across.
    selection = await provider.json("branches", {"events": [e.model_dump() for e in profile.events]})
    candidates = selection.get("branches")
    if not isinstance(candidates, list) or len(candidates) != 3:
        raise ProviderError("expected_three_branches")
    events = {event.id: event for event in profile.events}
    async def create(index, candidate):
        if not isinstance(candidate, dict) or candidate.get("divergence_id") not in events:
            raise ProviderError("ungrounded_divergence")
        divergence = events[candidate["divergence_id"]]
        past = [event.model_copy(deep=True) for event in profile.events if event.date <= divergence.date]
        generated = await provider.json("branch", {
            "divergence": divergence.model_dump(), "past": [event.model_dump() for event in past],
            "variant_index": index,
            # Independent variants run concurrently; no candidate can leak a later life.
            "avoid": [],
        })
        try:
            characters = [Character.model_validate(item) for item in generated["characters"]]
            locations = generated["locations"]
            if (len(characters) != 3 or {c.id for c in characters} != {"c1", "c2", "c3"}
                    or not isinstance(locations, list) or not 1 <= len(locations) <= 8
                    or len(set(locations)) != len(locations)
                    or any(not isinstance(place, str) or not place.strip() for place in locations)
                    or any(c.location not in locations for c in characters)):
                raise ValueError
            scene = Scene.model_validate(generated["scene"])
            if not scene.options or len({o.id for o in scene.options}) != len(scene.options):
                raise ValueError
            scene.chosen, scene.chapter = None, 1
            fields = ("title", "changed", "preserved", "opportunity", "cost", "uncertainty", "identity")
            if any(not isinstance(generated.get(k), str) or not generated[k].strip() for k in fields):
                raise ValueError
            branch = Branch(user_id=profile.user_id, profile_id=profile.id,
                profile_revision=profile.revision, divergence_id=divergence.id,
                start_date=divergence.date, past=past, characters=characters, locations=locations,
                scene=scene, **{key: generated[key].strip() for key in fields})
        except (ValidationError, ValueError, TypeError, KeyError):
            raise ProviderError("invalid_branch_result") from None
        return branch
    branches = await asyncio.gather(*(create(i, c) for i, c in enumerate(candidates)))
    seen_titles, seen_changes = set(), set()
    for branch in branches:
        if branch.title in seen_titles or branch.changed in seen_changes:
            raise ProviderError("duplicate_branch")
        seen_titles.add(branch.title)
        seen_changes.add(branch.changed)
    return branches
