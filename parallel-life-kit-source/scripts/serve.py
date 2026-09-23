#!/usr/bin/env python3
"""Local-only development launcher; secrets are read here, never sent to the UI."""
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))


def load_env(path=ROOT / ".env"):
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                key, value = line.removeprefix("export ").split("=", 1)
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


if __name__ == "__main__":
    load_env()
    import uvicorn
    uvicorn.run("parallel_life.api:create_app", factory=True, host="127.0.0.1",
                port=int(os.environ.get("PARALLEL_LIFE_PORT", "8108")), access_log=False)
