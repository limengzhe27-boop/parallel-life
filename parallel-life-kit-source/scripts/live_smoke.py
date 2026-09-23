#!/usr/bin/env python3
"""Paid real-provider acceptance through the running HTTP API; no substitute models.

The biography below is an explicitly fictional test fixture, never the user's life.
"""
import argparse
import json
from pathlib import Path
import time
from uuid import uuid4
import httpx


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8108")
    parser.add_argument("--output", default="data/live-verification.json")
    args = parser.parse_args()
    records = []
    user = "live-test-" + uuid4().hex[:10]
    report = {"mode": "live", "synthetic_biography": True, "user_id": user, "steps": records}
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    client = httpx.Client(base_url=args.url, timeout=240)

    def call(method, path, body=None):
        started = time.monotonic()
        response = client.request(method, path, json=body)
        data = response.json()
        records.append({"method": method, "path": path, "input": body,
            "status": response.status_code, "seconds": round(time.monotonic() - started, 2), "output": data})
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2))
        print(method, path.split("?")[0], response.status_code, flush=True)
        response.raise_for_status()
        return data

    health = call("GET", "/api/health")
    assert health["mode"] == "live" and health["configured"]
    profile = call("POST", "/api/interview", {"user_id": user, "text":
        "以下是虚构测试人物林舟的履历，不是操作者的真实人生。"
        "2008-09-01，我收到大学录取通知，当时喜欢绘画，但因为家人期望，最终选择了计算机专业。"
        "当时我住在小城，朋友阿宁鼓励我认真考虑艺术道路，家里只能负担普通学费。"
        "2016-06-15，我在一家软件公司担任工程师，拒绝了朋友邀请我一起开设计工作室。"
        "我现在的秘密代号是 FUTURE_ONLY_CEDAR，这是2016年以后才有的代号。"})
    profile = call("POST", f"/api/profiles/{profile['id']}/confirm", {
        "user_id": user, "identity": profile["identity"], "events": profile["events"]})
    branches = call("POST", f"/api/profiles/{profile['id']}/branches", {
        "user_id": user, "request_id": uuid4().hex})["branches"]
    assert len(branches) == 3 and len({b["changed"] for b in branches}) == 3
    branch = min(branches, key=lambda b: b["start_date"])
    world = call("POST", f"/api/branches/{branch['id']}/enter", {
        "user_id": user, "request_id": uuid4().hex})
    assert "FUTURE_ONLY_CEDAR" not in json.dumps(world)
    bid = branch["id"]
    actor = world["characters"][0]["id"]
    payload = {"user_id": user, "request_id": uuid4().hex, "version": world["version"],
        "conversation_version": 0, "character_id": actor, "image_request": "此刻窗外街角的图",
        "text": "这是只告诉你的秘密：我喜欢雨后松木的气味。请记住。也请给我画一张此刻窗外街角的图，直接发图就好。"}
    turn = call("POST", f"/api/branches/{bid}/interact", payload)
    assert turn["reply_status"] == "done", turn["errors"]
    assert turn["turn_mode"] == "image" and turn["world"]["version"] == world["version"]
    assert turn["events"] == [] and turn["conversation"]["revision"] == 1
    again = call("POST", f"/api/branches/{bid}/interact", payload)
    assert turn == again
    traces = call("GET", f"/api/branches/{bid}/decisions?user_id={user}")["decisions"]
    assert traces == [], "ordinary chat/image must not run world decisions"
    state = call("GET", f"/api/branches/{bid}/conversation?user_id={user}&character_id={actor}")["state"]
    assert state["revision"] == turn["conversation"]["revision"]
    history = call("GET", f"/api/branches/{bid}/history?user_id={user}")
    assert any(t["request_id"] == payload["request_id"] and t["reply_status"] == "done" for t in history["turns"])
    image_jobs = [j for j in turn["jobs"] if j["kind"] == "image"]
    assert len(image_jobs) == 1, "explicit image request did not reserve one image job"
    deadline = time.monotonic() + 240
    for job in turn["jobs"]:
        while time.monotonic() < deadline:
            state = call("GET", f"/api/jobs/{job['id']}?user_id={user}")
            if state["status"] in {"done", "failed", "uncertain"}:
                break
            time.sleep(4)
        assert state["status"] == "done", state
    image = client.get(f"/api/images/{image_jobs[0]['id']}?user_id={user}")
    image.raise_for_status()
    assert image.headers["content-type"].startswith("image/") and len(image.content) > 1000
    report["image"] = {"job_id": image_jobs[0]["id"], "bytes": len(image.content),
                       "mime": image.headers["content-type"]}
    for char in world["characters"]:
        memories = call("GET", f"/api/branches/{bid}/memories?user_id={user}&character_id={char['id']}")["memories"]
        if char["id"] != actor:
            assert "雨后松木" not in json.dumps(memories, ensure_ascii=False)
    chosen = turn["world"]["scene"]["options"][0]
    turn2 = call("POST", f"/api/branches/{bid}/interact", {
        "user_id": user, "request_id": uuid4().hex, "version": turn["world"]["version"],
        "conversation_version": turn["conversation"]["revision"],
        "character_id": actor, "text": "我决定采取这一步：" + chosen["label"],
        "user_action": {"kind": "choose", "target": chosen["id"]}})
    assert turn2["world"]["scene"]["chosen"] == chosen["id"]
    assert turn2["turn_mode"] == "world" and turn2["reply_status"] == "done", turn2["errors"]
    traces = call("GET", f"/api/branches/{bid}/decisions?user_id={user}")["decisions"]
    assert len(traces) == 3 and len({t["context_hash"] for t in traces}) == 3
    advanced = call("POST", f"/api/branches/{bid}/advance", {
        "user_id": user, "request_id": uuid4().hex, "version": turn2["world"]["version"], "confirmed": True})
    assert advanced["world"]["scene"]["chapter"] == 2
    report.update({"success": True, "branch_id": bid, "character_id": actor})
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print("PASS real biography -> branches -> chat/image without world tick -> 3 action agents -> chapter", flush=True)


if __name__ == "__main__":
    main()
