from __future__ import annotations

import smtplib
from email.message import EmailMessage

import httpx

from app.core.config import get_settings
from app.models.task import AutomationTask, TaskResult
from app.models.user import User


def send_notifications(task: AutomationTask, user: User, result: TaskResult) -> list[str]:
    settings = get_settings()
    sent: list[str] = []

    for channel in task.notification_channels or []:
        normalized = str(channel).upper()
        if normalized == "EMAIL" and settings.smtp_host:
            _send_email(user.email, task, result)
            sent.append("EMAIL")
        if normalized == "TELEGRAM" and settings.telegram_bot_token:
            target = task.notification_target or user.telegram_chat_id or settings.telegram_default_chat_id
            if target:
                _send_telegram(target, task, result)
                sent.append("TELEGRAM")

    return sent


def _send_email(recipient: str, task: AutomationTask, result: TaskResult) -> None:
    settings = get_settings()
    message = EmailMessage()
    message["Subject"] = f"[AI Internet Worker] {task.title}"
    message["From"] = settings.notification_email_from or settings.smtp_username or "no-reply@example.com"
    message["To"] = recipient
    message.set_content(f"{result.summary}\n\nResult data:\n{result.result_data}")

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as server:
        if settings.smtp_use_tls:
            server.starttls()
        if settings.smtp_username and settings.smtp_password:
            server.login(settings.smtp_username, settings.smtp_password)
        server.send_message(message)


def _send_telegram(chat_id: str, task: AutomationTask, result: TaskResult) -> None:
    settings = get_settings()
    payload = {"chat_id": chat_id, "text": f"{task.title}\n\n{result.summary}"}
    with httpx.Client(timeout=15.0) as client:
        client.post(
            f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage",
            json=payload,
        ).raise_for_status()
