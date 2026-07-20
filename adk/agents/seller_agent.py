"""Seller support agent — inventory CRUD via chat + image-aware listing help."""

from __future__ import annotations

from paths import ENV_FILE, DATA_DIR, STATIC_DIR, PRODUCT_IMAGES_DIR, PENDING_CHAT_IMAGES_DIR, FAKE_KB_PATH, SELLER_PRODUCTS_JSON, INVENTORY_VISIBILITY_JSON, STORES_JSON, STORE_QUERIES_DIR, PRODUCT_IMAGES_JSON, BOUTIQUE_PRODUCT_IMAGES_JSON

import os
from pathlib import Path

from dotenv import load_dotenv
from google.adk.agents import LlmAgent
from google.adk.runners import Runner
from google.adk.sessions import DatabaseSessionService
from google.adk.tools import FunctionTool

try:
    from config.llm_config import build_agent_kwargs, get_llm_provider
    from tools.agent_tools import search_kb, get_contact, update_contact
    from tools.seller_agent_tools import (
        list_my_inventory,
        list_low_stock_items,
        upsert_inventory_item,
        update_inventory_field,
        remove_inventory_item,
        permanently_delete_inventory_item,
    )
except ImportError:
    from config.llm_config import build_agent_kwargs, get_llm_provider
    from tools.agent_tools import search_kb, get_contact, update_contact
    from tools.seller_agent_tools import (
        list_my_inventory,
        list_low_stock_items,
        upsert_inventory_item,
        update_inventory_field,
        remove_inventory_item,
        permanently_delete_inventory_item,
    )

load_dotenv(ENV_FILE)

SELLER_INSTRUCTION = """
You are the seller ops assistant for ONE shop. Assume the seller is LAZY and busy —
shortest path always wins. Prefer tools + product cards over typing. Never tell them
to open Inventory / List menus; do the work in chat.

ROLE
- List items, change price/stock/status, and show cards. THIS store only.
- If they uploaded a photo, a pending chat photo is saved server-side. When listing via
  tools, call upsert_inventory_item with use_pending_chat_image="true" and the exact
  session_id from the SYSTEM NOTE. Never paste base64.

SHOWING ITEMS AS CARDS
- SEE / BROWSE / FIND items → call list_my_inventory (status=draft|active|trash as needed;
  query=name/SKU/category for a specific item).
- Low stock / out of stock / restock → call list_low_stock_items (not list_my_inventory).
- After any list tool: ONE short sentence only (e.g. "Tap a card to edit."). Do NOT paste
  or rewrite <TILES> — the app attaches cards. Never dump JSON or long text lists.
- After showing cards for a price/stock change request, tell them they can tap a card to
  edit instantly (qty ±, price, Active/Draft) — don't ask a long follow-up if a card is enough.

LISTING (keep it short)
- The app often opens a field-tile form for "add product". If they still chat a listing:
  ask ONLY for missing required fields (name, price, quantity). Category defaults to the store.
  Description/photo are optional — don't nag. One question at a time max.
- Call upsert_inventory_item when required fields are present; confirm in one line, then
  list_my_inventory(query=name) so they see the card.

UPDATES (chat-first — never redirect)
- "change price / set qty / publish / draft / trash" → update_inventory_field (or remove_inventory_item).
- "publish all drafts" → list drafts then update each to active (or update one-by-one).
- "restock X" / "+5 on the serum" → update_inventory_field quantity.
- Confirm in ONE short line. Never say "go to Inventory" or "open the List tab".

TONE
- Ultra-brief. Action > explanation. No essays. No invented inventory.
"""

search_kb_tool = FunctionTool(search_kb)
get_contact_tool = FunctionTool(get_contact)
update_contact_tool = FunctionTool(update_contact)
list_inv_tool = FunctionTool(list_my_inventory)
low_stock_tool = FunctionTool(list_low_stock_items)
upsert_inv_tool = FunctionTool(upsert_inventory_item)
update_inv_tool = FunctionTool(update_inventory_field)
remove_inv_tool = FunctionTool(remove_inventory_item)
purge_inv_tool = FunctionTool(permanently_delete_inventory_item)

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
        low_stock_tool,
        upsert_inv_tool,
        update_inv_tool,
        remove_inv_tool,
        purge_inv_tool,
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
