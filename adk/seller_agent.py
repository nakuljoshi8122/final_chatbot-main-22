"""Seller support agent — inventory CRUD via chat + image-aware listing help."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from google.adk.agents import LlmAgent
from google.adk.runners import Runner
from google.adk.sessions import DatabaseSessionService
from google.adk.tools import FunctionTool

try:
    from .llm_config import build_agent_kwargs, get_llm_provider
    from .agent_tools import search_kb, get_contact, update_contact
    from .seller_agent_tools import (
        list_my_inventory,
        upsert_inventory_item,
        update_inventory_field,
        remove_inventory_item,
    )
except ImportError:
    from llm_config import build_agent_kwargs, get_llm_provider
    from agent_tools import search_kb, get_contact, update_contact
    from seller_agent_tools import (
        list_my_inventory,
        upsert_inventory_item,
        update_inventory_field,
        remove_inventory_item,
    )

load_dotenv(Path(__file__).resolve().parent / ".env")

SELLER_INSTRUCTION = """
You are the seller operations assistant for ONE shop. Help the owner manage inventory via chat.

ROLE
- Help list new products, update prices/stock/status, and answer catalog questions for THIS store only.
- If the seller uploaded an image, a pending chat photo is already saved server-side.
  When listing, call upsert_inventory_item with use_pending_chat_image="true" and the
  exact session_id from the SYSTEM NOTE. Never paste base64 into tool calls.

LISTING WORKFLOW
1. If they want to add an item, gather: name, price, category (Handicrafts/Apparel/Skincare), quantity.
2. If any required field is missing, ASK follow-up questions — do NOT invent values.
3. Description is optional but helpful. Status defaults to active (or draft if they ask).
4. Call upsert_inventory_item only when required fields are present.
   Always pass session_id and use_pending_chat_image="true" when a photo was uploaded.
5. Confirm what was saved (SKU, price, qty).

UPDATES
- Use list_my_inventory to show current catalog.
- Use update_inventory_field for single-field edits ("change price of X to 40", "set qty to 5").
- Use remove_inventory_item only when they clearly ask to delete.

SEARCH
- Use search_kb to look up products already in this store before editing.

TONE
- Concise, practical, confirm actions. Never invent inventory that was not saved via tools.
"""

search_kb_tool = FunctionTool(search_kb)
get_contact_tool = FunctionTool(get_contact)
update_contact_tool = FunctionTool(update_contact)
list_inv_tool = FunctionTool(list_my_inventory)
upsert_inv_tool = FunctionTool(upsert_inventory_item)
update_inv_tool = FunctionTool(update_inventory_field)
remove_inv_tool = FunctionTool(remove_inventory_item)

_provider = get_llm_provider()

seller_agent = LlmAgent(
    name="seller_ops_agent",
    **build_agent_kwargs(temperature=0.2, max_output_tokens=900),
    instruction=SELLER_INSTRUCTION,
    description=f"Seller inventory ops agent (provider={_provider}).",
    tools=[
        search_kb_tool,
        get_contact_tool,
        update_contact_tool,
        list_inv_tool,
        upsert_inv_tool,
        update_inv_tool,
        remove_inv_tool,
    ],
)

_db_url = os.getenv("DATABASE_URL")
if not _db_url:
    raise RuntimeError("DATABASE_URL is required for DatabaseSessionService")
seller_session_service = DatabaseSessionService(db_url=_db_url)
seller_runner = Runner(
    agent=seller_agent,
    app_name="seller_ops_app",
    session_service=seller_session_service,
)

__all__ = ["seller_agent", "seller_runner", "seller_session_service", "SELLER_INSTRUCTION"]
