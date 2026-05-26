from __future__ import annotations

import os
import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = APP_ROOT.parent
TOOL_DIR = REPO_ROOT / "researcher-tool"

sys.path.insert(0, str(TOOL_DIR))


def isolated_env(tmp_path):
    env = os.environ.copy()
    env["ANNA_RESEARCHER_WORKSPACE"] = str(tmp_path)
    env["ANNA_RESEARCHER_FAKE_TAVILY"] = "1"
    env.pop("TAVILY_API_KEY", None)
    return env

