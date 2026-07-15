"""Pre-process user messages — typo fix + structured intent for downstream handlers."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env", override=True)

try:
    from .llm_config import get_llm_provider
except ImportError:
    from llm_config import get_llm_provider

logger = logging.getLogger(__name__)

EXTRACTION_PROMPT = """You are an intent extractor for an Adidas shopping chatbot.
Your job is to clean up user messages and extract structured intent.
Return ONLY valid JSON. No explanation. No markdown. No backticks.

Output exactly this structure:
{
  "intent": one of: browse | gift | filter | factual | cart | comparison | best_pick | off_topic,
  "corrected_input": "typo-fixed, grammatically clean version of the message",
  "recipient": null or one of: father | mother | son | daughter | wife | husband | brother | sister | friend | self,
  "gender": null or one of: male | female | kids,
  "audience": null or one of: men | women | kids,
  "budget_max": null or integer in INR,
  "use_case": null or one of: running | gym | hiking | football | lifestyle | casual | basketball,
  "color": null or color name as string,
  "product_name": null or exact product name if clearly mentioned,
  "is_follow_up": true or false
}

Classification rules:
- Any message with "gift / present / something for / ideas for / pick for / get for / buy for / gimme / gimmie" = intent: gift. NEVER off_topic.
- "for my father / dad / uncle / grandfather / bro / him / he" = recipient: father, gender: male, audience: men
- "for my mother / mom / aunt / wife / sister / her / she" = recipient: mother, gender: female, audience: women
- "for my son / boy / nephew" = gender: male, audience: kids
- "for my daughter / girl / niece" = gender: female, audience: kids
- Casual words like "gimme / gimmie / lemme / wanna / gonna" are shopping intent, NOT off_topic
- Typos to fix: "eomen" = "women", "sheos/shose" = "shoes", "runnig" = "running", "adiddas" = "adidas", "niek" = "nike"
- "what about for women / men / kids" = intent: filter, is_follow_up: true
- "is it good for X / does it support / waterproof / cushioned / arch support" = intent: factual
- "add / I'll take / I want that / gimme that" = intent: cart
- "X vs Y / difference between / compare" = intent: comparison
- "best / recommend / which one should I" = intent: best_pick
- Short follow-ups about items already shown ("describe them", "best for turfs?", "why are they good") → is_follow_up: true, corrected_input: keep the user's wording (fix typos only). Do NOT rewrite into a formal question.
- budget: extract number from "under 10k" = 10000, "below 5000" = 5000, "max 2000" = 2000, "around 8k" = 8000
- is_follow_up: true if the message refines or filters a previous result (color, gender, price on same topic)"""


def _null_str(value: Any) -> str:
    if value is None or value == "":
        return "null"
    if isinstance(value, bool):
        return str(value).lower()
    return str(value)


def build_enriched_query(raw_query: str, intent_data: Optional[dict]) -> str:
    """Build annotated query string for the main agent and downstream handlers."""
    if not intent_data:
        return raw_query

    corrected = str(intent_data.get("corrected_input") or raw_query).strip() or raw_query
    intent = str(intent_data.get("intent") or "browse")
    recipient = intent_data.get("recipient")
    audience = intent_data.get("audience")
    gender = intent_data.get("gender")
    use_case = intent_data.get("use_case")
    budget_max = intent_data.get("budget_max")
    is_follow_up = intent_data.get("is_follow_up", False)

    header = (
        f"[INTENT: {intent} | RECIPIENT: {_null_str(recipient)} | "
        f"AUDIENCE: {_null_str(audience)} | GENDER: {_null_str(gender)} | "
        f"USE CASE: {_null_str(use_case)} | BUDGET: {_null_str(budget_max)} | "
        f"FOLLOW-UP: {str(bool(is_follow_up)).lower()}]"
    )
    return (
        f"{header}\n"
        f"[CLEANED INPUT: {corrected}]\n"
        f"[RAW INPUT: {raw_query}]"
    )


def user_message_from_enriched(enriched: str) -> str:
    """Extract the cleaned user utterance from an enriched query block."""
    if not enriched:
        return ""
    if "[CLEANED INPUT:" not in enriched and "[RAW INPUT:" not in enriched:
        return enriched.strip()
    match = re.search(r"\[CLEANED INPUT:\s*(.+?)\]\s*(?:\n|$)", enriched, re.DOTALL)
    if match:
        return match.group(1).strip()
    match = re.search(r"\[RAW INPUT:\s*(.+?)\]\s*$", enriched, re.DOTALL)
    if match:
        return match.group(1).strip()
    return enriched.strip()


_FOLLOW_UP_HANDLER_RE = re.compile(
    r"\b(them|those|these|that|it|ones|turfs?|turf|describe|why|good|better|best|see it|show me that)\b",
    re.IGNORECASE,
)


def handler_query(raw_query: str, cleaned_query: str) -> str:
    """
    Query text for regex handlers. Short contextual follow-ups keep raw wording
    so intent LLM rewrites don't break prior-item / advisory matchers.
    """
    raw = (raw_query or "").strip()
    cleaned = (cleaned_query or "").strip()
    if not raw:
        return cleaned
    if not cleaned or raw.lower() == cleaned.lower():
        return raw
    if len(raw.split()) <= 14 and _FOLLOW_UP_HANDLER_RE.search(raw):
        return raw
    return cleaned


def _strip_json_fence(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _parse_json(text: str) -> Optional[dict]:
    if not text:
        return None
    cleaned = _strip_json_fence(text)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", cleaned)
        if not match:
            return None
        try:
            data = json.loads(match.group(0))
        except json.JSONDecodeError:
            return None
    if not isinstance(data, dict):
        return None
    return data


def _call_openai_extractor(raw_query: str) -> str:
    from openai import OpenAI

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY not set")

    client = OpenAI(api_key=api_key)
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        temperature=0,
        max_tokens=300,
        messages=[
            {"role": "system", "content": EXTRACTION_PROMPT},
            {"role": "user", "content": raw_query},
        ],
    )
    return (response.choices[0].message.content or "").strip()


def _call_gemini_extractor(raw_query: str) -> str:
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise ValueError("GOOGLE_API_KEY not set")

    try:
        import google.generativeai as genai  # type: ignore

        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.0-flash-lite")
        response = model.generate_content(
            f"{EXTRACTION_PROMPT}\n\nUser message: {raw_query}",
            generation_config={
                "temperature": 0,
                "max_output_tokens": 300,
            },
        )
        return (response.text or "").strip()
    except ImportError:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model="gemini-2.0-flash-lite",
            contents=f"{EXTRACTION_PROMPT}\n\nUser message: {raw_query}",
            config=types.GenerateContentConfig(
                temperature=0,
                max_output_tokens=300,
            ),
        )
        return (response.text or "").strip()


def _call_extractor_llm(raw_query: str) -> str:
    provider = get_llm_provider()
    if provider == "gemini":
        return _call_gemini_extractor(raw_query)
    return _call_openai_extractor(raw_query)


async def extract_intent(raw_query: str) -> Optional[dict]:
    """Call fast LLM to clean message and extract structured intent. Returns None on failure."""
    if not raw_query or not raw_query.strip():
        return None
    try:
        text = await asyncio.to_thread(_call_extractor_llm, raw_query.strip())
        return _parse_json(text)
    except Exception as exc:
        logger.warning("intent extraction failed: %s", exc)
        return None
