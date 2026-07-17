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

# Switch agents via adk/.env — no code edits needed:
#   AGENT_MODE=crm     → multi-store CRM / shop assistant (default; uses static_agent.py)
#   AGENT_MODE=shopassist  → ShopAssist marketplace
AGENT_MODE = os.getenv("AGENT_MODE", "crm").lower()
AGENT_USE_TOOLS = os.getenv("AGENT_USE_TOOLS", "false").lower() in ("1", "true", "yes")

if AGENT_MODE == "shopassist":
    try:
        if AGENT_USE_TOOLS:
            from agents.shopassist_agent import runner, session_service
        else:
            from agents.shopassist_static_agent import runner, session_service
    except ImportError:
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
    from commerce.product_matcher import get_product_by_id
    from commerce.tile_validator import sanitize_shopassist_response, strip_agent_markup, normalize_agent_markup
    from commerce.session_commerce import (
        handle_commerce_query,
        set_active_product,
        update_session_from_response,
    )
    from commerce.upsell_policy import on_user_turn, apply_upsell_policy
    from commerce.prior_items import try_describe_prior_items_response, prior_items_context_hint
    from commerce.best_recommendation import (
        try_best_recommendation_response,
        best_recommendation_context_hint,
    )
    from commerce.conversation_context import (
        try_referenced_product_response,
        conversation_context_hint,
    )
    from commerce.browse_filters import filters_context_hint
    from commerce.session_reset import reset_shopassist_session
    from commerce.combo_handlers import try_show_and_describe_response
    from commerce.comparison_handlers import try_comparison_response
    from commerce.tile_validator import try_fast_browse_response
except ImportError:
    from commerce.product_matcher import get_product_by_id
    from commerce.tile_validator import sanitize_shopassist_response, strip_agent_markup, normalize_agent_markup
    from commerce.session_commerce import (
        handle_commerce_query,
        set_active_product,
        update_session_from_response,
    )
    from commerce.upsell_policy import on_user_turn, apply_upsell_policy
    from commerce.prior_items import try_describe_prior_items_response, prior_items_context_hint
    from commerce.best_recommendation import (
        try_best_recommendation_response,
        best_recommendation_context_hint,
    )
    from commerce.conversation_context import (
        try_referenced_product_response,
        conversation_context_hint,
    )
    from commerce.browse_filters import filters_context_hint
    from commerce.session_reset import reset_shopassist_session
    from commerce.combo_handlers import try_show_and_describe_response
    from commerce.comparison_handlers import try_comparison_response
    from commerce.tile_validator import try_fast_browse_response

try:
    from commerce.session_commerce import session_active_product
    from persistence.session_store import SessionHistory, hydrate_session_state, append_message, load_messages
except ImportError:
    from commerce.session_commerce import session_active_product
    from persistence.session_store import SessionHistory, hydrate_session_state, append_message, load_messages

# Postgres-backed conversation memory (survives server restarts)
conversation_history = SessionHistory()

RETURNING_RE = re.compile(
    r"\b(i'?m\s+back|im\s+back|hey\s+again|hello\s+again|back\s+again|we'?re\s+back)\b",
    re.IGNORECASE,
)


def _inject_shopassist_query_context(
    session_id: str,
    query: str,
    conversation_history: dict,
) -> str:
    """Mode hints + anti-repeat list for the agent."""
    try:
        from commerce.product_matcher import needs_full_information, get_discussed_product_names
    except ImportError:
        from commerce.product_matcher import needs_full_information, get_discussed_product_names

    hints: list[str] = []
    if needs_full_information(query):
        hints.append(
            "[Response mode: FULL INFO — one handoff line, then table or short answer. "
            "Never silent tables/tiles.]"
        )
    else:
        hints.append(
            "[Response mode: SUMMARY — one handoff line before any TILES or TABLE, "
            "then shortest answer. Never dump visuals with zero text above.]"
        )

    discussed = get_discussed_product_names(conversation_history, session_id)
    if discussed:
        hints.append(
            "[Already described — name only, never re-describe: "
            + ", ".join(discussed)
            + "]"
        )

    prior_hint = prior_items_context_hint(conversation_history, session_id)
    if prior_hint:
        hints.append(prior_hint)

    best_hint = best_recommendation_context_hint(query)
    if best_hint:
        hints.append(best_hint)

    try:
        from commerce.tile_validator import session_last_browse_query
    except ImportError:
        from commerce.tile_validator import session_last_browse_query

    ctx_hint = conversation_context_hint(
        session_id,
        query,
        conversation_history,
        session_last_browse=session_last_browse_query,
    )
    if ctx_hint:
        hints.append(ctx_hint)

    filter_hint = filters_context_hint(session_id)
    if filter_hint:
        hints.append(filter_hint)

    active = session_active_product.get(session_id)
    if active:
        hints.append(
            f"[Active product: {active.get('name', '')} — do not ask which item]"
        )

    return "\n".join(hints) + "\n" + query


def _inject_active_product_context(session_id: str, query: str) -> str:
    if AGENT_MODE != "shopassist":
        return query
    return _inject_shopassist_query_context(session_id, query, conversation_history)


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
    note = (
        f"\n\nSYSTEM NOTE: The current user's session_id is `{session_id}`. "
        "Pass this exact value as the session_id argument to get_contact, "
        "update_contact, create_followup, log_shop_request, and escalate_to_human. "
        "Never invent a session_id. Use search_kb for product questions. "
        "When recommending products to buyers, put ONLY a short sentence plus the exact "
        "<TILES>[...]</TILES> block from search_kb. Never use markdown images "
        "(![...](...)) or markdown links ([View Here](...))."
        f"{store_line}{img_line}"
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

from api.routes import core, seller, stores

app.include_router(core.router)
app.include_router(seller.router)
app.include_router(stores.router)

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
        
        # Use provided session_id or create a new one
        import uuid
        session_id = query.session_id or str(uuid.uuid4())
        user_id = session_id  # device/session identity for ADK (POC)
        logger.info(f"🆔 [ASK] Using session_id/user_id: {session_id}")
        hydrate_session_state(session_id)

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

        if AGENT_MODE == "shopassist":
            if RETURNING_RE.search(query.query or ""):
                reset_shopassist_session(session_id, conversation_history)
                answer = "Welcome back — what you looking for?"
                background_tasks.add_task(_crm_log_outbound, session_id, answer)
                return {
                    "answer": answer,
                    "session_id": session_id,
                    "tile_meta": {"has_more": False},
                }

            on_user_turn(session_id, query.query, conversation_history)
            commerce = handle_commerce_query(query.query, session_id, conversation_history)
            if commerce.handled:
                add_to_conversation(session_id, "user", query.query)
                add_to_conversation(session_id, "assistant", commerce.response_text)
                result = {
                    "answer": commerce.response_text,
                    "session_id": session_id,
                    "tile_meta": {"has_more": False},
                }
                if commerce.show_checkout:
                    result["commerce_meta"] = {
                        "show_checkout": True,
                        "checkout_url": commerce.checkout_url,
                    }
                background_tasks.add_task(_crm_log_outbound, session_id, commerce.response_text)
                return result

            combo_resp = try_show_and_describe_response(
                query.query, session_id, conversation_history
            )
            if combo_resp:
                add_to_conversation(session_id, "user", query.query)
                add_to_conversation(session_id, "assistant", combo_resp)
                update_session_from_response(session_id, combo_resp)
                background_tasks.add_task(_crm_log_outbound, session_id, combo_resp)
                return {
                    "answer": combo_resp,
                    "session_id": session_id,
                    "tile_meta": {"has_more": False},
                }

            compare_resp = try_comparison_response(
                query.query, session_id, conversation_history
            )
            if compare_resp:
                add_to_conversation(session_id, "user", query.query)
                add_to_conversation(session_id, "assistant", compare_resp)
                update_session_from_response(session_id, compare_resp)
                background_tasks.add_task(_crm_log_outbound, session_id, compare_resp)
                return {
                    "answer": compare_resp,
                    "session_id": session_id,
                    "tile_meta": {"has_more": False},
                }

            fast = try_fast_browse_response(
                query.query, session_id, conversation_history
            )
            if fast:
                fast_text, fast_meta = fast
                add_to_conversation(session_id, "user", query.query)
                add_to_conversation(session_id, "assistant", fast_text)
                update_session_from_response(session_id, fast_text)
                background_tasks.add_task(_crm_log_outbound, session_id, fast_text)
                return {
                    "answer": fast_text,
                    "session_id": session_id,
                    "tile_meta": fast_meta,
                }

            ref_resp = try_referenced_product_response(
                query.query, session_id, conversation_history
            )
            if ref_resp:
                add_to_conversation(session_id, "user", query.query)
                add_to_conversation(session_id, "assistant", ref_resp)
                update_session_from_response(session_id, ref_resp)
                background_tasks.add_task(_crm_log_outbound, session_id, ref_resp)
                return {
                    "answer": ref_resp,
                    "session_id": session_id,
                    "tile_meta": {"has_more": False},
                }

            best_resp = try_best_recommendation_response(
                query.query, session_id, conversation_history
            )
            if best_resp:
                add_to_conversation(session_id, "user", query.query)
                add_to_conversation(session_id, "assistant", best_resp)
                update_session_from_response(session_id, best_resp)
                background_tasks.add_task(_crm_log_outbound, session_id, best_resp)
                return {
                    "answer": best_resp,
                    "session_id": session_id,
                    "tile_meta": {"has_more": False},
                }

            prior_resp = try_describe_prior_items_response(
                query.query, session_id, conversation_history
            )
            if prior_resp:
                add_to_conversation(session_id, "user", query.query)
                add_to_conversation(session_id, "assistant", prior_resp)
                update_session_from_response(session_id, prior_resp)
                background_tasks.add_task(_crm_log_outbound, session_id, prior_resp)
                return {
                    "answer": prior_resp,
                    "session_id": session_id,
                    "tile_meta": {"has_more": False},
                }

        # Build LLM payload with full persisted conversation
        try:
            from persistence.session_store import build_llm_history_block
        except ImportError:
            from persistence.session_store import build_llm_history_block

        history_payload = build_llm_history_block(session_id, query.query)
        if history_payload:
            contextual_query = _inject_active_product_context(session_id, history_payload)
        else:
            contextual_query = _inject_active_product_context(session_id, query.query)
        if AGENT_MODE != "shopassist":
            image_note = None
            if query.image_base64 and query.role == "seller":
                try:
                    try:
                        from media.chat_image_stash import save_pending_chat_image
                    except ImportError:
                        from media.chat_image_stash import save_pending_chat_image
                    saved = save_pending_chat_image(session_id, query.image_base64)
                    if saved:
                        image_note = (
                            "A product photo was uploaded with this message and saved as a "
                            "pending chat image. When calling upsert_inventory_item, set "
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
        if AGENT_MODE != "shopassist" and (query.role or "").lower() == "seller":
            active_runner = seller_runner
            active_sessions = seller_session_service
            active_app = SELLER_APP_NAME

        user_message = types.Content(role='user', parts=[types.Part(text=contextual_query)])
        
        # Create session if it doesn't exist, ignore if it already exists
        try:
            await active_sessions.create_session(user_id=user_id, session_id=session_id, app_name=active_app)
        except Exception:
            # Session might already exist, that's okay
            pass
        
        response_text = ""
        logger.info("🔄 [ASK] Starting agent processing...")
        async for event in active_runner.run_async(user_id=user_id, session_id=session_id, new_message=user_message):
            if event.is_final_response() and event.content and event.content.parts:
                response_text = event.content.parts[0].text
                logger.info(f"✅ [ASK] Agent response: '{response_text}'")
                # Do not break — early cancel of ADK's async generator leaks OTEL context

        if AGENT_MODE == "shopassist":
            response_text, tile_meta = sanitize_shopassist_response(
                response_text,
                query.query,
                session_id,
                conversation_history,
            )
            response_text = normalize_agent_markup(response_text)
            response_text = apply_upsell_policy(
                response_text, query.query, session_id, conversation_history
            )
            update_session_from_response(session_id, response_text)
        elif (query.role or "").lower() == "seller":
            # Seller ops replies are plain text (no buyer TILES)
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
        if AGENT_MODE == "shopassist":
            result["tile_meta"] = tile_meta
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
            
            # Use provided session_id or create a new one
            import uuid
            session_id = session_id or str(uuid.uuid4())
            user_id = session_id  # device/session identity for ADK (POC)
            logger.info(f"🆔 [VOICE] Using session_id/user_id: {session_id}")
            hydrate_session_state(session_id)

            # CRM writes run after the response so they never share ADK's OTEL context
            background_tasks.add_task(_crm_log_inbound, session_id, transcribed_text)

            if AGENT_MODE == "shopassist":
                if RETURNING_RE.search(transcribed_text or ""):
                    reset_shopassist_session(session_id, conversation_history)
                    answer = "Welcome back — what you looking for?"
                    result = {
                        "answer": answer,
                        "session_id": session_id,
                        "transcribed_text": transcribed_text,
                        "tile_meta": {"has_more": False},
                    }
                    if return_audio and is_openai_configured():
                        result["audio_response"] = text_to_speech_whisper(
                            answer, voice="alloy"
                        )
                    background_tasks.add_task(_crm_log_outbound, session_id, answer)
                    return result

                on_user_turn(session_id, transcribed_text, conversation_history)
                commerce = handle_commerce_query(transcribed_text, session_id, conversation_history)
                if commerce.handled:
                    add_to_conversation(session_id, "user", transcribed_text)
                    add_to_conversation(session_id, "assistant", commerce.response_text)
                    result = {
                        "answer": commerce.response_text,
                        "session_id": session_id,
                        "transcribed_text": transcribed_text,
                        "tile_meta": {"has_more": False},
                    }
                    if commerce.show_checkout:
                        result["commerce_meta"] = {
                            "show_checkout": True,
                            "checkout_url": commerce.checkout_url,
                        }
                    if return_audio and is_openai_configured():
                        result["audio_response"] = text_to_speech_whisper(
                            strip_agent_markup(commerce.response_text), voice="alloy"
                        )
                    background_tasks.add_task(_crm_log_outbound, session_id, commerce.response_text)
                    return result

                combo_resp = try_show_and_describe_response(
                    transcribed_text, session_id, conversation_history
                )
                if combo_resp:
                    add_to_conversation(session_id, "user", transcribed_text)
                    add_to_conversation(session_id, "assistant", combo_resp)
                    update_session_from_response(session_id, combo_resp)
                    result = {
                        "answer": combo_resp,
                        "session_id": session_id,
                        "transcribed_text": transcribed_text,
                        "tile_meta": {"has_more": False},
                    }
                    if return_audio and is_openai_configured():
                        result["audio_response"] = text_to_speech_whisper(
                            strip_agent_markup(combo_resp), voice="alloy"
                        )
                    background_tasks.add_task(_crm_log_outbound, session_id, combo_resp)
                    return result

                compare_resp = try_comparison_response(
                    transcribed_text, session_id, conversation_history
                )
                if compare_resp:
                    add_to_conversation(session_id, "user", transcribed_text)
                    add_to_conversation(session_id, "assistant", compare_resp)
                    update_session_from_response(session_id, compare_resp)
                    result = {
                        "answer": compare_resp,
                        "session_id": session_id,
                        "transcribed_text": transcribed_text,
                        "tile_meta": {"has_more": False},
                    }
                    if return_audio and is_openai_configured():
                        result["audio_response"] = text_to_speech_whisper(
                            strip_agent_markup(compare_resp), voice="alloy"
                        )
                    background_tasks.add_task(_crm_log_outbound, session_id, compare_resp)
                    return result

                fast = try_fast_browse_response(
                    transcribed_text, session_id, conversation_history
                )
                if fast:
                    fast_text, fast_meta = fast
                    add_to_conversation(session_id, "user", transcribed_text)
                    add_to_conversation(session_id, "assistant", fast_text)
                    update_session_from_response(session_id, fast_text)
                    result = {
                        "answer": fast_text,
                        "session_id": session_id,
                        "transcribed_text": transcribed_text,
                        "tile_meta": fast_meta,
                    }
                    if return_audio and is_openai_configured():
                        result["audio_response"] = text_to_speech_whisper(
                            strip_agent_markup(fast_text), voice="alloy"
                        )
                    background_tasks.add_task(_crm_log_outbound, session_id, fast_text)
                    return result

                ref_resp = try_referenced_product_response(
                    transcribed_text, session_id, conversation_history
                )
                if ref_resp:
                    add_to_conversation(session_id, "user", transcribed_text)
                    add_to_conversation(session_id, "assistant", ref_resp)
                    update_session_from_response(session_id, ref_resp)
                    result = {
                        "answer": ref_resp,
                        "session_id": session_id,
                        "transcribed_text": transcribed_text,
                        "tile_meta": {"has_more": False},
                    }
                    if return_audio and is_openai_configured():
                        result["audio_response"] = text_to_speech_whisper(
                            strip_agent_markup(ref_resp), voice="alloy"
                        )
                    background_tasks.add_task(_crm_log_outbound, session_id, ref_resp)
                    return result

                best_resp = try_best_recommendation_response(
                    transcribed_text, session_id, conversation_history
                )
                if best_resp:
                    add_to_conversation(session_id, "user", transcribed_text)
                    add_to_conversation(session_id, "assistant", best_resp)
                    update_session_from_response(session_id, best_resp)
                    result = {
                        "answer": best_resp,
                        "session_id": session_id,
                        "transcribed_text": transcribed_text,
                        "tile_meta": {"has_more": False},
                    }
                    if return_audio and is_openai_configured():
                        result["audio_response"] = text_to_speech_whisper(
                            strip_agent_markup(best_resp), voice="alloy"
                        )
                    background_tasks.add_task(_crm_log_outbound, session_id, best_resp)
                    return result

                prior_resp = try_describe_prior_items_response(
                    transcribed_text, session_id, conversation_history
                )
                if prior_resp:
                    add_to_conversation(session_id, "user", transcribed_text)
                    add_to_conversation(session_id, "assistant", prior_resp)
                    update_session_from_response(session_id, prior_resp)
                    result = {
                        "answer": prior_resp,
                        "session_id": session_id,
                        "transcribed_text": transcribed_text,
                        "tile_meta": {"has_more": False},
                    }
                    if return_audio and is_openai_configured():
                        result["audio_response"] = text_to_speech_whisper(
                            strip_agent_markup(prior_resp), voice="alloy"
                        )
                    background_tasks.add_task(_crm_log_outbound, session_id, prior_resp)
                    return result
            
            try:
                from persistence.session_store import build_llm_history_block
            except ImportError:
                from persistence.session_store import build_llm_history_block

            history_payload = build_llm_history_block(session_id, transcribed_text)
            if history_payload:
                contextual_query = _inject_active_product_context(session_id, history_payload)
            else:
                contextual_query = _inject_active_product_context(session_id, transcribed_text)
            if AGENT_MODE != "shopassist":
                contextual_query = _inject_crm_session_id(session_id, contextual_query, store)

            logger.info(f"💬 [VOICE] History turns loaded for session: {session_id}")
            logger.info(f"🎤 [VOICE] Sending contextual query to agent: {contextual_query[:100]}...")
            
            user_message = types.Content(role='user', parts=[types.Part(text=contextual_query)])
            
            # Create session if it doesn't exist
            try:
                await session_service.create_session(user_id=user_id, session_id=session_id, app_name=APP_NAME)
            except Exception:
                pass
            
            response_text = ""
            async for event in runner.run_async(user_id=user_id, session_id=session_id, new_message=user_message):
                if event.is_final_response() and event.content and event.content.parts:
                    response_text = event.content.parts[0].text
                    # Do not break — early cancel of ADK's async generator leaks OTEL context

            if AGENT_MODE == "shopassist":
                response_text, tile_meta = sanitize_shopassist_response(
                    response_text,
                    transcribed_text,
                    session_id,
                    conversation_history,
                )
                response_text = normalize_agent_markup(response_text)
                response_text = apply_upsell_policy(
                    response_text, transcribed_text, session_id, conversation_history
                )
                update_session_from_response(session_id, response_text)
            else:
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
            if AGENT_MODE == "shopassist":
                result["tile_meta"] = tile_meta
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
