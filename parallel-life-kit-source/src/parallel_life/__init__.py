"""Parallel Life Kit: explicit facts, isolated characters, bounded autonomy."""

__version__ = "0.1.0"

from .config import Settings
from .interaction import Engine
from .life import confirm_profile, generate_branches, interview
from .memory import MemoryEngine
from .providers import OpenAICompatibleProvider, Provider, ProviderError
from .store import Store

__all__ = ["Settings", "Engine", "MemoryEngine", "Store", "Provider",
           "ProviderError", "OpenAICompatibleProvider", "interview",
           "confirm_profile", "generate_branches"]
