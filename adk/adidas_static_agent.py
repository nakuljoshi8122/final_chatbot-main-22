from google.adk.agents import LlmAgent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
try:
    from .adidas_data import get_marketplace
    from .adidas_system_prompt import ADIDAS_SYSTEM_PROMPT
    from .llm_config import build_agent_kwargs
except ImportError:
    from adidas_data import get_marketplace
    from adidas_system_prompt import ADIDAS_SYSTEM_PROMPT
    from llm_config import build_agent_kwargs
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

try:
    from .adidas_catalog import all_products
    from .product_images import get_product_image
except ImportError:
    from adidas_catalog import all_products
    from product_images import get_product_image


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


marketplace_data = get_marketplace("Adidas")

agent = LlmAgent(
    name="adidas_sales_agent",
    **build_agent_kwargs(temperature=0.4, max_output_tokens=900),
    instruction=f"""{ADIDAS_SYSTEM_PROMPT}

REFERENCE CATALOG — TILES may ONLY use products listed here (exact names, prices & img URLs):
{_catalog_for_agent()}
""",
    description="Sharp Adidas sales agent with inline TILES blocks.",
)

session_service = InMemorySessionService()
runner = Runner(agent=agent, app_name="adidas_marketplace_app", session_service=session_service)

__all__ = ["agent", "runner", "session_service"]
