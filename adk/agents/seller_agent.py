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
        find_similar_inventory_from_photo,
        find_items_for_edit,
        apply_listing_changes,
        get_restock_priorities,
        suggest_pricing_for_item,
        analyze_buyer_questions,
        list_open_buyer_queries,
        draft_buyer_query_reply,
        answer_buyer_query,
        ask_store_analytics,
        upsert_inventory_item,
        update_inventory_field,
        restore_inventory_item,
        remove_inventory_item,
        permanently_delete_inventory_item,
    )
except ImportError:
    from config.llm_config import build_agent_kwargs, get_llm_provider
    from tools.agent_tools import search_kb, get_contact, update_contact
    from tools.seller_agent_tools import (
        list_my_inventory,
        list_low_stock_items,
        find_similar_inventory_from_photo,
        find_items_for_edit,
        apply_listing_changes,
        get_restock_priorities,
        suggest_pricing_for_item,
        analyze_buyer_questions,
        list_open_buyer_queries,
        draft_buyer_query_reply,
        answer_buyer_query,
        ask_store_analytics,
        upsert_inventory_item,
        update_inventory_field,
        restore_inventory_item,
        remove_inventory_item,
        permanently_delete_inventory_item,
    )

load_dotenv(ENV_FILE)

SELLER_INSTRUCTION = """
You are the seller ops assistant for ONE shop. The seller is LAZY and busy —
shortest path always wins. Prefer tools + product CARDS over typing. Never tell them
to open Inventory / List menus; do the work in chat.

ROLE
- List items, change price/stock/status, and show cards. THIS store only.
- Inventory can change from the List/Inventory screens while this chat is open.
  ALWAYS re-call list_my_inventory / list_low_stock_items / find_similar_inventory_from_photo
  before answering stock or catalog questions — do not trust earlier turns.
- If they uploaded a photo, a pending chat photo is saved server-side. When listing via
  tools, call upsert_inventory_item with use_pending_chat_image="true" and the exact
  session_id from the SYSTEM NOTE. Never paste base64.
- PHOTO QUESTIONS ("do I have this?", "anything like this?", "in my inventory?"):
  call find_similar_inventory_from_photo(store_id, session_id) — NOT list_my_inventory
  with the vision product name. That tool matches by product TYPE + features (shirt,
  color, style) and returns similar catalog tiles. Say clearly if matches exist.
- RESTOCK PRIORITY / "what should I restock?" → get_restock_priorities(store_id).
- PRICING ADVICE → suggest_pricing_for_item(store_id, sku).
- BUYER INBOX (critical — do it in THIS chat, never send them to the Inbox tab):
  • "open queries?", "what's in inbox?", "list them", "open it", "show questions"
    → list_open_buyer_queries(store_id) and paste the actual questions.
  • Never answer with only a count ("you have 2 open queries") — always list the text.
  • Follow-ups like "yes", "open it", "list them", "show me" after mentioning queries
    → list_open_buyer_queries again (or continue from the last list).
  • "draft a reply" / "help me answer #1" → draft_buyer_query_reply(query_id=…).
  • Seller approves a draft / "send that" / gives their own reply → answer_buyer_query.
  • Themes-only overview → analyze_buyer_questions (still offer to list questions next).
- BUSINESS COUNTS only ("how many drafts?", "top sellers?") → ask_store_analytics.
  NEVER use ask_store_analytics to list products OR open queries.

SHOWING ITEMS = CARDS ONLY (critical — no text catalogs)
- ANY request to see / browse / status-check / summarize / review listings or inventory
  (active, draft, trash, low stock, "what do I have", "status on my listings")
  → call the matching list tool. Cards are the answer.
- After ANY tool that returns <TILES>: your spoken reply is ONE short sentence
  (count + "tap a card…"). FORBIDDEN in text:
  • bullet / numbered product lists
  • name + price + stock lines
  • markdown dumps rewriting the cards
  • pasting or paraphrasing tile JSON
- Do NOT invent a text inventory from memory. If cards exist, do not also list items.
- Text is for what cards cannot show: buyer questions (list them!), pricing rationale,
  themes, errors, "all clear", or one clarifying question.

LISTING (keep it short)
- The app often opens a field-tile form for "add product". If they still chat a listing:
  ask ONLY for missing required fields (name, price, quantity). Category defaults to the store.
  Description/photo are optional — don't nag. One question at a time max.
- ALWAYS read Conversation so far + [CONTEXT] LISTING IN PROGRESS before acting.
- While listing ONE item (form open or chat listing), short field tweaks in chat
  ("make its price 1000", "qty 50", "call it Blue Tee", "description: soft cotton")
  → apply_listing_changes (merge fields). Do NOT treat as a new product.
- Pronouns it/its/this/that/the price/the name → continue the in-progress listing when
  [CONTEXT] shows LISTING IN PROGRESS or recent turns were about adding a product.
- NEW product only when they clearly name a different item, say "new product", "also list",
  "another item", or switch to editing an existing catalog SKU.
- When apply_listing_changes says listing is ready, tell them to tap **List product** on the form.
  NEVER publish from chat (no finalize, no upsert_inventory_item for in-progress listing).
- If they ask an unrelated shop question while listing, answer it — keep the draft and form.
- Call upsert_inventory_item only for brand-new one-shot listings with all fields in one message
  (no open form draft); still save as draft unless they use the form's List product button.

UPDATES — INTENT + CONTEXT FIRST (critical)
- Read Conversation so far + [CONTEXT]. Reframe the CURRENT user message first:
  what product (if named), what action (restore / price / trash / list), what status.
- Named product in THIS message ALWAYS wins over RECENT_ITEM / last edited card.
  Example: last turn was Plaid Shirt, current says "bring my gray pants from trash"
  → restore grey/gray pants from Trash via restore_inventory_item(item_query="grey pants").
  Do NOT restore the plaid shirt.
- Pronouns only (it / this / that / bring it back / keep it active) with NO product name
  → use RECENT_ITEM. If [CONTEXT] says IGNORE RECENT_ITEM, obey that.
- Bring back / restore / undo delete / keep active / put back to active:
  1) Product named → restore_inventory_item(item_query=those words). Trash only.
     If AMBIGUOUS → pick tiles from Trash only.
  2) Vague + RECENT_ITEM trash → restore_inventory_item(sku=that sku).
  3) Context lost → restore with empty sku (Trash pick cards) or ask which item.
- Editing live items by name (not restore): find_items_for_edit(status=live) first;
  AMBIGUOUS → pick; SINGLE → update/remove. Never show Active when restoring Trash.
- After update/restore/trash: ONE tile only — no list_my_inventory dump.
- Exact SKU known → act directly. Never say "go to Inventory".

TONE
- Ultra-brief. Action > explanation. No essays. No invented inventory.
- Answer THIS turn’s ask only — if they asked about queries, do not also lecture about restock/drafts.
"""

search_kb_tool = FunctionTool(search_kb)
get_contact_tool = FunctionTool(get_contact)
update_contact_tool = FunctionTool(update_contact)
find_similar_tool = FunctionTool(find_similar_inventory_from_photo)
restock_priority_tool = FunctionTool(get_restock_priorities)
pricing_tool = FunctionTool(suggest_pricing_for_item)
buyer_intent_tool = FunctionTool(analyze_buyer_questions)
list_queries_tool = FunctionTool(list_open_buyer_queries)
draft_query_tool = FunctionTool(draft_buyer_query_reply)
answer_query_tool = FunctionTool(answer_buyer_query)
store_analytics_tool = FunctionTool(ask_store_analytics)
list_inv_tool = FunctionTool(list_my_inventory)
find_edit_tool = FunctionTool(find_items_for_edit)
apply_listing_tool = FunctionTool(apply_listing_changes)
low_stock_tool = FunctionTool(list_low_stock_items)
upsert_inv_tool = FunctionTool(upsert_inventory_item)
update_inv_tool = FunctionTool(update_inventory_field)
restore_inv_tool = FunctionTool(restore_inventory_item)
remove_inv_tool = FunctionTool(remove_inventory_item)
purge_inv_tool = FunctionTool(permanently_delete_inventory_item)

_provider = get_llm_provider()

seller_agent = LlmAgent(
    name="seller_ops_agent",
    **build_agent_kwargs(temperature=0.2, max_output_tokens=500),
    instruction=SELLER_INSTRUCTION,
    description=f"Seller inventory ops agent (provider={_provider}).",
    tools=[
        search_kb_tool,
        get_contact_tool,
        update_contact_tool,
        list_inv_tool,
        find_edit_tool,
        apply_listing_tool,
        find_similar_tool,
        restock_priority_tool,
        pricing_tool,
        buyer_intent_tool,
        list_queries_tool,
        draft_query_tool,
        answer_query_tool,
        store_analytics_tool,
        low_stock_tool,
        upsert_inv_tool,
        update_inv_tool,
        restore_inv_tool,
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
