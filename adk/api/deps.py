"""Shared API dependencies: agent runners, session memory, and mode flags."""

from __future__ import annotations

import os
import re

from dotenv import load_dotenv

from paths import ENV_FILE
from persistence.session_store import SessionHistory

load_dotenv(ENV_FILE, override=True)

AGENT_MODE = os.getenv("AGENT_MODE", "crm").lower()
AGENT_USE_TOOLS = os.getenv("AGENT_USE_TOOLS", "false").lower() in ("1", "true", "yes")

if AGENT_MODE == "shopassist":
    if AGENT_USE_TOOLS:
        from agents.shopassist_agent import runner, session_service
    else:
        from agents.shopassist_static_agent import runner, session_service
    APP_NAME = "shopassist_marketplace_app"
    SELLER_APP_NAME = APP_NAME
    SERVICE_LABEL = "shopassist_marketplace_chatbot"
    seller_runner = runner
    seller_session_service = session_service
else:
    from agents.static_agent import runner, session_service
    from agents.seller_agent import seller_runner, seller_session_service
    APP_NAME = "enterprise_crm_app"
    SELLER_APP_NAME = "seller_ops_app"
    SERVICE_LABEL = "enterprise_crm_assistant"

conversation_history = SessionHistory()

RETURNING_RE = re.compile(
    r"\b(i'?m\s+back|im\s+back|hey\s+again|hello\s+again|back\s+again|we'?re\s+back)\b",
    re.IGNORECASE,
)
