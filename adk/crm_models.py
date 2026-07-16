"""CRM data models + async Postgres helpers (Milestone 2).

Uses the same DATABASE_URL (postgresql+asyncpg://) as ADK DatabaseSessionService.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

load_dotenv(Path(__file__).resolve().parent / ".env")


def _require_database_url() -> str:
    db_url = os.getenv("DATABASE_URL", "").strip()
    if not db_url:
        raise RuntimeError(
            "DATABASE_URL is not set. Copy adk/.env.example and set "
            "DATABASE_URL=postgresql+asyncpg://..."
        )
    return db_url


class Base(DeclarativeBase):
    pass


class Contact(Base):
    __tablename__ = "contacts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    lead_status: Mapped[str] = mapped_column(String(64), nullable=False, default="new")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    interactions: Mapped[list["Interaction"]] = relationship(
        "Interaction", back_populates="contact", cascade="all, delete-orphan"
    )
    deals: Mapped[list["Deal"]] = relationship(
        "Deal", back_populates="contact", cascade="all, delete-orphan"
    )
    notes: Mapped[list["Note"]] = relationship(
        "Note", back_populates="contact", cascade="all, delete-orphan"
    )


class Interaction(Base):
    __tablename__ = "interactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    contact_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("contacts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    direction: Mapped[str] = mapped_column(String(16), nullable=False)  # inbound | outbound
    content: Mapped[str] = mapped_column(Text, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    contact: Mapped[Contact] = relationship("Contact", back_populates="interactions")


class Deal(Base):
    __tablename__ = "deals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    contact_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("contacts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="open")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    contact: Mapped[Contact] = relationship("Contact", back_populates="deals")


class Note(Base):
    __tablename__ = "notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    contact_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("contacts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    contact: Mapped[Contact] = relationship("Contact", back_populates="notes")


_engine = create_async_engine(_require_database_url(), pool_pre_ping=True)
AsyncSessionLocal = async_sessionmaker(bind=_engine, expire_on_commit=False, class_=AsyncSession)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


async def init_crm_schema() -> None:
    """Create CRM tables if they do not exist (called on FastAPI startup)."""
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_or_create_contact(session_id: str) -> Contact:
    """Return existing Contact for session_id, or create a new lead."""
    if not session_id:
        raise ValueError("session_id is required for CRM contact")

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Contact).where(Contact.session_id == session_id))
        contact = result.scalar_one_or_none()
        if contact is not None:
            return contact

        contact = Contact(
            session_id=session_id,
            lead_status="new",
            created_at=_utcnow(),
            updated_at=_utcnow(),
        )
        db.add(contact)
        await db.commit()
        await db.refresh(contact)
        return contact


async def log_interaction(session_id: str, direction: str, content: str) -> None:
    """Append an inbound/outbound Interaction for the contact identified by session_id."""
    if not session_id or not content:
        return
    if direction not in ("inbound", "outbound"):
        raise ValueError(f"Invalid interaction direction: {direction}")

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Contact).where(Contact.session_id == session_id))
        contact = result.scalar_one_or_none()
        if contact is None:
            contact = Contact(
                session_id=session_id,
                lead_status="new",
                created_at=_utcnow(),
                updated_at=_utcnow(),
            )
            db.add(contact)
            await db.flush()

        contact.updated_at = _utcnow()
        db.add(
            Interaction(
                contact_id=contact.id,
                direction=direction,
                content=content,
                timestamp=_utcnow(),
            )
        )
        await db.commit()


async def log_crm_turn(session_id: str, inbound: str, outbound: str) -> None:
    """Ensure Contact exists, then log inbound + outbound interactions."""
    if not session_id:
        return
    await get_or_create_contact(session_id)
    if inbound:
        await log_interaction(session_id, "inbound", inbound)
    if outbound:
        await log_interaction(session_id, "outbound", outbound)
