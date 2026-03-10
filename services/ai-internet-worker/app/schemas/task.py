from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class AutomationStep(BaseModel):
    action: str
    label: str | None = None
    url: str | None = None
    selector: str | None = None
    selectors: list[str] = Field(default_factory=list)
    text: str | None = None
    value: str | None = None
    store_as: str | None = None
    attribute: str | None = None
    key: str | None = None
    wait_for_selector: str | None = None
    timeout_ms: int | None = None
    all_matches: bool = False
    max_items: int | None = None
    fallback_keywords: list[str] = Field(default_factory=list)
    extract_regex: str | None = None


class StructuredInstructions(BaseModel):
    website: str
    website_url: str
    action: str
    keyword: str
    extract: str
    schedule: str
    task_type: str
    condition: str | None = None
    selectors: list[str] = Field(default_factory=list)
    steps: list[AutomationStep] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class TaskCreate(BaseModel):
    title: str | None = None
    task_description: str
    schedule: str | None = None
    notification_channels: list[str] = Field(default_factory=lambda: ["EMAIL"])
    notification_target: str | None = None
    structured_instructions: StructuredInstructions | None = None


class TaskUpdate(BaseModel):
    title: str | None = None
    schedule: str | None = None
    status: str | None = None
    notification_channels: list[str] | None = None
    notification_target: str | None = None


class TaskRead(BaseModel):
    id: str
    title: str
    task_description: str
    task_type: str
    schedule: str
    status: str
    run_status: str
    structured_instructions: dict[str, Any]
    notification_channels: list[str]
    notification_target: str | None
    run_count: int
    success_count: int
    failure_count: int
    repair_count: int
    last_summary: str | None
    last_error: str | None
    last_run_at: datetime | None
    last_successful_run_at: datetime | None
    next_run_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TaskResultRead(BaseModel):
    id: str
    task_id: str
    summary: str
    status: str
    detected_change: bool
    execution_time_ms: int
    result_data: dict[str, Any]
    created_at: datetime

    model_config = {"from_attributes": True}


class ExecutionLogRead(BaseModel):
    id: str
    task_id: str
    status: str
    message: str
    details: dict[str, Any]
    created_at: datetime

    model_config = {"from_attributes": True}


class TaskDashboardResponse(BaseModel):
    tasks: list[TaskRead]
    total_tasks: int
    active_tasks: int
    running_tasks: int
    latest_results: list[TaskResultRead]
    latest_logs: list[ExecutionLogRead]


class TaskInterpretRequest(BaseModel):
    description: str


class TaskInterpretResponse(BaseModel):
    structured_instructions: StructuredInstructions
