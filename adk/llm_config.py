"""Shared LLM provider config — switch between OpenAI and Gemini via .env."""

import os
from pathlib import Path
from typing import Any, Optional, Tuple

from dotenv import load_dotenv
from google.genai import types

load_dotenv(Path(__file__).resolve().parent / ".env", override=True)


def get_llm_provider() -> str:
    return os.getenv("LLM_PROVIDER", "openai").lower()


def get_llm_model(
    temperature: float = 0.45,
    max_output_tokens: int = 250,
) -> Tuple[Any, Optional[types.GenerateContentConfig]]:
    """
    Return (model, generate_content_config) for LlmAgent.

    LLM_PROVIDER=openai  → GPT via LiteLLM (default)
    LLM_PROVIDER=gemini  → Google Gemini
    """
    provider = get_llm_provider()

    if provider == "openai":
        if not os.getenv("OPENAI_API_KEY"):
            raise ValueError(
                "OPENAI_API_KEY is required when LLM_PROVIDER=openai. "
                "Set it in adk/.env"
            )
        from google.adk.models.lite_llm import LiteLlm

        model_name = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
        if not model_name.startswith("openai/"):
            model_name = f"openai/{model_name}"

        return (
            LiteLlm(
                model=model_name,
                temperature=temperature,
                max_tokens=max_output_tokens,
            ),
            None,
        )

    if provider == "gemini":
        if not os.getenv("GOOGLE_API_KEY"):
            raise ValueError(
                "GOOGLE_API_KEY is required when LLM_PROVIDER=gemini. "
                "Set it in adk/.env"
            )
        gemini_model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite")
        return (
            gemini_model,
            types.GenerateContentConfig(
                temperature=temperature,
                top_p=0.9,
                top_k=40,
                max_output_tokens=max_output_tokens,
            ),
        )

    raise ValueError(
        f"Unknown LLM_PROVIDER '{provider}'. Use 'openai' or 'gemini'."
    )


def build_agent_kwargs(
    temperature: float = 0.45,
    max_output_tokens: int = 250,
) -> dict:
    """Extra kwargs to pass into LlmAgent(...)."""
    model, gen_config = get_llm_model(
        temperature=temperature,
        max_output_tokens=max_output_tokens,
    )
    kwargs: dict = {"model": model}
    if gen_config is not None:
        kwargs["generate_content_config"] = gen_config
    return kwargs
