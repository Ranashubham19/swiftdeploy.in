from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from typing import Any

from celery.utils.log import get_task_logger
from sqlalchemy import desc, select

from app.automation.runner import AutomationRunner
from app.core.celery_app import celery_app
from app.db.session import SessionLocal
from app.models.task import AutomationTask, ExecutionLog, TaskResult
from app.models.user import User
from app.services.notifications import send_notifications
from app.services.task_utils import compute_next_run_at, normalize_schedule


logger = get_task_logger(__name__)
NON_PERSISTABLE_REPAIR_PREFIXES = ("button:", "link:", "text:", "label:", "placeholder:", "heading:", "textbox:")


def _append_log(task_id: str, status: str, message: str, details: dict | None = None) -> None:
    with SessionLocal() as db:
        db.add(
            ExecutionLog(
                task_id=task_id,
                status=status,
                message=message,
                details=details or {},
            )
        )
        db.commit()


def _prepend_unique(values: list[str], candidate: str) -> list[str]:
    normalized = candidate.strip()
    if not normalized:
        return values
    existing = [value for value in values if value and value != normalized]
    return [normalized, *existing]


def _is_persistable_selector(selector: str) -> bool:
    normalized = selector.strip()
    if not normalized:
        return False
    return not normalized.startswith(NON_PERSISTABLE_REPAIR_PREFIXES)


def _persist_repair_learning(task: AutomationTask, repair_details: dict[str, Any]) -> dict[str, Any] | None:
    instructions = deepcopy(task.structured_instructions or {})
    metadata = dict(instructions.get("metadata") or {})
    repair_memory = list(metadata.get("repair_memory") or [])
    updated_at = datetime.now(timezone.utc).isoformat()
    learned_any = False

    workflow_repairs = repair_details.get("workflow_repairs")
    if isinstance(workflow_repairs, list) and workflow_repairs:
        steps = list(instructions.get("steps") or [])
        for raw_event in workflow_repairs:
            if not isinstance(raw_event, dict):
                continue
            selector = str(raw_event.get("selector") or "").strip()
            strategy = str(raw_event.get("strategy") or "").strip()
            index = int(raw_event.get("index") or 0)
            label = str(raw_event.get("label") or "").strip()

            repair_memory.append(
                {
                    "timestamp": updated_at,
                    "selector": selector,
                    "strategy": strategy,
                    "step_index": index,
                    "label": label,
                }
            )

            step_index = index - 1
            if 0 <= step_index < len(steps) and _is_persistable_selector(selector):
                step = dict(steps[step_index] or {})
                step["selectors"] = _prepend_unique([str(item) for item in step.get("selectors") or []], selector)
                if not step.get("selector"):
                    step["selector"] = selector
                steps[step_index] = step
                learned_any = True

        instructions["steps"] = steps
    else:
        selector = str(repair_details.get("selector") or "").strip()
        strategy = str(repair_details.get("strategy") or "").strip()
        if selector:
            repair_memory.append(
                {
                    "timestamp": updated_at,
                    "selector": selector,
                    "strategy": strategy,
                }
            )
        if _is_persistable_selector(selector):
            instructions["selectors"] = _prepend_unique(
                [str(item) for item in instructions.get("selectors") or []],
                selector,
            )
            learned_any = True

    if not repair_memory and not learned_any:
        return None

    metadata["repair_memory"] = repair_memory[-20:]
    metadata["last_repair_at"] = updated_at
    instructions["metadata"] = metadata
    task.structured_instructions = instructions

    return {
        "learned": learned_any,
        "memory_entries": len(metadata["repair_memory"]),
        "last_repair_at": updated_at,
    }


@celery_app.task(name="app.workers.tasks.execute_automation_task")
def execute_automation_task(task_id: str, trigger: str = "manual") -> dict:
    _append_log(task_id, "INFO", f"Execution started ({trigger}).")
    runner = AutomationRunner()

    with SessionLocal() as db:
        task = db.get(AutomationTask, task_id)
        if not task:
            logger.warning("Task %s does not exist.", task_id)
            return {"ok": False, "reason": "task_not_found"}

        task.run_status = "RUNNING"
        task.last_error = None
        db.commit()

        previous_result = db.scalar(
            select(TaskResult)
            .where(TaskResult.task_id == task.id, TaskResult.status == "SUCCESS")
            .order_by(desc(TaskResult.created_at))
        )

        try:
            outcome = runner.execute(task, previous_result)
            result = TaskResult(
                task_id=task.id,
                summary=outcome.summary,
                status="SUCCESS",
                detected_change=outcome.detected_change,
                execution_time_ms=outcome.execution_time_ms,
                result_data=outcome.result_data,
            )
            db.add(result)

            task.run_status = "SUCCESS"
            task.run_count += 1
            task.success_count += 1
            task.last_summary = outcome.summary
            task.last_run_at = datetime.now(timezone.utc)
            task.last_successful_run_at = task.last_run_at
            task.next_run_at = compute_next_run_at(normalize_schedule(task.schedule), task.last_run_at)
            learned_repair: dict[str, Any] | None = None
            if outcome.repaired:
                task.repair_count += 1
                learned_repair = _persist_repair_learning(task, outcome.repair_details)

            db.commit()
            db.refresh(result)

            _append_log(task.id, "SUCCESS", outcome.summary, {"detected_change": outcome.detected_change})
            if outcome.repaired:
                _append_log(task.id, "REPAIR", "Automation step was repaired automatically.", outcome.repair_details)
                if learned_repair and learned_repair.get("learned"):
                    _append_log(task.id, "INFO", "Repair learning saved for future runs.", learned_repair)

            if outcome.detected_change:
                user = db.get(User, task.user_id)
                if user:
                    sent = send_notifications(task, user, result)
                    if sent:
                        _append_log(task.id, "INFO", "Notifications sent.", {"channels": sent})

            return {"ok": True, "task_id": task.id, "summary": outcome.summary}
        except Exception as error:
            task.run_status = "ERROR"
            task.run_count += 1
            task.failure_count += 1
            task.last_run_at = datetime.now(timezone.utc)
            task.last_error = str(error)
            task.next_run_at = compute_next_run_at(normalize_schedule(task.schedule), task.last_run_at)

            db.add(
                TaskResult(
                    task_id=task.id,
                    summary=str(error),
                    status="ERROR",
                    detected_change=False,
                    execution_time_ms=0,
                    result_data={"error": str(error)},
                )
            )
            db.commit()

            _append_log(task.id, "ERROR", "Execution failed.", {"error": str(error)})
            raise


@celery_app.task(name="app.workers.tasks.dispatch_due_tasks")
def dispatch_due_tasks() -> dict:
    queued = 0
    now = datetime.now(timezone.utc)

    with SessionLocal() as db:
        due_tasks = db.scalars(
            select(AutomationTask).where(
                AutomationTask.status == "ACTIVE",
                AutomationTask.next_run_at.is_not(None),
                AutomationTask.next_run_at <= now,
            )
        ).all()

        for task in due_tasks:
            execute_automation_task.delay(task.id, "scheduled")
            queued += 1

    return {"queued": queued}
