from paths import ENV_FILE, PRODUCT_IMAGES_DIR, ensure_runtime_dirs
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, UploadFile, Form, BackgroundTasks
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(ENV_FILE, override=True)

# Boutique multi-store CRM / seller-buyer assistants (Postgres-backed sessions)
AGENT_MODE = "crm"
AGENT_USE_TOOLS = os.getenv("AGENT_USE_TOOLS", "false").lower() in ("1", "true", "yes")

try:
    from agents.static_agent import runner, session_service
    from agents.seller_agent import seller_runner, seller_session_service
except ImportError:
    from agents.static_agent import runner, session_service
    from agents.seller_agent import seller_runner, seller_session_service
APP_NAME = "enterprise_crm_app"
SELLER_APP_NAME = "seller_ops_app"
SERVICE_LABEL = "enterprise_crm_assistant"

try:
    from voice.whisper_utils import speech_to_text_whisper, text_to_speech_whisper, is_openai_configured
    from config.llm_config import get_llm_provider
except ImportError:
    from voice.whisper_utils import speech_to_text_whisper, text_to_speech_whisper, is_openai_configured
    from config.llm_config import get_llm_provider
from google.genai import types
import asyncio
import logging
import io
import base64
import tempfile
import re
from typing import Optional

try:
    from commerce.agent_markup import strip_agent_markup
except ImportError:
    from commerce.agent_markup import strip_agent_markup

try:
    from persistence.session_store import SessionHistory, hydrate_session_state, append_message, load_messages
except ImportError:
    from persistence.session_store import SessionHistory, hydrate_session_state, append_message, load_messages

# Postgres-backed conversation memory (survives server restarts)
conversation_history = SessionHistory()


def _inject_active_product_context(
    session_id: str,
    query: str,
    *,
    current_user_text: str = "",
) -> str:
    """Attach seller listing draft + recent item + buyer active-product hints."""
    extra = ""
    try:
        from commerce.seller_listing_context import listing_context_line
    except ImportError:
        from commerce.seller_listing_context import listing_context_line
    line = listing_context_line(session_id)
    if line:
        extra += line
    try:
        from commerce.seller_recent_item import recent_item_context_line
    except ImportError:
        from commerce.seller_recent_item import recent_item_context_line
    # Prefer the raw current message so named products can override RECENT_ITEM
    user_turn = (current_user_text or "").strip()
    if not user_turn:
        # history block ends with "User: …"
        m = re.search(r"\nUser:\s*(.+)$", query or "", re.S)
        user_turn = (m.group(1).strip() if m else query) or ""
    recent = recent_item_context_line(session_id, current_query=user_turn)
    if recent:
        extra += recent
    try:
        from commerce.session_commerce import session_active_product
    except ImportError:
        from commerce.session_commerce import session_active_product
    active = session_active_product.get(session_id)
    if active and active.get("name"):
        # Same override: don't push stale card when they named something else
        try:
            from commerce.seller_recent_item import _query_names_different_product
        except ImportError:
            from commerce.seller_recent_item import _query_names_different_product
        fake_recent = {
            "name": active.get("name"),
            "sku": active.get("sku") or active.get("id"),
        }
        if not _query_names_different_product(user_turn, fake_recent):
            extra += (
                f" ACTIVE PRODUCT (recent card): {active.get('name')} "
                f"(sku={active.get('sku') or active.get('id')}). "
                "Field edits may refer to this item if not listing a new product."
            )
    if not extra:
        return query
    return f"{query.rstrip()}\n\n[CONTEXT]{extra}"


def _store_category_hint(store: str | None, store_id: str | None) -> str:
    """Map store tag / shop record to vision category hint."""
    try:
        try:
            from stores.store_registry import get_store
        except ImportError:
            from stores.store_registry import get_store
        shop = get_store(store_id) if store_id else None
        if shop:
            cat = str(shop.get("category") or "").strip()
            if cat in ("Handicrafts", "Apparel", "Skincare"):
                return cat
        s = (store or "").lower()
        if "skin" in s:
            return "Skincare"
        if "apparel" in s:
            return "Apparel"
    except Exception:
        pass
    return "Handicrafts"


def _inject_crm_session_id(
    session_id: str,
    text: str,
    store: str | None = None,
    *,
    store_id: str | None = None,
    role: str | None = None,
    image_note: str | None = None,
) -> str:
    """Append session + store/role context for tool calls."""
    if not session_id:
        return text
    store_line = ""
    try:
        try:
            from stores.store_scope import normalize_store, store_meta
            from stores.store_registry import get_store
        except ImportError:
            from stores.store_scope import normalize_store, store_meta
            from stores.store_registry import get_store
        shop = get_store(store_id) if store_id else None
        key = normalize_store(store)
        if not key and shop:
            key = normalize_store(str(shop.get("category") or ""))
        meta = store_meta(key) if key else None
        if shop:
            store_line = (
                f" ROLE: `{role or 'buyer'}`. STORE_ID: `{shop['id']}`. "
                f"Shop name: {shop.get('name')}. Category tag: {shop.get('category')}. "
                f"Owner: {shop.get('owner_name')}."
            )
            if role == "seller":
                store_line += (
                    " You are the SELLER assistant for THIS shop only. "
                    "Use inventory tools with this store_id. "
                    "Ask follow-ups for missing listing fields."
                )
            else:
                store_line += (
                    " You are the BUYER assistant for THIS shop only. "
                    "Only recommend products from this shop's catalog. "
                    "If you cannot answer or the item is missing, you MUST call "
                    f"log_shop_request with session_id and store_id=`{shop['id']}`. "
                    "Never claim you noted a request unless that tool succeeded."
                )
        elif meta:
            store_line = (
                f" STORE TAG: `{key}` — ONLY the {meta['label']} category. "
                f"Domains: {', '.join(sorted(meta['domains']))}."
            )
    except Exception:
        pass
    img_line = ""
    if image_note:
        img_line = f" {image_note}"

    # Live inventory fingerprint so the same chat re-queries after catalog edits
    # without requiring New Chat. Old messages stay as-is; only future turns refresh.
    catalog_line = ""
    try:
        from commerce.product_recommendations import inventory_revision
        rev = inventory_revision()
        catalog_line = (
            f" CATALOG_REVISION: `{rev}`. Inventory/catalog may have changed since earlier "
            "turns in this chat. ALWAYS re-call search_kb (buyer) or list_my_inventory / "
            "list_low_stock_items (seller) before answering product/stock questions — "
            "do not reuse stale product lists from prior assistant messages."
        )
    except Exception:
        catalog_line = (
            " ALWAYS re-call search_kb / inventory tools for product questions; "
            "prior turns may be outdated after inventory edits."
        )

    note = (
        f"\n\nSYSTEM NOTE: The current user's session_id is `{session_id}`. "
        "Pass this exact value as the session_id argument to get_contact, "
        "update_contact, create_followup, log_shop_request, and escalate_to_human. "
        "Never invent a session_id. Use search_kb for product questions. "
        "When recommending products to buyers, put ONLY a short sentence plus the exact "
        "<TILES>[...]</TILES> block from search_kb. Never use markdown images "
        "(![...](...)) or markdown links ([View Here](...)). "
        "If search_kb includes association upsells or correlated alternatives, include a "
        "'You can also look at…' sentence and the exact TILES block."
        f"{store_line}{catalog_line}{img_line}"
    )
    return f"{text.rstrip()}{note}"


def get_conversation_context(session_id: str, max_messages: int = 20) -> str:
    """Legacy text context — prefer build_llm_history_block for the LLM path."""
    try:
        from persistence.session_store import build_llm_history_block
    except ImportError:
        from persistence.session_store import build_llm_history_block
    return build_llm_history_block(session_id, "").replace("\n\nUser: ", "").rstrip()


def add_to_conversation(session_id: str, role: str, content: str):
    """Append a turn to Postgres-backed session memory."""
    if not session_id or not content:
        return
    msgs = append_message(session_id, role, content)
    conversation_history._cache[session_id] = msgs  # type: ignore[attr-defined]


# Suppress the specific warning about non-text parts
logging.getLogger("google.adk").setLevel(logging.ERROR)
logger = logging.getLogger(__name__)


async def _crm_log_inbound(session_id: str, text: str) -> None:
    """Upsert Contact + log inbound Interaction (non-fatal on failure)."""
    try:
        try:
            from persistence.crm_models import get_or_create_contact, log_interaction
        except ImportError:
            from persistence.crm_models import get_or_create_contact, log_interaction
        await get_or_create_contact(session_id)
        await log_interaction(session_id, "inbound", text)
    except Exception as e:
        logger.warning(f"CRM inbound log failed for session {session_id}: {e}")


async def _crm_log_outbound(session_id: str, text: str) -> None:
    """Log outbound Interaction (non-fatal on failure)."""
    try:
        try:
            from persistence.crm_models import log_interaction
        except ImportError:
            from persistence.crm_models import log_interaction
        await log_interaction(session_id, "outbound", text)
    except Exception as e:
        logger.warning(f"CRM outbound log failed for session {session_id}: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        try:
            from persistence.crm_models import init_crm_schema
        except ImportError:
            from persistence.crm_models import init_crm_schema
        await init_crm_schema()
        logger.info("CRM schema ready (contacts, interactions, deals, notes)")
    except Exception as e:
        logger.error(f"CRM schema init failed: {e}")
    try:
        try:
            from stores.store_registry import seed_demo_stores_if_empty
        except ImportError:
            from stores.store_registry import seed_demo_stores_if_empty
        seeded = seed_demo_stores_if_empty()
        logger.info("Store registry ready (%s stores)", len(seeded))
    except Exception as e:
        logger.error(f"Store registry init failed: {e}")
    yield


app = FastAPI(lifespan=lifespan)

from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from api.routes import core, seller, stores, cart, seller_ai

app.include_router(core.router)
app.include_router(seller.router)
app.include_router(stores.router)
app.include_router(cart.router)
app.include_router(seller_ai.router)

_PRODUCT_IMAGES_DIR = PRODUCT_IMAGES_DIR
_PRODUCT_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/product-images", StaticFiles(directory=_PRODUCT_IMAGES_DIR), name="product-images")

from api.schemas import ActiveProductBody, UserQuery, VoiceQuery

@app.post("/stt")
async def stt_only(audio_file: UploadFile = File(...)):
    """STT-only endpoint for pseudo-duplex approach."""
    try:
        logger.info(f"🎤 [STT] Received audio file: {audio_file.filename}, size: {audio_file.size}")
        
        if not is_openai_configured():
            logger.error("❌ [STT] OpenAI API not configured")
            return {"error": "OpenAI API not configured", "transcribed_text": ""}
        
        # Save uploaded file temporarily
        logger.info("💾 [STT] Saving audio file temporarily...")
        with tempfile.NamedTemporaryFile(delete=False, suffix=".m4a") as temp_file:
            content = await audio_file.read()
            temp_file.write(content)
            temp_file_path = temp_file.name
            logger.info(f"💾 [STT] Audio saved to: {temp_file_path}, size: {len(content)} bytes")
        
        try:
            # Transcribe using Whisper
            logger.info("🎯 [STT] Starting Whisper transcription...")
            transcribed_text = speech_to_text_whisper(temp_file_path)
            logger.info(f"📝 [STT] Transcription result: '{transcribed_text}'")
            return {"transcribed_text": transcribed_text}
        finally:
            # Clean up temp file
            if os.path.exists(temp_file_path):
                logger.info("🧹 [STT] Cleaning up temp file")
                os.unlink(temp_file_path)
                
    except Exception as e:
        logger.error(f"❌ [STT] Error in STT endpoint: {e}")
        return {"error": str(e), "transcribed_text": ""}


@app.post("/ask")
async def ask(query: UserQuery, background_tasks: BackgroundTasks):
    try:
        logger.info(f"🤖 [ASK] Received query: '{query.query}' with session_id: {query.session_id}")
        
        # External session_id = durable chat history / CRM / client identity.
        # ADK gets a fresh internal session every turn so old tool results and
        # recursively-injected transcripts cannot keep stale inventory answers alive.
        # Visible messages are still loaded via build_llm_history_block(external_id).
        import uuid
        session_id = query.session_id or str(uuid.uuid4())
        agent_session_id = f"turn-{uuid.uuid4().hex}"
        user_id = session_id  # device/session identity for ADK (POC)
        logger.info(
            f"🆔 [ASK] external_session={session_id} agent_session={agent_session_id}"
        )
        hydrate_session_state(session_id)

        if (query.role or "").lower() == "seller" and query.listing_context:
            try:
                from commerce.seller_listing_context import ingest_client_listing_context
            except ImportError:
                from commerce.seller_listing_context import ingest_client_listing_context
            ingest_client_listing_context(session_id, query.listing_context)

        try:
            try:
                from stores.store_scope import set_request_scope
            except ImportError:
                from stores.store_scope import set_request_scope
            set_request_scope(
                store=query.store,
                store_id=query.store_id,
                role=query.role,
                session_id=session_id,
            )
            logger.info(
                "🏪 [ASK] Scope store=%s store_id=%s role=%s",
                query.store,
                query.store_id,
                query.role,
            )
        except Exception as e:
            logger.warning(f"Store scope not set: {e}")

        # CRM writes run after the response so they never share ADK's OTEL context
        background_tasks.add_task(_crm_log_inbound, session_id, query.query)

        # Build LLM payload with full persisted conversation
        try:
            from persistence.session_store import build_llm_history_block
        except ImportError:
            from persistence.session_store import build_llm_history_block

        history_payload = build_llm_history_block(session_id, query.query)
        if history_payload:
            contextual_query = _inject_active_product_context(
                session_id, history_payload, current_user_text=query.query
            )
        else:
            contextual_query = _inject_active_product_context(
                session_id, query.query, current_user_text=query.query
            )
        image_note = None
        if query.image_base64 and query.role == "seller":
            try:
                try:
                    from media.chat_image_stash import save_pending_chat_image
                except ImportError:
                    from media.chat_image_stash import save_pending_chat_image
                saved = save_pending_chat_image(session_id, query.image_base64)
                vision_line = ""
                try:
                    try:
                        from catalog.product_vision_guess import guess_product_from_image
                    except ImportError:
                        from catalog.product_vision_guess import guess_product_from_image
                    hint = _store_category_hint(query.store, query.store_id)
                    vision = guess_product_from_image(
                        query.image_base64, category_hint=hint
                    )
                    if vision.get("ok") and vision.get("name"):
                        ptype = vision.get("product_type") or ""
                        kws = vision.get("search_keywords") or []
                        kw_str = ", ".join(kws[:6]) if kws else ""
                        vision_line = (
                            f' Vision analysis: type="{ptype or "unknown"}"'
                            f' traits=[{kw_str}] title="{vision["name"]}". '
                            "For inventory questions about the photo (do I have this?, "
                            "similar item?, in stock?), call find_similar_inventory_from_photo "
                            f"with session_id — NOT list_my_inventory with the title. "
                            "For listing, use upsert_inventory_item with "
                            "use_pending_chat_image='true'."
                        )
                        try:
                            try:
                                from media.chat_image_stash import save_pending_vision_analysis
                            except ImportError:
                                from media.chat_image_stash import save_pending_vision_analysis
                            save_pending_vision_analysis(session_id, vision)
                        except Exception:
                            pass
                except Exception as ve:
                    logger.warning("Vision analysis for chat image failed: %s", ve)
                if saved:
                    image_note = (
                        "A product photo was uploaded with this message and saved as a "
                        "pending chat image."
                        f"{vision_line} "
                        "When calling upsert_inventory_item, set "
                        "use_pending_chat_image='true' and pass session_id from this SYSTEM NOTE. "
                        "Do NOT paste or invent image_base64."
                    )
                else:
                    image_note = (
                        "Seller tried to upload a photo but it could not be saved. "
                        "Ask them to retry with another image or use the List form."
                    )
            except Exception as e:
                logger.warning("Pending chat image save failed: %s", e)
                image_note = (
                    "Photo upload failed on the server. Ask the seller to retry."
                )
        contextual_query = _inject_crm_session_id(
            session_id,
            contextual_query,
            query.store,
            store_id=query.store_id,
            role=query.role,
            image_note=image_note,
        )

        logger.info(f"💬 [ASK] History turns loaded for session: {session_id}")
        logger.info(f"🤖 [ASK] Sending contextual query to agent: {contextual_query[:100]}...")
        
        # Seller vs buyer agent
        active_runner = runner
        active_sessions = session_service
        active_app = APP_NAME
        if (query.role or "").lower() == "seller":
            active_runner = seller_runner
            active_sessions = seller_session_service
            active_app = SELLER_APP_NAME

        user_message = types.Content(role='user', parts=[types.Part(text=contextual_query)])
        
        # Ephemeral ADK session for this turn only (keeps Postgres chat history on session_id)
        try:
            await active_sessions.create_session(
                user_id=user_id,
                session_id=agent_session_id,
                app_name=active_app,
            )
        except Exception:
            pass
        
        response_text = ""
        captured_tiles_block = ""
        captured_listing_draft: dict | None = None
        logger.info("🔄 [ASK] Starting agent processing...")
        try:
            async for event in active_runner.run_async(
                user_id=user_id,
                session_id=agent_session_id,
                new_message=user_message,
            ):
                # Capture <TILES> emitted by tools (e.g. seller list_my_inventory) so we can
                # re-attach them even if the LLM drops the block from its final text.
                try:
                    fn_responses = event.get_function_responses() or []
                    for fr in fn_responses:
                        resp = getattr(fr, "response", None)
                        if isinstance(resp, dict):
                            resp_text = str(resp.get("result", resp.get("output", resp)))
                        else:
                            resp_text = str(resp or "")
                        m = re.search(r"<TILES>.*?</TILES>", resp_text, re.S)
                        if m:
                            captured_tiles_block = m.group(0)
                        try:
                            from commerce.seller_listing_context import extract_listing_draft
                        except ImportError:
                            from commerce.seller_listing_context import extract_listing_draft
                        _, draft = extract_listing_draft(resp_text)
                        if draft:
                            captured_listing_draft = draft
                except Exception:
                    pass
                if event.is_final_response() and event.content and event.content.parts:
                    response_text = event.content.parts[0].text
                    logger.info(f"✅ [ASK] Agent response: '{response_text}'")
                    # Do not break — early cancel of ADK's async generator leaks OTEL context
        finally:
            # Drop the one-turn ADK session so inventory tool results do not accumulate
            try:
                await active_sessions.delete_session(
                    app_name=active_app,
                    user_id=user_id,
                    session_id=agent_session_id,
                )
            except Exception as del_err:
                logger.debug("ADK turn session cleanup skipped: %s", del_err)

        if captured_tiles_block:
            # The model may echo the tiles itself, but with max_output_tokens it often
            # truncates the JSON (no closing </TILES>). Always strip any model-emitted
            # tiles and append the complete block captured from the tool output.
            cleaned = re.sub(r"<TILES>.*?</TILES>", "", response_text or "", flags=re.S)
            cleaned = re.sub(r"<TILES>.*$", "", cleaned, flags=re.S)  # truncated/unclosed
            cleaned = cleaned.strip()
            response_text = (
                f"{cleaned}\n{captured_tiles_block}" if cleaned else captured_tiles_block
            )

        listing_meta = None
        try:
            from commerce.seller_listing_context import extract_listing_draft
        except ImportError:
            from commerce.seller_listing_context import extract_listing_draft
        response_text, listing_meta = extract_listing_draft(response_text or "")
        if not listing_meta and captured_listing_draft:
            listing_meta = captured_listing_draft

        if (query.role or "").lower() == "seller":
            try:
                from commerce.seller_response import sanitize_seller_response
            except ImportError:
                from commerce.seller_response import sanitize_seller_response
            response_text = sanitize_seller_response(response_text or "")
            tile_meta = {}
        else:
            try:
                from commerce.boutique_response import sanitize_boutique_response
            except ImportError:
                from commerce.boutique_response import sanitize_boutique_response
            response_text = sanitize_boutique_response(
                response_text, query.query, store=query.store
            )
            tile_meta = {}

            # Safety net: if buyer asked something missing / "noted", persist query —
            # but never when the reply already includes product tiles (agent lied / stuttered).
            if (query.role or "").lower() == "buyer" and query.store_id:
                try:
                    try:
                        from stores.store_registry import add_store_query
                    except ImportError:
                        from stores.store_registry import add_store_query
                    low = (response_text or "").lower()
                    has_tiles = "<tiles>" in low
                    noted = (not has_tiles) and any(
                        p in low
                        for p in (
                            "noted your request",
                            "don't currently",
                            "do not currently",
                            "currently do not have",
                            "currently don't have",
                            "couldn't find",
                            "could not find",
                            "not in our catalog",
                            "not in stock",
                            "don't have that",
                            "do not have that",
                            "do not have",
                            "don't have",
                            "owner will follow",
                            "owner to consider",
                            "owner to follow",
                        )
                    )
                    if noted:
                        add_store_query(
                            str(query.store_id),
                            query.query,
                            session_id=session_id,
                            notes="auto: buyer ask safety net",
                        )
                except Exception as e:
                    logger.warning("Buyer query auto-log failed: %s", e)
        
        # Store conversation in our simple history
        add_to_conversation(session_id, "user", query.query)
        add_to_conversation(session_id, "assistant", response_text)
        logger.info(f"💾 [ASK] Stored conversation for session: {session_id}")

        background_tasks.add_task(_crm_log_outbound, session_id, response_text)
        
        logger.info(f"🎯 [ASK] Returning response: '{response_text[:100]}...'")
        result = {"answer": response_text, "session_id": session_id}
        if listing_meta:
            result["listing_meta"] = listing_meta
        return result
    
    except Exception as e:
        logger.error(f"❌ [ASK] Error in /ask endpoint: {e}")
        import uuid
        session_id = query.session_id or str(uuid.uuid4())
        error_text = str(e)
        # Handle Google API errors gracefully
        if "429" in error_text or "RESOURCE_EXHAUSTED" in error_text or "rate_limit" in error_text.lower():
            logger.error("❌ [ASK] API quota/rate limit exceeded")
            answer = "I'm temporarily unavailable due to API rate limits. Please try again in a minute."
            background_tasks.add_task(_crm_log_outbound, session_id, answer)
            return {
                "answer": answer,
                "session_id": session_id,
            }
        if "503" in error_text or "UNAVAILABLE" in error_text:
            logger.error("❌ [ASK] API unavailable, returning fallback response")
            answer = "I'm experiencing high demand right now. Please try again in a moment."
            background_tasks.add_task(_crm_log_outbound, session_id, answer)
            return {
                "answer": answer,
                "session_id": session_id,
            }
        logger.error("❌ [ASK] General error, returning fallback response")
        answer = "I'm having trouble responding right now. Please try again or check the Services tab for my information."
        background_tasks.add_task(_crm_log_outbound, session_id, answer)
        return {
            "answer": answer,
            "session_id": session_id,
        }

@app.post("/ask_voice")
async def ask_voice(
    background_tasks: BackgroundTasks,
    audio_file: UploadFile = File(...),
    session_id: Optional[str] = Form(None),
    return_audio: bool = Form(False),
    store: Optional[str] = Form(None),
):
    """
    Handle voice input and optionally return audio response.
    
    Args:
        audio_file: Audio file (WAV, MP3, etc.)
        session_id: Optional session ID for conversation continuity
        return_audio: If True, returns audio response; if False, returns text
        store: Optional store tag (skincare | handicrafts | apparels)
    """
    try:
        try:
            try:
                from stores.store_scope import set_request_scope
            except ImportError:
                from stores.store_scope import set_request_scope
            set_request_scope(store=store, role="buyer")
        except Exception:
            pass

        # Read the audio file
        audio_content = await audio_file.read()
        
        # Create a temporary file to store the audio
        with tempfile.NamedTemporaryFile(delete=False, suffix=f".{audio_file.filename.split('.')[-1]}") as temp_file:
            temp_file.write(audio_content)
            temp_file_path = temp_file.name
        
        try:
            # Use OpenAI Whisper for speech-to-text
            if is_openai_configured():
                logger.info("Using OpenAI Whisper for transcription")
                transcribed_text = speech_to_text_whisper(temp_file_path)
                
                # If transcription failed, use a fallback
                if not transcribed_text or transcribed_text.startswith("I'm having trouble"):
                    transcribed_text = "Hello, I'd like to know about your products"
            else:
                logger.warning("OpenAI API key not configured. Using fallback transcription.")
                transcribed_text = "Hello, I'd like to know about your products"
            
            # External session for durable history; fresh ADK session per voice turn
            import uuid
            session_id = session_id or str(uuid.uuid4())
            agent_session_id = f"turn-{uuid.uuid4().hex}"
            user_id = session_id  # device/session identity for ADK (POC)
            logger.info(
                f"🆔 [VOICE] external_session={session_id} agent_session={agent_session_id}"
            )
            hydrate_session_state(session_id)

            # CRM writes run after the response so they never share ADK's OTEL context
            background_tasks.add_task(_crm_log_inbound, session_id, transcribed_text)

            try:
                from persistence.session_store import build_llm_history_block
            except ImportError:
                from persistence.session_store import build_llm_history_block

            history_payload = build_llm_history_block(session_id, transcribed_text)
            if history_payload:
                contextual_query = _inject_active_product_context(
                    session_id, history_payload, current_user_text=transcribed_text
                )
            else:
                contextual_query = _inject_active_product_context(
                    session_id, transcribed_text, current_user_text=transcribed_text
                )
            contextual_query = _inject_crm_session_id(session_id, contextual_query, store)

            logger.info(f"💬 [VOICE] History turns loaded for session: {session_id}")
            logger.info(f"🎤 [VOICE] Sending contextual query to agent: {contextual_query[:100]}...")
            
            user_message = types.Content(role='user', parts=[types.Part(text=contextual_query)])
            
            try:
                await session_service.create_session(
                    user_id=user_id,
                    session_id=agent_session_id,
                    app_name=APP_NAME,
                )
            except Exception:
                pass
            
            response_text = ""
            try:
                async for event in runner.run_async(
                    user_id=user_id,
                    session_id=agent_session_id,
                    new_message=user_message,
                ):
                    if event.is_final_response() and event.content and event.content.parts:
                        response_text = event.content.parts[0].text
                        # Do not break — early cancel of ADK's async generator leaks OTEL context
            finally:
                try:
                    await session_service.delete_session(
                        app_name=APP_NAME,
                        user_id=user_id,
                        session_id=agent_session_id,
                    )
                except Exception as del_err:
                    logger.debug("ADK voice turn session cleanup skipped: %s", del_err)

            try:
                from commerce.boutique_response import sanitize_boutique_response
            except ImportError:
                from commerce.boutique_response import sanitize_boutique_response
            response_text = sanitize_boutique_response(response_text, transcribed_text, store=store)
            tile_meta = {}
            
            # Generate audio response using OpenAI TTS
            audio_response = None
            logger.info(f"TTS request - return_audio: {return_audio}, is_openai_configured: {is_openai_configured()}")
            if return_audio and is_openai_configured():
                logger.info("Generating audio response using OpenAI TTS")
                audio_response = text_to_speech_whisper(strip_agent_markup(response_text), voice="alloy")
                
                if audio_response:
                    logger.info(f"Audio response generated successfully - length: {len(audio_response)}")
                else:
                    logger.warning("Failed to generate audio response, returning text only")
                    audio_response = None
            else:
                logger.info(f"Returning text response only - return_audio: {return_audio}, openai_configured: {is_openai_configured()}")
            
            # Store conversation in our simple history
            add_to_conversation(session_id, "user", transcribed_text)
            add_to_conversation(session_id, "assistant", response_text)
            logger.info(f"💾 [VOICE] Stored conversation for session: {session_id}")

            background_tasks.add_task(_crm_log_outbound, session_id, response_text)
            
            logger.info(f"Returning response - answer: {response_text[:100]}..., transcribed: {transcribed_text[:50]}...")
            result = {
                "answer": response_text,
                "session_id": session_id,
                "transcribed_text": transcribed_text,
                "audio_response": audio_response,
            }
            return result
                
        finally:
            # Clean up temporary file
            if os.path.exists(temp_file_path):
                os.unlink(temp_file_path)
    
    except Exception as e:
        import uuid
        error_response = {
            "answer": "I'm having trouble processing your voice input right now. Please try again.",
            "session_id": session_id or str(uuid.uuid4()),
            "error": str(e)
        }
        
        if return_audio:
            error_response["audio_response"] = None
            
        return error_response

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
