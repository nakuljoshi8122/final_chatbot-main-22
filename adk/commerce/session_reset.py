"""Reset per-session state for 'I'm back' style returns."""

from __future__ import annotations


def reset_shopassist_session(session_id: str, conversation_history: dict) -> None:
    """Clear all server-side memory for this session id."""
    if not session_id:
        return

    # Clear chat memory (Postgres + in-process cache)
    try:
        conversation_history.invalidate(session_id)  # type: ignore[attr-defined]
    except Exception:
        pass
    try:
        from persistence.session_store import delete_session
    except ImportError:
        from persistence.session_store import delete_session
    try:
        delete_session(session_id)
    except Exception:
        pass

    # Clear browse + shown tiles state
    try:
        from commerce import tile_validator
    except ImportError:
        import commerce.tile_validator as tile_validator  # type: ignore

    for m in (
        "session_shown_products",
        "session_last_browse_query",
        "session_browse_category",
    ):
        d = getattr(tile_validator, m, None)
        if isinstance(d, dict):
            d.pop(session_id, None)

    # Clear hard filters
    try:
        from commerce import browse_filters
    except ImportError:
        import commerce.browse_filters as browse_filters  # type: ignore
    d = getattr(browse_filters, "session_active_filters", None)
    if isinstance(d, dict):
        d.pop(session_id, None)

    # Clear pronoun / tile order memory
    try:
        from commerce import conversation_context
    except ImportError:
        import commerce.conversation_context as conversation_context  # type: ignore
    for m in (
        "session_last_shown_tiles",
        "session_previous_use_case",
        "session_current_use_case",
        "session_previous_browse_query",
    ):
        d = getattr(conversation_context, m, None)
        if isinstance(d, dict):
            d.pop(session_id, None)

    # Clear commerce + cart memory
    try:
        from commerce import session_commerce
    except ImportError:
        import commerce.session_commerce as session_commerce  # type: ignore
    for m in (
        "session_active_product",
        "session_recent_products",
        "session_cart",
    ):
        d = getattr(session_commerce, m, None)
        if isinstance(d, dict):
            d.pop(session_id, None)

    # Clear upsell session flags
    try:
        from commerce import upsell_policy
    except ImportError:
        import commerce.upsell_policy as upsell_policy  # type: ignore
    for m in ("session_upsell_blocked", "session_last_was_upsell"):
        d = getattr(upsell_policy, m, None)
        if isinstance(d, dict):
            d.pop(session_id, None)
