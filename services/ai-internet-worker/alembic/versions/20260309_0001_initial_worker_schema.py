from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260309_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("full_name", sa.String(length=255), nullable=True),
        sa.Column("telegram_chat_id", sa.String(length=64), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "tasks",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("task_description", sa.Text(), nullable=False),
        sa.Column("task_type", sa.String(length=64), nullable=False),
        sa.Column("schedule", sa.String(length=32), nullable=False, server_default="daily"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="ACTIVE"),
        sa.Column("run_status", sa.String(length=32), nullable=False, server_default="IDLE"),
        sa.Column("structured_instructions", sa.JSON(), nullable=False),
        sa.Column("notification_channels", sa.JSON(), nullable=False),
        sa.Column("notification_target", sa.String(length=255), nullable=True),
        sa.Column("run_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("success_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failure_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("repair_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_summary", sa.Text(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_successful_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_tasks_user_id", "tasks", ["user_id"], unique=False)
    op.create_index("ix_tasks_task_type", "tasks", ["task_type"], unique=False)
    op.create_index("ix_tasks_status", "tasks", ["status"], unique=False)
    op.create_index("ix_tasks_next_run_at", "tasks", ["next_run_at"], unique=False)

    op.create_table(
        "task_results",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("task_id", sa.String(length=36), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="SUCCESS"),
        sa.Column("detected_change", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("execution_time_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("result_data", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_task_results_task_id", "task_results", ["task_id"], unique=False)

    op.create_table(
        "execution_logs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("task_id", sa.String(length=36), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_execution_logs_task_id", "execution_logs", ["task_id"], unique=False)
    op.create_index("ix_execution_logs_status", "execution_logs", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_execution_logs_status", table_name="execution_logs")
    op.drop_index("ix_execution_logs_task_id", table_name="execution_logs")
    op.drop_table("execution_logs")

    op.drop_index("ix_task_results_task_id", table_name="task_results")
    op.drop_table("task_results")

    op.drop_index("ix_tasks_next_run_at", table_name="tasks")
    op.drop_index("ix_tasks_status", table_name="tasks")
    op.drop_index("ix_tasks_task_type", table_name="tasks")
    op.drop_index("ix_tasks_user_id", table_name="tasks")
    op.drop_table("tasks")

    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
