from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class AutomationTask(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)

    title: Mapped[str] = mapped_column(String(255))
    task_description: Mapped[str] = mapped_column(Text)
    task_type: Mapped[str] = mapped_column(String(64), index=True)
    schedule: Mapped[str] = mapped_column(String(32), default="daily")
    status: Mapped[str] = mapped_column(String(32), default="ACTIVE", index=True)
    run_status: Mapped[str] = mapped_column(String(32), default="IDLE")

    structured_instructions: Mapped[dict] = mapped_column(JSON, default=dict)
    notification_channels: Mapped[list] = mapped_column(JSON, default=list)
    notification_target: Mapped[str | None] = mapped_column(String(255), nullable=True)

    run_count: Mapped[int] = mapped_column(Integer, default=0)
    success_count: Mapped[int] = mapped_column(Integer, default=0)
    failure_count: Mapped[int] = mapped_column(Integer, default=0)
    repair_count: Mapped[int] = mapped_column(Integer, default=0)

    last_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_successful_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    user: Mapped["User"] = relationship("User", back_populates="tasks")
    results: Mapped[list["TaskResult"]] = relationship(
        "TaskResult",
        back_populates="task",
        cascade="all, delete-orphan",
        order_by="desc(TaskResult.created_at)",
    )
    logs: Mapped[list["ExecutionLog"]] = relationship(
        "ExecutionLog",
        back_populates="task",
        cascade="all, delete-orphan",
        order_by="desc(ExecutionLog.created_at)",
    )


class TaskResult(Base):
    __tablename__ = "task_results"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    summary: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), default="SUCCESS")
    detected_change: Mapped[bool] = mapped_column(Boolean, default=False)
    execution_time_ms: Mapped[int] = mapped_column(Integer, default=0)
    result_data: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    task: Mapped["AutomationTask"] = relationship("AutomationTask", back_populates="results")


class ExecutionLog(Base):
    __tablename__ = "execution_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(32), index=True)
    message: Mapped[str] = mapped_column(Text)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    task: Mapped["AutomationTask"] = relationship("AutomationTask", back_populates="logs")
