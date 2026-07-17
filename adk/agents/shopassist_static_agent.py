from paths import ENV_FILE, DATA_DIR, STATIC_DIR, PRODUCT_IMAGES_DIR, PENDING_CHAT_IMAGES_DIR, FAKE_KB_PATH, SELLER_PRODUCTS_JSON, INVENTORY_VISIBILITY_JSON, STORES_JSON, STORE_QUERIES_DIR, PRODUCT_IMAGES_JSON, BOUTIQUE_PRODUCT_IMAGES_JSON

from google.adk.agents import LlmAgent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
try:
    from catalog.shopassist_data import get_marketplace
    from agents.prompts.shopassist_system_prompt import SHOPASSIST_SYSTEM_PROMPT
    from config.llm_config import build_agent_kwargs
except ImportError:
    from catalog.shopassist_data import get_marketplace
    from agents.prompts.shopassist_system_prompt import SHOPASSIST_SYSTEM_PROMPT
    from config.llm_config import build_agent_kwargs
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(ENV_FILE)

try:
    from catalog.shopassist_catalog import all_products
    from catalog.product_images import get_product_image
except ImportError:
    from catalog.shopassist_catalog import all_products
    from catalog.product_images import get_product_image


def _catalog_for_agent() -> list[dict]:
    """Compact catalog with image URLs from MongoDB."""
    rows = []
    for p in all_products():
        rows.append({
            "id": p["id"],
            "name": p["name"],
            "price": p["price"],
            "category": p.get("category"),
            "sport": p.get("sport", p.get("type")),
            "img": get_product_image(p),
        })
    return rows


marketplace_data = get_marketplace("ShopAssist")

agent = LlmAgent(
    name="shopassist_sales_agent",
    **build_agent_kwargs(temperature=0.4, max_output_tokens=900),
    instruction=f"""{SHOPASSIST_SYSTEM_PROMPT}

REFERENCE CATALOG — TILES may ONLY use products listed here (exact names, prices & img URLs):
{_catalog_for_agent()}
""",
    description="Sharp ShopAssist sales agent with inline TILES blocks.",
)

session_service = InMemorySessionService()
runner = Runner(agent=agent, app_name="shopassist_marketplace_app", session_service=session_service)

__all__ = ["agent", "runner", "session_service"]
