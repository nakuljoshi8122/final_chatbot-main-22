"""Strip or normalize agent TILES/TABLE markup — no catalog dependency."""

from __future__ import annotations

import json
import re

TILES_REGEX = re.compile(r"<TILES>([\s\S]*?)</TILES>", re.IGNORECASE)
TILE_SINGULAR_RE = re.compile(r"<TILE>\s*(\{[\s\S]*?\})\s*</TILE>", re.IGNORECASE)
ORPHAN_TILE_JSON_RE = re.compile(
    r"\{[^{}]*\"id\"\s*:\s*\"[^\"]+\"[^{}]*\"name\"\s*:\s*\"[^\"]+\"[^{}]*\}",
    re.IGNORECASE,
)
TABLE_BLOCK_RE = re.compile(r"<TABLE>[\s\S]*?</TABLE>", re.IGNORECASE)
HTML_TABLE_RE = re.compile(r"<table[\s\S]*?</table>", re.IGNORECASE)


def normalize_agent_markup(text: str) -> str:
    """Fix common LLM mistakes: <TILE> singular → <TILES> array."""
    if not text:
        return text

    def _to_tiles_block(match: re.Match) -> str:
        payload = match.group(1).strip()
        if payload.startswith("["):
            return f"<TILES>{payload}</TILES>"
        return f"<TILES>[{payload}]</TILES>"

    return TILE_SINGULAR_RE.sub(_to_tiles_block, text)


def strip_agent_markup(text: str) -> str:
    """Remove TILES/TABLE blocks and stray HTML for visible text or TTS."""
    cleaned = normalize_agent_markup(text)
    for _ in range(5):
        prev = cleaned
        cleaned = TILES_REGEX.sub(" ", cleaned)
        cleaned = TILE_SINGULAR_RE.sub(" ", cleaned)
        cleaned = ORPHAN_TILE_JSON_RE.sub(" ", cleaned)
        cleaned = TABLE_BLOCK_RE.sub(" ", cleaned)
        cleaned = HTML_TABLE_RE.sub(" ", cleaned)
        if cleaned == prev:
            break
    cleaned = re.sub(r"<TILES>[\s\S]*", " ", cleaned, flags=re.IGNORECASE)
    if re.search(r"</TILES>", cleaned, re.IGNORECASE):
        cleaned = re.sub(r"[\s\S]*?</TILES>", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"</?TABLE>", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"</?TILES>", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"</?TILE>", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"</?t(head|body|r|h|d)[^>]*>", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def parse_tile_payload(payload: str) -> list[dict]:
    payload = payload.strip()
    if not payload:
        return []
    try:
        parsed = json.loads(payload)
    except json.JSONDecodeError:
        return []
    if isinstance(parsed, dict):
        return [parsed]
    if isinstance(parsed, list):
        return [entry for entry in parsed if isinstance(entry, dict)]
    return []
