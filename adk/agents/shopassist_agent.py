from paths import ENV_FILE, DATA_DIR, STATIC_DIR, PRODUCT_IMAGES_DIR, PENDING_CHAT_IMAGES_DIR, FAKE_KB_PATH, SELLER_PRODUCTS_JSON, INVENTORY_VISIBILITY_JSON, STORES_JSON, STORE_QUERIES_DIR, PRODUCT_IMAGES_JSON, BOUTIQUE_PRODUCT_IMAGES_JSON

from google.adk.tools import FunctionTool
from google.adk.agents import LlmAgent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
try:
    from catalog.shopassist_data import get_marketplace, search_products, get_similar_products, find_products_by_tag_overlap
    from agents.prompts.shopassist_system_prompt import SHOPASSIST_SYSTEM_PROMPT
    from config.llm_config import build_agent_kwargs
except ImportError:
    from catalog.shopassist_data import get_marketplace, search_products, get_similar_products, find_products_by_tag_overlap
    from agents.prompts.shopassist_system_prompt import SHOPASSIST_SYSTEM_PROMPT
    from config.llm_config import build_agent_kwargs
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(ENV_FILE)

marketplace_tool = FunctionTool(get_marketplace)
search_tool = FunctionTool(search_products)
similar_tool = FunctionTool(get_similar_products)
tag_overlap_tool = FunctionTool(find_products_by_tag_overlap)

agent = LlmAgent(
    name="shopassist_sales_agent",
    **build_agent_kwargs(temperature=0.35, max_output_tokens=700),
    instruction=f"""{SHOPASSIST_SYSTEM_PROMPT}

REFERENCE CATALOG — TILES may ONLY use products from here (exact names & prices):
{get_marketplace("ShopAssist")}

TOOLS (tool mode only):
- search_products(query, category, audience, sport)
- get_similar_products(product_id or product_name) for closest real alternatives
- find_products_by_tag_overlap(user_tags, max_results) for tag-based similar picks
""",
    description="Professional ShopAssist Sales Consultant with catalog search and similar-product matching.",
    tools=[marketplace_tool, search_tool, similar_tool, tag_overlap_tool],
)

session_service = InMemorySessionService()
runner = Runner(agent=agent, app_name="shopassist_marketplace_app", session_service=session_service)

__all__ = ["agent", "runner", "session_service"]
