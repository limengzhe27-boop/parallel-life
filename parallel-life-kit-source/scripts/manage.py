#!/usr/bin/env python3
"""Start/status/stop this local service only. Stopping preserves all user data."""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
STATE = DATA / "service.json"


def identity(pid):
    result = subprocess.run(["ps", "-p", str(pid), "-o", "lstart=", "-o", "command="],
                            text=True, capture_output=True)
    return result.stdout.strip()


def status():
    if not STATE.exists():
        return None
    state = json.loads(STATE.read_text())
    current = identity(state["pid"])
    return state if current == state["identity"] and str(ROOT / "scripts/serve.py") in current else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["start", "stop", "status"])
    args = parser.parse_args()
    state = status()
    if args.command == "status":
        print(json.dumps({"running": bool(state), "url": state["url"] if state else None}))
        return
    if args.command == "stop":
        if state:
            os.kill(state["pid"], signal.SIGTERM)
            for _ in range(150):
                if not status():
                    break
                time.sleep(.1)
            else:
                raise SystemExit("Service still shutting down; no forced kill issued")
        STATE.unlink(missing_ok=True)
        print("Stopped Parallel Life Kit; original projects and data unchanged")
        return
    if state:
        print("Already running: " + state["url"])
        return
    DATA.mkdir(mode=0o700, exist_ok=True)
    DATA.chmod(0o700)
    log_fd = os.open(DATA / "server.log", os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    with os.fdopen(log_fd, "a") as log:
        proc = subprocess.Popen([str(ROOT / ".venv/bin/python"), str(ROOT / "scripts/serve.py")],
            cwd=ROOT, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
    port = int(os.environ.get("PARALLEL_LIFE_PORT", "8108"))
    url = f"http://127.0.0.1:{port}"
    for _ in range(100):
        if proc.poll() is not None:
            raise SystemExit("Service exited; inspect data/server.log")
        try:
            with urllib.request.urlopen(url + "/api/health", timeout=.5) as response:
                if response.status == 200:
                    time.sleep(.2)  # macOS framework Python argv identity settles after exec
                    state = {"pid": proc.pid, "identity": identity(proc.pid), "url": url}
                    STATE.write_text(json.dumps(state))
                    STATE.chmod(0o600)
                    print("Ready: " + url)
                    return
        except OSError:
            time.sleep(.1)
    proc.terminate()
    raise SystemExit("Startup health check timed out")


if __name__ == "__main__":
    main()
