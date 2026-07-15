from fastapi import FastAPI, File, UploadFile, Form
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env", override=True)

# Switch agents via adk/.env — no code edits needed:
#   AGENT_MODE=makeup   → bridal / makeup assistant (default)
#   AGENT_MODE=adidas   → Adidas marketplace
#   AGENT_USE_TOOLS=true → tool-calling agent (search + similar items)
AGENT_MODE = os.getenv("AGENT_MODE", "makeup").lower()
AGENT_USE_TOOLS = os.getenv("AGENT_USE_TOOLS", "false").lower() in ("1", "true", "yes")

if AGENT_MODE == "adidas":
    try:
        if AGENT_USE_TOOLS:
            from .adidas_agent import runner, session_service
        else:
            from .adidas_static_agent import runner, session_service
    except ImportError:
        if AGENT_USE_TOOLS:
            from adidas_agent import runner, session_service
        else:
            from adidas_static_agent import runner, session_service
    APP_NAME = "adidas_marketplace_app"
    SERVICE_LABEL = "adidas_marketplace_chatbot"
else:
    try:
        from .static_agent import runner, session_service
    except ImportError:
        from static_agent import runner, session_service
    APP_NAME = "makeup_artist_app"
    SERVICE_LABEL = "makeup_artist_chatbot"

try:
    from .whisper_utils import speech_to_text_whisper, text_to_speech_whisper, is_openai_configured
    from .llm_config import get_llm_provider
except ImportError:
    from whisper_utils import speech_to_text_whisper, text_to_speech_whisper, is_openai_configured
    from llm_config import get_llm_provider
from google.genai import types
import asyncio
import logging
import io
import base64
import tempfile
import re
from typing import Optional

try:
    from .product_matcher import get_product_by_id
    from .tile_validator import sanitize_adidas_response, strip_agent_markup, normalize_agent_markup
    from .session_commerce import (
        handle_commerce_query,
        set_active_product,
        update_session_from_response,
    )
    from .upsell_policy import on_user_turn, apply_upsell_policy
    from .prior_items import try_describe_prior_items_response, prior_items_context_hint
    from .best_recommendation import (
        try_best_recommendation_response,
        best_recommendation_context_hint,
    )
    from .conversation_context import (
        try_referenced_product_response,
        conversation_context_hint,
    )
    from .browse_filters import filters_context_hint
    from .session_reset import reset_adidas_session
    from .combo_handlers import try_show_and_describe_response
    from .comparison_handlers import try_comparison_response
    from .tile_validator import try_fast_browse_response
except ImportError:
    from product_matcher import get_product_by_id
    from tile_validator import sanitize_adidas_response, strip_agent_markup, normalize_agent_markup
    from session_commerce import (
        handle_commerce_query,
        set_active_product,
        update_session_from_response,
    )
    from upsell_policy import on_user_turn, apply_upsell_policy
    from prior_items import try_describe_prior_items_response, prior_items_context_hint
    from best_recommendation import (
        try_best_recommendation_response,
        best_recommendation_context_hint,
    )
    from conversation_context import (
        try_referenced_product_response,
        conversation_context_hint,
    )
    from browse_filters import filters_context_hint
    from session_reset import reset_adidas_session
    from combo_handlers import try_show_and_describe_response
    from comparison_handlers import try_comparison_response
    from tile_validator import try_fast_browse_response

try:
    from .session_commerce import session_active_product
    from .session_store import SessionHistory, hydrate_session_state, append_message, load_messages
except ImportError:
    from session_commerce import session_active_product
    from session_store import SessionHistory, hydrate_session_state, append_message, load_messages

# MongoDB-backed conversation memory (survives server restarts)
conversation_history = SessionHistory()

RETURNING_RE = re.compile(
    r"\b(i'?m\s+back|im\s+back|hey\s+again|hello\s+again|back\s+again|we'?re\s+back)\b",
    re.IGNORECASE,
)


def _inject_adidas_query_context(
    session_id: str,
    query: str,
    conversation_history: dict,
) -> str:
    """Mode hints + anti-repeat list for the agent."""
    try:
        from .product_matcher import needs_full_information, get_discussed_product_names
    except ImportError:
        from product_matcher import needs_full_information, get_discussed_product_names

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
        from .tile_validator import session_last_browse_query
    except ImportError:
        from tile_validator import session_last_browse_query

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
    if AGENT_MODE != "adidas":
        return query
    return _inject_adidas_query_context(session_id, query, conversation_history)


def get_conversation_context(session_id: str, max_messages: int = 20) -> str:
    """Legacy text context — prefer build_llm_history_block for the LLM path."""
    try:
        from .session_store import build_llm_history_block
    except ImportError:
        from session_store import build_llm_history_block
    return build_llm_history_block(session_id, "").replace("\n\nUser: ", "").rstrip()


def add_to_conversation(session_id: str, role: str, content: str):
    """Append a turn to MongoDB-backed session memory."""
    if not session_id or not content:
        return
    msgs = append_message(session_id, role, content)
    conversation_history._cache[session_id] = msgs  # type: ignore[attr-defined]


# Suppress the specific warning about non-text parts
logging.getLogger("google.adk").setLevel(logging.ERROR)
logger = logging.getLogger(__name__)

app = FastAPI()

_PRODUCT_IMAGES_DIR = Path(__file__).resolve().parent / "static" / "products"
_PRODUCT_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/product-images", StaticFiles(directory=_PRODUCT_IMAGES_DIR), name="product-images")

@app.get("/products/{product_id}")
async def get_product(product_id: str):
    """Return a single product card for the mobile product detail screen."""
    product = get_product_by_id(product_id)
    if not product:
        return {"error": "Product not found"}
    return product


@app.get("/health")
async def health_check():
    """Health check endpoint for monitoring."""
    provider = get_llm_provider()
    api_configured = bool(
        os.getenv("OPENAI_API_KEY") if provider == "openai" else os.getenv("GOOGLE_API_KEY")
    )
    return {
        "status": "healthy",
        "service": SERVICE_LABEL,
        "agent_mode": AGENT_MODE,
        "agent_use_tools": AGENT_USE_TOOLS,
        "llm_provider": provider,
        "api_configured": api_configured,
        "openai_model": os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
        "whisper_configured": is_openai_configured(),
        "timestamp": "2025-01-07T08:30:00Z"
    }

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

class UserQuery(BaseModel):
    query: str
    session_id: str = None

class VoiceQuery(BaseModel):
    session_id: str = None
    return_audio: bool = False

class ActiveProductBody(BaseModel):
    session_id: str
    product_id: str

@app.post("/session/active-product")
async def mark_active_product(body: ActiveProductBody):
    """Track which product the user tapped — used for 'buy it' / 'add that' references."""
    hydrate_session_state(body.session_id)
    tile = set_active_product(body.session_id, body.product_id)
    if not tile:
        return {"ok": False, "error": "Product not found"}
    return {"ok": True, "product": tile}


@app.get("/session/{session_id}/history")
async def get_session_history(session_id: str):
    """Return persisted chat turns + cart for session restore."""
    hydrate_session_state(session_id)
    messages = load_messages(session_id)
    cleaned = []
    for msg in messages:
        raw = msg.get("content", "")
        entry: dict = {"role": msg.get("role", ""), "content": raw}
        if msg.get("role") == "assistant":
            entry["display"] = strip_agent_markup(raw)
        if msg.get("ts"):
            entry["ts"] = msg["ts"]
        cleaned.append(entry)
    try:
        from .session_store import load_session
    except ImportError:
        from session_store import load_session
    doc = load_session(session_id)
    return {
        "session_id": session_id,
        "messages": cleaned,
        "cart": doc.get("cart", []),
    }


@app.post("/ask")
async def ask(query: UserQuery):
    try:
        logger.info(f"🤖 [ASK] Received query: '{query.query}' with session_id: {query.session_id}")
        
        # Use provided session_id or create a new one
        import uuid
        session_id = query.session_id or str(uuid.uuid4())
        logger.info(f"🆔 [ASK] Using session_id: {session_id}")
        hydrate_session_state(session_id)

        if AGENT_MODE == "adidas":
            if RETURNING_RE.search(query.query or ""):
                reset_adidas_session(session_id, conversation_history)
                return {
                    "answer": "Welcome back — what you looking for?",
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
                return result

            combo_resp = try_show_and_describe_response(
                query.query, session_id, conversation_history
            )
            if combo_resp:
                add_to_conversation(session_id, "user", query.query)
                add_to_conversation(session_id, "assistant", combo_resp)
                update_session_from_response(session_id, combo_resp)
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
                return {
                    "answer": prior_resp,
                    "session_id": session_id,
                    "tile_meta": {"has_more": False},
                }

        # Build LLM payload with full persisted conversation
        try:
            from .session_store import build_llm_history_block
        except ImportError:
            from session_store import build_llm_history_block

        history_payload = build_llm_history_block(session_id, query.query)
        if history_payload:
            contextual_query = _inject_active_product_context(session_id, history_payload)
        else:
            contextual_query = _inject_active_product_context(session_id, query.query)

        logger.info(f"💬 [ASK] History turns loaded for session: {session_id}")
        logger.info(f"🤖 [ASK] Sending contextual query to agent: {contextual_query[:100]}...")
        
        user_message = types.Content(role='user', parts=[types.Part(text=contextual_query)])
        
        # Create session if it doesn't exist, ignore if it already exists
        try:
            await session_service.create_session(user_id="user123", session_id=session_id, app_name=APP_NAME)
        except Exception:
            # Session might already exist, that's okay
            pass
        
        response_text = ""
        logger.info("🔄 [ASK] Starting agent processing...")
        async for event in runner.run_async(user_id="user123", session_id=session_id, new_message=user_message):
            if event.is_final_response() and event.content and event.content.parts:
                response_text = event.content.parts[0].text
                logger.info(f"✅ [ASK] Agent response: '{response_text}'")
                break

        if AGENT_MODE == "adidas":
            response_text, tile_meta = sanitize_adidas_response(
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
        else:
            tile_meta = {}
        
        # Store conversation in our simple history
        add_to_conversation(session_id, "user", query.query)
        add_to_conversation(session_id, "assistant", response_text)
        logger.info(f"💾 [ASK] Stored conversation for session: {session_id}")
        
        logger.info(f"🎯 [ASK] Returning response: '{response_text[:100]}...'")
        result = {"answer": response_text, "session_id": session_id}
        if AGENT_MODE == "adidas":
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
            return {
                "answer": "I'm temporarily unavailable due to API rate limits. Please try again in a minute.",
                "session_id": session_id,
            }
        if "503" in error_text or "UNAVAILABLE" in error_text:
            logger.error("❌ [ASK] API unavailable, returning fallback response")
            return {
                "answer": "I'm experiencing high demand right now. Please try again in a moment.",
                "session_id": session_id,
            }
        logger.error("❌ [ASK] General error, returning fallback response")
        return {
            "answer": "I'm having trouble responding right now. Please try again or check the Services tab for my information.",
            "session_id": session_id,
        }

@app.post("/ask_voice")
async def ask_voice(
    audio_file: UploadFile = File(...),
    session_id: Optional[str] = Form(None),
    return_audio: bool = Form(False)
):
    """
    Handle voice input and optionally return audio response.
    
    Args:
        audio_file: Audio file (WAV, MP3, etc.)
        session_id: Optional session ID for conversation continuity
        return_audio: If True, returns audio response; if False, returns text
    """
    try:
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
                    transcribed_text = "Hello, I'd like to know about your makeup services"
            else:
                logger.warning("OpenAI API key not configured. Using fallback transcription.")
                transcribed_text = "Hello, I'd like to know about your makeup services"
            
            # Use provided session_id or create a new one
            import uuid
            session_id = session_id or str(uuid.uuid4())
            logger.info(f"🆔 [VOICE] Using session_id: {session_id}")
            hydrate_session_state(session_id)

            if AGENT_MODE == "adidas":
                if RETURNING_RE.search(transcribed_text or ""):
                    reset_adidas_session(session_id, conversation_history)
                    result = {
                        "answer": "Welcome back — what you looking for?",
                        "session_id": session_id,
                        "transcribed_text": transcribed_text,
                        "tile_meta": {"has_more": False},
                    }
                    if return_audio and is_openai_configured():
                        result["audio_response"] = text_to_speech_whisper(
                            "Welcome back — what you looking for?", voice="alloy"
                        )
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
                    return result
            
            try:
                from .session_store import build_llm_history_block
            except ImportError:
                from session_store import build_llm_history_block

            history_payload = build_llm_history_block(session_id, transcribed_text)
            if history_payload:
                contextual_query = _inject_active_product_context(session_id, history_payload)
            else:
                contextual_query = _inject_active_product_context(session_id, transcribed_text)

            logger.info(f"💬 [VOICE] History turns loaded for session: {session_id}")
            logger.info(f"🎤 [VOICE] Sending contextual query to agent: {contextual_query[:100]}...")
            
            user_message = types.Content(role='user', parts=[types.Part(text=contextual_query)])
            
            # Create session if it doesn't exist
            try:
                await session_service.create_session(user_id="user123", session_id=session_id, app_name=APP_NAME)
            except Exception:
                pass
            
            response_text = ""
            async for event in runner.run_async(user_id="user123", session_id=session_id, new_message=user_message):
                if event.is_final_response() and event.content and event.content.parts:
                    response_text = event.content.parts[0].text
                    break

            if AGENT_MODE == "adidas":
                response_text, tile_meta = sanitize_adidas_response(
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
            
            logger.info(f"Returning response - answer: {response_text[:100]}..., transcribed: {transcribed_text[:50]}...")
            result = {
                "answer": response_text,
                "session_id": session_id,
                "transcribed_text": transcribed_text,
                "audio_response": audio_response,
            }
            if AGENT_MODE == "adidas":
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
