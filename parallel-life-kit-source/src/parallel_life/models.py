"""Small shared contracts. World truth and derived memories remain separate."""
from __future__ import annotations

from typing import Literal
from uuid import uuid4
from pydantic import BaseModel, ConfigDict, Field


def uid() -> str:
    return uuid4().hex


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LifeEvent(Model):
    id: str = Field(default_factory=uid)
    date: str  # ISO date; unknown dates must be clarified before confirmation
    text: str = Field(min_length=1, max_length=4000)
    choice: str = ""
    people: list[str] = Field(default_factory=list)
    confirmed: bool = False
    source_quote: str = ""


class Profile(Model):
    id: str = Field(default_factory=uid)
    user_id: str
    revision: int = 1
    identity: str = ""
    events: list[LifeEvent] = Field(default_factory=list)
    values: list[str] = Field(default_factory=list)
    questions: list[str] = Field(default_factory=list)
    confirmed: bool = False


class Character(Model):
    id: str
    name: str
    persona: str
    voice: str = Field(default="", max_length=1000)  # Speaking style, not a task.
    goal: str
    relationship: str = "初次相识"
    appearance: str = "自然日常装束"
    style: str = "写实插画"
    location: str
    knowledge: list[str] = Field(default_factory=list)
    knowledge_sources: dict[str, str] = Field(default_factory=dict)
    version: int = 1


class Option(Model):
    id: str
    label: str
    consequence: str
    move_to: str | None = None


class Scene(Model):
    title: str
    description: str
    options: list[Option] = Field(default_factory=list)
    chosen: str | None = None
    chapter: int = 1


class Branch(Model):
    id: str = Field(default_factory=uid)
    user_id: str
    profile_id: str
    profile_revision: int
    divergence_id: str
    title: str
    changed: str
    preserved: str
    opportunity: str
    cost: str
    uncertainty: str
    start_date: str
    identity: str
    past: list[LifeEvent] = Field(default_factory=list)
    locations: list[str]
    characters: list[Character]
    scene: Scene


class Promise(Model):
    id: str
    actor_id: str
    target_id: str
    content: str
    condition: str = ""
    due: str = ""
    status: Literal["open", "completed", "cancelled"] = "open"
    source_id: str
    visibility: list[str]


class World(Model):
    branch_id: str
    user_id: str
    version: int = 0
    date: str
    identity: str
    locations: list[str]
    player_location: str
    characters: list[Character]
    scene: Scene
    items: dict[str, str] = Field(default_factory=dict)  # item id -> owner id
    promises: list[Promise] = Field(default_factory=list)


class Action(Model):
    kind: Literal["wait", "propose", "move", "tell", "promise", "cancel", "fulfill", "transfer", "choose"] = "wait"
    target: str = ""
    content: str = Field(default="", max_length=2000)
    item: str = ""
    promise_id: str = ""
    due: str = ""
    condition: str = ""
    evidence_id: str = ""


class Decision(Model):
    actor_id: str
    action: Action = Field(default_factory=Action)
    rationale: str = ""


class Event(Model):
    id: str = Field(default_factory=uid)
    branch_id: str
    request_id: str
    date: str
    actor_id: str
    kind: str
    accepted: bool
    text: str
    visibility: list[str]
    data: dict = Field(default_factory=dict)


class Message(Model):
    id: str = Field(default_factory=uid)
    user_id: str
    branch_id: str
    actor_id: str
    role: Literal["user", "assistant", "image", "system"]
    text: str
    visibility: list[str]
    request_id: str
    image_id: str | None = None


class Memory(Model):
    id: str = Field(default_factory=uid)
    user_id: str
    branch_id: str
    actor_id: str
    kind: Literal["preference", "episode", "belief", "summary", "correction"]
    key: str
    text: str
    source_type: Literal["user_statement", "event", "agent_inference", "summary", "user_correction"]
    source_ids: list[str]
    status: Literal["active", "superseded", "forgotten"] = "active"
    importance: float = Field(default=0.5, ge=0, le=1)
    created_at: float = 0


class Job(Model):
    id: str = Field(default_factory=uid)
    user_id: str
    branch_id: str
    actor_id: str
    kind: Literal["memory", "summary", "image"]
    status: Literal["pending", "running", "done", "failed", "uncertain"] = "pending"
    payload: dict
    result: dict = Field(default_factory=dict)
    attempts: int = 0
    error: str = ""
    created_at: float = 0
