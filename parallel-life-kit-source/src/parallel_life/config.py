"""Server-only configuration. Live providers are required; no silent demo fallback."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(".parallel-life-data"))
    mode: str = "live"
    chat_base_url: str = "https://api.openai.com/v1"
    chat_api_key: str = field(default="", repr=False)
    chat_model: str = ""
    reply_model: str = ""  # Only character dialogue; blank inherits chat_model.
    memory_base_url: str = ""
    memory_api_key: str = field(default="", repr=False)
    memory_model: str = ""
    image_base_url: str = "https://api.openai.com/v1"
    image_api_key: str = field(default="", repr=False)
    image_model: str = ""
    image_cooldown: int = 300
    image_daily_limit: int = 10
    proactive_images: bool = False  # Opt-in; scene-based images incur provider charges.
    dialogue_review: bool = True
    context_chars: int = 24000
    request_timeout: float = 120.0

    def __post_init__(self) -> None:
        if self.mode != "live":
            raise ValueError("Only live mode is supported; inject test providers in tests")
        if self.image_cooldown < 0 or self.image_daily_limit < 0 or self.context_chars < 1000:
            raise ValueError("Invalid image limits or context budget")
        if self.request_timeout <= 0:
            raise ValueError("request_timeout must be positive")

    @classmethod
    def from_env(cls) -> "Settings":
        def get(name: str, default: str = "", alias: str = "") -> str:
            return os.environ.get("PARALLEL_LIFE_" + name, os.environ.get(alias, default))

        proactive_value = get("PROACTIVE_IMAGES", "0").strip().lower()
        if proactive_value not in {"0", "1", "false", "true", "no", "yes", "off", "on"}:
            raise ValueError("PROACTIVE_IMAGES must be a boolean flag")
        chat_url = get("CHAT_BASE_URL", "https://api.openai.com/v1", "ORCHESTRATOR_BASE_URL")
        chat_key = get("CHAT_API_KEY", alias="ORCHESTRATOR_API_KEY")
        chat_model = get("CHAT_MODEL", alias="ORCHESTRATOR_MODEL")
        return cls(
            data_dir=Path(get("DATA_DIR", ".parallel-life-data")).expanduser(),
            mode=get("MODE", "live"),
            chat_base_url=chat_url,
            chat_api_key=chat_key,
            chat_model=chat_model,
            reply_model=get("REPLY_MODEL"),
            memory_base_url=get("MEMORY_BASE_URL", chat_url),
            memory_api_key=get("MEMORY_API_KEY", chat_key),
            memory_model=get("MEMORY_MODEL", chat_model),
            image_base_url=get("IMAGE_BASE_URL", "https://api.openai.com/v1", "IMAGE_GEN_OPENAI_BASE_URL"),
            image_api_key=get("IMAGE_API_KEY", alias="IMAGE_GEN_OPENAI_API_KEY"),
            image_model=get("IMAGE_MODEL", alias="IMAGE_GEN_OPENAI_MODEL"),
            image_cooldown=int(get("IMAGE_COOLDOWN", "300")),
            image_daily_limit=int(get("IMAGE_DAILY_LIMIT", "10")),
            proactive_images=proactive_value in {"1", "true", "yes", "on"},
            dialogue_review=get("DIALOGUE_REVIEW", "1").strip().lower() in {"1", "true", "yes", "on"},
            context_chars=int(get("CONTEXT_CHARS", "24000")),
            request_timeout=float(get("REQUEST_TIMEOUT", "120")),
        )
