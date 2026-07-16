"""CRM tools for the enterprise agent — async Postgres helpers wrapped as ADK FunctionTools.

Docstrings are part of the tool schema the LLM sees; keep them precise.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import selectinload

try:
    from .crm_models import (
        AsyncSessionLocal,
        Contact,
        Note,
        get_or_create_contact,
        _utcnow,
    )
except ImportError:
    from crm_models import (
        AsyncSessionLocal,
        Contact,
        Note,
        get_or_create_contact,
        _utcnow,
    )

ALLOWED_LEAD_STATUSES = frozenset(
    {"new", "qualified", "discovery_booked", "unqualified", "contacted"}
)


async def get_lead_context(session_id: str) -> str:
    """Fetch CRM lead status and recent internal notes for this chat session.

    Call this at the start of a conversation (or when you need a refresher) so you
    know the contact's current lead_status and any prior private notes. Use the
    exact session_id from the SYSTEM NOTE in the user message.

    Args:
        session_id: The device/chat session_id that uniquely identifies the Contact.
            Must match the SYSTEM NOTE value exactly.

    Returns:
        A human-readable summary of lead_status and recent notes, or a short
        message if the contact is new / has no notes yet.
    """
    if not session_id or not str(session_id).strip():
        return "Error: session_id is required."

    session_id = str(session_id).strip()
    contact = await get_or_create_contact(session_id)

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Contact)
            .where(Contact.session_id == session_id)
            .options(selectinload(Contact.notes))
        )
        contact = result.scalar_one_or_none()
        if contact is None:
            return f"No CRM contact found for session_id={session_id}."

        notes = sorted(
            contact.notes or [],
            key=lambda n: n.created_at or datetime.min.replace(tzinfo=timezone.utc),
            reverse=True,
        )[:5]

        lines = [
            f"session_id: {contact.session_id}",
            f"lead_status: {contact.lead_status}",
            f"name: {contact.name or '(not set)'}",
            f"email: {contact.email or '(not set)'}",
            f"phone: {contact.phone or '(not set)'}",
        ]
        if notes:
            lines.append("recent_notes:")
            for n in notes:
                ts = n.created_at.isoformat() if n.created_at else "unknown"
                lines.append(f"- [{ts}] {n.content}")
        else:
            lines.append("recent_notes: (none)")

        return "\n".join(lines)


async def update_lead_status(session_id: str, new_status: str) -> str:
    """Update the Contact lead_status for this chat session.

    Use when buying intent becomes clear. Typical values:
    - "qualified" — high intent / evaluating / wants discovery
    - "discovery_booked" — user agreed to a discovery session
    - "unqualified" — clear non-fit
    - "contacted" — engaged but not yet qualified

    Args:
        session_id: Exact session_id from the SYSTEM NOTE.
        new_status: New lead_status value (e.g. "qualified", "discovery_booked").

    Returns:
        A short confirmation string, or an error if the status is invalid.
    """
    if not session_id or not str(session_id).strip():
        return "Error: session_id is required."
    if not new_status or not str(new_status).strip():
        return "Error: new_status is required."

    session_id = str(session_id).strip()
    new_status = str(new_status).strip().lower().replace(" ", "_")

    if new_status not in ALLOWED_LEAD_STATUSES:
        allowed = ", ".join(sorted(ALLOWED_LEAD_STATUSES))
        return f"Error: invalid status '{new_status}'. Allowed: {allowed}."

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Contact).where(Contact.session_id == session_id))
        contact = result.scalar_one_or_none()
        if contact is None:
            contact = Contact(
                session_id=session_id,
                lead_status=new_status,
                created_at=_utcnow(),
                updated_at=_utcnow(),
            )
            db.add(contact)
        else:
            contact.lead_status = new_status
            contact.updated_at = _utcnow()
        await db.commit()

    return f"Lead status for session_id={session_id} updated to '{new_status}'."


async def add_internal_note(session_id: str, note_content: str) -> str:
    """Save a private internal CRM note about this lead (never shown to the user).

    Use silently whenever the user describes a business pain point, tool stack,
    team size, timeline, budget cue, or other qualification detail. Do not tell
    the user that you are adding a note.

    Args:
        session_id: Exact session_id from the SYSTEM NOTE.
        note_content: Concise factual note (e.g. pain points, tools, headcount).

    Returns:
        A short confirmation string for the model (not for the end user).
    """
    if not session_id or not str(session_id).strip():
        return "Error: session_id is required."
    if not note_content or not str(note_content).strip():
        return "Error: note_content is required."

    session_id = str(session_id).strip()
    note_content = str(note_content).strip()

    contact = await get_or_create_contact(session_id)

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Contact).where(Contact.session_id == session_id))
        contact = result.scalar_one_or_none()
        if contact is None:
            return f"Error: could not resolve contact for session_id={session_id}."

        db.add(
            Note(
                contact_id=contact.id,
                content=note_content,
                created_at=_utcnow(),
            )
        )
        contact.updated_at = _utcnow()
        await db.commit()

    return f"Internal note saved for session_id={session_id}."
