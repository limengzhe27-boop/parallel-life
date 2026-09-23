"""Test doubles are dependency injections, never a runtime/offline demo mode."""
import copy
import inspect

from parallel_life.models import Branch, Character, LifeEvent, Message, Option, Scene


def make_branch(user="user-a", branch="branch-a"):
    return Branch(id=branch, user_id=user, profile_id="profile-a", profile_revision=1,
        divergence_id="event-a", title="故乡的选择", changed="留下", preserved="专业背景",
        opportunity="合作", cost="时间", uncertainty="收入未知", start_date="2018-06-01",
        identity="刚毕业的设计师", locations=["车站", "工作室"],
        past=[LifeEvent(date="2018-05-01", text="毕业", confirmed=True)],
        characters=[Character(id="a", name="阿岚", persona="谨慎", goal="开工作室",
                              location="车站", knowledge=["阿岚私有暗号松树"]),
                    Character(id="b", name="小白", persona="乐观", goal="去外地",
                              location="车站", knowledge=["小白私有暗号海豚"]),
                    Character(id="c", name="陈老师", persona="严谨", goal="完成课程",
                              location="工作室", knowledge=["老师私有暗号山坡"])],
        scene=Scene(title="站台", description="列车尚未进站。", options=[
            Option(id="stay", label="留下", consequence="开始讨论合作")]))


def add_message(store, index=0, *, user="user-a", branch="branch-a", actor="a",
                role="user", text=None, ident=None):
    msg = Message(id=ident or f"{user}:{branch}:{actor}:{index}", user_id=user,
        branch_id=branch, actor_id="player" if role == "user" else actor,
        role=role, text=text or f"第{index}条原话：我喜欢安静的地方。",
        visibility=[actor], request_id=f"message-{index}")
    store.put("message", msg)
    return msg


class FakeProvider:
    def __init__(self):
        self.calls = []
        self.image_calls = []
        self.handlers = {}
        self.image_error = None
        self.image_prompt = None

    async def json(self, task, payload):
        self.calls.append((task, copy.deepcopy(payload)))
        if task in self.handlers:
            value = self.handlers[task]
            if isinstance(value, list):
                value = value.pop(0)
            if isinstance(value, BaseException):
                raise value
            result = value(payload) if callable(value) else copy.deepcopy(value)
            return await result if inspect.isawaitable(result) else result
        if task == "dialogue_review":
            return {"keep": [s["id"] for s in payload["sentences"]], "issues": []}
        if task == "route":
            return {"mode": "chat", "source_quote": payload["input"], "topic": "当前话题",
                    "focus": payload["input"], "parked_topics": []}
        if task == "role_card":
            char = payload["character"]
            return {"identity": char["persona"], "voice": char.get("voice") or "简短自然", "stance": ""}
        if task == "decide":
            return {"action": {"kind": "wait"}, "rationale": "仅根据自己的目标等待。"}
        if task == "reply":
            return {"text": "我记得你刚才说的，我们接着聊。", "image_prompt": self.image_prompt}
        if task == "memory":
            users = [s for s in payload["sources"] if s.get("role") == "user"]
            return {"items": [] if not users else [{"kind": "preference", "key": "quiet",
                "text": users[0]["text"], "source_type": "user_statement",
                "source_ids": [users[0]["id"]], "importance": .8}]}
        if task == "summary":
            return {"text": "；".join(m["text"] for m in payload["messages"])}
        if task == "advance":
            return {"date": "2018-06-02", "title": "次日", "description": "新的一天开始了。",
                    "options": []}
        raise AssertionError(f"unexpected task {task}")

    async def reply(self, payload):
        return (await self.json("reply", payload))["text"]

    async def image(self, prompt):
        self.image_calls.append(prompt)
        if self.image_error:
            raise self.image_error
        return b"test-image-content", "image/png"
