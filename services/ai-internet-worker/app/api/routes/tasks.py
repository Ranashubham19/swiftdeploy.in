from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.api.deps import get_request_user
from app.db.session import get_db
from app.models.task import AutomationTask, ExecutionLog, TaskResult
from app.models.user import User
from app.schemas.task import (
    ExecutionLogRead,
    TaskCreate,
    TaskDashboardResponse,
    TaskInterpretRequest,
    TaskInterpretResponse,
    TaskRead,
    TaskResultRead,
    TaskUpdate,
)
from app.services.interpreter import TaskInterpreterService, hydrate_website_url
from app.services.task_utils import compute_next_run_at, normalize_schedule
from app.workers.tasks import execute_automation_task


router = APIRouter(prefix="/tasks", tags=["tasks"])
interpreter = TaskInterpreterService()


def _serialize_task(task: AutomationTask) -> TaskRead:
    return TaskRead.model_validate(task)


@router.post("/interpret", response_model=TaskInterpretResponse)
def interpret_task(payload: TaskInterpretRequest, _: User = Depends(get_request_user)) -> TaskInterpretResponse:
    instructions = hydrate_website_url(interpreter.interpret(payload.description))
    return TaskInterpretResponse(structured_instructions=instructions)


@router.get("", response_model=TaskDashboardResponse)
def list_tasks(
    current_user: User = Depends(get_request_user),
    db: Session = Depends(get_db),
) -> TaskDashboardResponse:
    tasks = db.scalars(
        select(AutomationTask)
        .where(AutomationTask.user_id == current_user.id)
        .order_by(desc(AutomationTask.updated_at))
    ).all()
    task_ids = [task.id for task in tasks]

    latest_results = db.scalars(
        select(TaskResult)
        .where(TaskResult.task_id.in_(task_ids if task_ids else [""]))
        .order_by(desc(TaskResult.created_at))
        .limit(12)
    ).all()
    latest_logs = db.scalars(
        select(ExecutionLog)
        .where(ExecutionLog.task_id.in_(task_ids if task_ids else [""]))
        .order_by(desc(ExecutionLog.created_at))
        .limit(20)
    ).all()

    return TaskDashboardResponse(
        tasks=[_serialize_task(task) for task in tasks],
        total_tasks=len(tasks),
        active_tasks=sum(1 for task in tasks if task.status == "ACTIVE"),
        running_tasks=sum(1 for task in tasks if task.run_status == "RUNNING"),
        latest_results=[TaskResultRead.model_validate(item) for item in latest_results],
        latest_logs=[ExecutionLogRead.model_validate(item) for item in latest_logs],
    )


@router.post("", response_model=TaskRead, status_code=status.HTTP_201_CREATED)
def create_task(
    payload: TaskCreate,
    current_user: User = Depends(get_request_user),
    db: Session = Depends(get_db),
) -> TaskRead:
    instructions = payload.structured_instructions
    if instructions is None:
        instructions = hydrate_website_url(interpreter.interpret(payload.task_description))
    else:
        instructions = hydrate_website_url(instructions)

    schedule = normalize_schedule(payload.schedule or instructions.schedule)
    now = datetime.now(timezone.utc)
    title = payload.title or payload.task_description[:80]

    task = AutomationTask(
        user_id=current_user.id,
        title=title,
        task_description=payload.task_description,
        task_type=instructions.task_type,
        schedule=schedule,
        status="ACTIVE",
        run_status="IDLE",
        structured_instructions=instructions.model_dump(),
        notification_channels=[item.upper() for item in payload.notification_channels],
        notification_target=payload.notification_target,
        next_run_at=compute_next_run_at(schedule, now),
    )
    db.add(task)
    db.flush()
    db.add(
        ExecutionLog(
            task_id=task.id,
            status="INFO",
            message="Task created.",
            details={"schedule": schedule, "task_type": instructions.task_type},
        )
    )
    db.commit()
    db.refresh(task)
    return _serialize_task(task)


@router.get("/{task_id}/results", response_model=list[TaskResultRead])
def task_results(
    task_id: str,
    current_user: User = Depends(get_request_user),
    db: Session = Depends(get_db),
) -> list[TaskResultRead]:
    task = db.scalar(select(AutomationTask).where(AutomationTask.id == task_id, AutomationTask.user_id == current_user.id))
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    results = db.scalars(select(TaskResult).where(TaskResult.task_id == task.id).order_by(desc(TaskResult.created_at))).all()
    return [TaskResultRead.model_validate(item) for item in results]


@router.get("/{task_id}/logs", response_model=list[ExecutionLogRead])
def task_logs(
    task_id: str,
    current_user: User = Depends(get_request_user),
    db: Session = Depends(get_db),
) -> list[ExecutionLogRead]:
    task = db.scalar(select(AutomationTask).where(AutomationTask.id == task_id, AutomationTask.user_id == current_user.id))
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    logs = db.scalars(select(ExecutionLog).where(ExecutionLog.task_id == task.id).order_by(desc(ExecutionLog.created_at))).all()
    return [ExecutionLogRead.model_validate(item) for item in logs]


@router.get("/{task_id}", response_model=TaskRead)
def get_task(
    task_id: str,
    current_user: User = Depends(get_request_user),
    db: Session = Depends(get_db),
) -> TaskRead:
    task = db.scalar(select(AutomationTask).where(AutomationTask.id == task_id, AutomationTask.user_id == current_user.id))
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    return _serialize_task(task)


@router.patch("/{task_id}", response_model=TaskRead)
def update_task(
    task_id: str,
    payload: TaskUpdate,
    current_user: User = Depends(get_request_user),
    db: Session = Depends(get_db),
) -> TaskRead:
    task = db.scalar(select(AutomationTask).where(AutomationTask.id == task_id, AutomationTask.user_id == current_user.id))
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")

    if payload.title is not None:
        task.title = payload.title
    if payload.status is not None:
        task.status = payload.status.upper()
    if payload.schedule is not None:
        task.schedule = normalize_schedule(payload.schedule)
        task.next_run_at = compute_next_run_at(task.schedule, datetime.now(timezone.utc))
    if payload.notification_channels is not None:
        task.notification_channels = [item.upper() for item in payload.notification_channels]
    if payload.notification_target is not None:
        task.notification_target = payload.notification_target

    db.add(
        ExecutionLog(
            task_id=task.id,
            status="INFO",
            message="Task updated.",
            details=payload.model_dump(exclude_none=True),
        )
    )
    db.commit()
    db.refresh(task)
    return _serialize_task(task)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(
    task_id: str,
    current_user: User = Depends(get_request_user),
    db: Session = Depends(get_db),
) -> None:
    task = db.scalar(select(AutomationTask).where(AutomationTask.id == task_id, AutomationTask.user_id == current_user.id))
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    db.delete(task)
    db.commit()
    return None


@router.post("/{task_id}/run", status_code=status.HTTP_202_ACCEPTED)
def run_task(
    task_id: str,
    current_user: User = Depends(get_request_user),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    task = db.scalar(select(AutomationTask).where(AutomationTask.id == task_id, AutomationTask.user_id == current_user.id))
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    task.run_status = "RUNNING"
    task.last_error = None
    db.add(
        ExecutionLog(
            task_id=task.id,
            status="INFO",
            message="Execution queued.",
            details={"trigger": "manual"},
        )
    )
    db.commit()
    execute_automation_task.delay(task.id, "manual")
    return {"status": "queued", "task_id": task.id}
