#!/usr/bin/env python3
"""Rollback this additive deployment: stop its service; preserve code and all data.

No existing JoyAI/GameGen files were patched, so they need no restoration.
"""
from pathlib import Path
import subprocess
import sys

if __name__ == "__main__":
    result = subprocess.run([sys.executable, str(Path(__file__).with_name("manage.py")), "stop"])
    raise SystemExit(result.returncode)
