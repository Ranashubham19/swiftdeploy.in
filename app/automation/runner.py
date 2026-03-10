from __future__ import annotations

import hashlib
import re
import time
from dataclasses import dataclass, field
from typing import Any

from bs4 import BeautifulSoup
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

from app.automation.repair import repair_missing_element, resolve_locator
from app.core.config import get_settings
from app.models.task import AutomationTask, TaskResult
from app.schemas.task import AutomationStep, StructuredInstructions


PRICE_PATTERN = re.compile(r"(?:\$|USD|INR|EUR|GBP|Rs\.?)\s?([0-9][0-9,]*(?:\.[0-9]{1,2})?)")


@dataclass
class ExecutionOutcome:
    summary: str
    result_data: dict[str, Any]
    detected_change: bool
    repaired: bool
    repair_details: dict[str, Any]
    execution_time_ms: int


@dataclass
class StepExecutionResult:
    action: str
    value: Any = None
    selector_used: str | None = None
    repaired: bool = False
    repair_details: dict[str, Any] = field(default_factory=dict)


class AutomationRunner:
    def __init__(self) -> None:
        self.settings = get_settings()

    def execute(self, task: AutomationTask, previous_result: TaskResult | None = None) -> ExecutionOutcome:
        started = time.perf_counter()
        instructions = StructuredInstructions.model_validate(task.structured_instructions or {})
        task_type = instructions.task_type
        selectors = [str(item) for item in instructions.selectors]

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=self.settings.browser_headless)
            page = browser.new_page(user_agent=self.settings.browser_user_agent)
            try:
                workflow_steps = [AutomationStep.model_validate(step) for step in instructions.steps]
                if workflow_steps:
                    try:
                        outcome = self._execute_step_workflow(
                            page=page,
                            task=task,
                            instructions=instructions,
                            task_type=task_type,
                            workflow_steps=workflow_steps,
                            selectors=selectors,
                            previous_result=previous_result,
                        )
                    except Exception as workflow_error:
                        page.goto(
                            instructions.website_url,
                            wait_until="domcontentloaded",
                            timeout=self.settings.browser_timeout_ms,
                        )
                        page.wait_for_timeout(1200)
                        outcome = self._execute_by_type(page, task, task_type, selectors, previous_result)
                        outcome.result_data["workflow_fallback_error"] = str(workflow_error)
                else:
                    page.goto(
                        instructions.website_url,
                        wait_until="domcontentloaded",
                        timeout=self.settings.browser_timeout_ms,
                    )
                    page.wait_for_timeout(1200)
                    outcome = self._execute_by_type(page, task, task_type, selectors, previous_result)

                outcome.execution_time_ms = int((time.perf_counter() - started) * 1000)
                return outcome
            except PlaywrightTimeoutError as error:
                raise RuntimeError("The target website timed out during automation.") from error
            finally:
                browser.close()

    def _execute_step_workflow(
        self,
        *,
        page,
        task: AutomationTask,
        instructions: StructuredInstructions,
        task_type: str,
        workflow_steps: list[AutomationStep],
        selectors: list[str],
        previous_result: TaskResult | None,
    ) -> ExecutionOutcome:
        state: dict[str, Any] = {
            "keyword": instructions.keyword,
            "website": instructions.website,
            "website_url": instructions.website_url,
            "task_type": instructions.task_type,
            "extract": instructions.extract,
        }
        step_outputs: list[dict[str, Any]] = []
        repair_events: list[dict[str, Any]] = []

        if not any(step.action == "open_url" for step in workflow_steps):
            page.goto(
                instructions.website_url,
                wait_until="domcontentloaded",
                timeout=self.settings.browser_timeout_ms,
            )
            page.wait_for_timeout(1200)

        for index, step in enumerate(workflow_steps, start=1):
            result = self._run_step(
                page=page,
                task_type=task_type,
                step=step,
                selectors=selectors,
                state=state,
            )
            if step.store_as and result.value is not None:
                state[step.store_as] = result.value

            step_outputs.append(
                {
                    "index": index,
                    "action": step.action,
                    "label": step.label or "",
                    "store_as": step.store_as or "",
                    "selector_used": result.selector_used or "",
                    "repaired": result.repaired,
                }
            )
            if result.repaired:
                repair_events.append(
                    {
                        "index": index,
                        "action": step.action,
                        "label": step.label or "",
                        **result.repair_details,
                    }
                )

        return self._build_workflow_outcome(
            page=page,
            task=task,
            task_type=task_type,
            previous_result=previous_result,
            state=state,
            step_outputs=step_outputs,
            repair_events=repair_events,
        )

    def _run_step(
        self,
        *,
        page,
        task_type: str,
        step: AutomationStep,
        selectors: list[str],
        state: dict[str, Any],
    ) -> StepExecutionResult:
        timeout_ms = step.timeout_ms or self.settings.browser_timeout_ms
        selector_candidates = self._selector_candidates(step, selectors)
        fallback_keywords = self._fallback_keywords(step, state)

        if step.action == "open_url":
            target_url = self._render_template(step.url or state.get("website_url", ""), state)
            if not target_url:
                raise RuntimeError("Workflow step is missing a target URL.")
            page.goto(target_url, wait_until="domcontentloaded", timeout=timeout_ms)
            page.wait_for_timeout(1000)
            return StepExecutionResult(action=step.action, value=target_url)

        if step.action == "wait_for":
            outcome = resolve_locator(
                page,
                task_type,
                extra_selectors=selector_candidates,
                fallback_keywords=fallback_keywords,
                hint_text=step.label or step.wait_for_selector,
                action="wait",
                timeout_ms=timeout_ms,
            )
            if not outcome.found:
                raise RuntimeError("Workflow wait step could not find the target element.")
            return StepExecutionResult(
                action=step.action,
                value=True,
                selector_used=outcome.selector,
                repaired=outcome.strategy not in {None, "selector"},
                repair_details={"selector": outcome.selector, "strategy": outcome.strategy, "evidence": outcome.evidence},
            )

        if step.action == "type":
            target_text = self._render_template(step.value or step.text or "", state)
            outcome = resolve_locator(
                page,
                task_type,
                extra_selectors=selector_candidates,
                fallback_keywords=fallback_keywords,
                hint_text=step.label or "search",
                action="type",
                timeout_ms=timeout_ms,
            )
            if not outcome.found or outcome.locator is None:
                raise RuntimeError("Workflow type step could not find an editable field.")
            outcome.locator.click(timeout=timeout_ms)
            outcome.locator.fill(target_text, timeout=timeout_ms)
            return StepExecutionResult(
                action=step.action,
                value=target_text,
                selector_used=outcome.selector,
                repaired=outcome.strategy not in {None, "selector"},
                repair_details={"selector": outcome.selector, "strategy": outcome.strategy, "evidence": outcome.evidence},
            )

        if step.action == "press":
            key = self._render_template(step.key or "Enter", state)
            if selector_candidates:
                outcome = resolve_locator(
                    page,
                    task_type,
                    extra_selectors=selector_candidates,
                    fallback_keywords=fallback_keywords,
                    hint_text=step.label,
                    action="type",
                    timeout_ms=timeout_ms,
                )
                if outcome.found and outcome.locator is not None:
                    outcome.locator.press(key, timeout=timeout_ms)
                    return StepExecutionResult(action=step.action, value=key, selector_used=outcome.selector)
            page.keyboard.press(key)
            return StepExecutionResult(action=step.action, value=key)

        if step.action == "click":
            outcome = resolve_locator(
                page,
                task_type,
                extra_selectors=selector_candidates,
                fallback_keywords=fallback_keywords,
                hint_text=step.label,
                action="click",
                timeout_ms=timeout_ms,
            )
            if not outcome.found or outcome.locator is None:
                raise RuntimeError("Workflow click step could not find the target element.")
            outcome.locator.click(timeout=timeout_ms)
            return StepExecutionResult(
                action=step.action,
                value=True,
                selector_used=outcome.selector,
                repaired=outcome.strategy not in {None, "selector"},
                repair_details={"selector": outcome.selector, "strategy": outcome.strategy, "evidence": outcome.evidence},
            )

        if step.action == "scroll":
            amount = self._parse_int(self._render_template(step.value or "650", state), default=650)
            page.mouse.wheel(0, amount)
            page.wait_for_timeout(350)
            return StepExecutionResult(action=step.action, value=amount)

        if step.action == "extract_text":
            return self._extract_text_step(
                page=page,
                task_type=task_type,
                step=step,
                selector_candidates=selector_candidates,
                fallback_keywords=fallback_keywords,
                timeout_ms=timeout_ms,
            )

        if step.action == "extract_list":
            return self._extract_list_step(
                page=page,
                task_type=task_type,
                step=step,
                selector_candidates=selector_candidates,
                fallback_keywords=fallback_keywords,
                timeout_ms=timeout_ms,
            )

        if step.action == "capture_snapshot":
            snapshot = self._capture_snapshot_data(page)
            return StepExecutionResult(action=step.action, value=snapshot)

        raise RuntimeError(f"Unsupported workflow step action: {step.action}")

    def _extract_text_step(
        self,
        *,
        page,
        task_type: str,
        step: AutomationStep,
        selector_candidates: list[str],
        fallback_keywords: list[str],
        timeout_ms: int,
    ) -> StepExecutionResult:
        for selector in selector_candidates:
            try:
                candidate = (page.locator(selector).first.text_content(timeout=timeout_ms) or "").strip()
                candidate = self._apply_regex(candidate, step.extract_regex)
                if candidate:
                    return StepExecutionResult(action=step.action, value=candidate, selector_used=selector)
            except Exception:
                continue

        repair = repair_missing_element(
            page,
            task_type,
            selector_candidates,
            fallback_keywords=fallback_keywords,
            hint_text=step.label,
            action="extract",
            timeout_ms=timeout_ms,
            regex=step.extract_regex,
        )
        if not repair.found:
            raise RuntimeError("Workflow extract step could not find text on the page.")

        return StepExecutionResult(
            action=step.action,
            value=repair.value or "",
            selector_used=repair.selector,
            repaired=True,
            repair_details={"selector": repair.selector, "strategy": repair.strategy, "evidence": repair.evidence},
        )

    def _extract_list_step(
        self,
        *,
        page,
        task_type: str,
        step: AutomationStep,
        selector_candidates: list[str],
        fallback_keywords: list[str],
        timeout_ms: int,
    ) -> StepExecutionResult:
        max_items = step.max_items or 8

        for selector in selector_candidates:
            try:
                values = self._collect_text_candidates(page.locator(selector), max_items=max_items)
                values = self._filter_items(values, fallback_keywords, max_items=max_items)
                if values:
                    return StepExecutionResult(action=step.action, value=values, selector_used=selector)
            except Exception:
                continue

        repair = repair_missing_element(
            page,
            task_type,
            selector_candidates,
            fallback_keywords=fallback_keywords,
            hint_text=step.label,
            action="extract",
            timeout_ms=timeout_ms,
            all_matches=True,
            max_items=max_items,
        )
        values = self._filter_items(repair.values or ([repair.value] if repair.value else []), fallback_keywords, max_items=max_items)
        if not values:
            raise RuntimeError("Workflow list extraction step found no matching items.")

        return StepExecutionResult(
            action=step.action,
            value=values,
            selector_used=repair.selector,
            repaired=True,
            repair_details={"selector": repair.selector, "strategy": repair.strategy, "evidence": repair.evidence},
        )

    def _build_workflow_outcome(
        self,
        *,
        page,
        task: AutomationTask,
        task_type: str,
        previous_result: TaskResult | None,
        state: dict[str, Any],
        step_outputs: list[dict[str, Any]],
        repair_events: list[dict[str, Any]],
    ) -> ExecutionOutcome:
        repaired = bool(repair_events)
        page_title = page.title()

        if task_type == "PRICE_TRACKER":
            raw_price = str(state.get("current_value") or state.get("price") or "")
            match = self._find_price(raw_price)
            if not match:
                raise RuntimeError("No product price could be extracted from the workflow.")

            current_price = float(match.group(1).replace(",", ""))
            previous_price = float((previous_result.result_data or {}).get("numeric_price", 0) or 0)
            detected_change = bool(previous_price) and current_price != previous_price
            dropped = bool(previous_price) and current_price < previous_price
            summary = (
                f"{task.title} dropped from {previous_price:.2f} to {current_price:.2f}."
                if dropped
                else f"{task.title} is currently {current_price:.2f}."
            )
            return ExecutionOutcome(
                summary=summary,
                result_data={
                    "numeric_price": current_price,
                    "matched_price": match.group(0),
                    "page_title": page_title,
                    "workflow_steps": step_outputs,
                    "repaired_steps": len(repair_events),
                    "workflow_version": "steps-v1",
                },
                detected_change=detected_change or dropped,
                repaired=repaired,
                repair_details={"workflow_repairs": repair_events},
                execution_time_ms=0,
            )

        if task_type in {"JOB_MONITOR", "NEWS_DIGEST"}:
            items = state.get("items") or state.get("headlines") or []
            if not items:
                raise RuntimeError("No matching items were extracted from the workflow.")

            previous_items = previous_result.result_data.get("items", []) if previous_result else []
            previous_first = str(previous_items[0]) if previous_items else ""
            detected_change = items[0] != previous_first if previous_first else True
            label = "roles" if task_type == "JOB_MONITOR" else "headlines"

            return ExecutionOutcome(
                summary=f"Collected {len(items)} {label} from {task.structured_instructions.get('website')}.",
                result_data={
                    "items": items,
                    "page_title": page_title,
                    "mode": "jobs" if task_type == "JOB_MONITOR" else "news",
                    "workflow_steps": step_outputs,
                    "repaired_steps": len(repair_events),
                    "workflow_version": "steps-v1",
                },
                detected_change=detected_change,
                repaired=repaired,
                repair_details={"workflow_repairs": repair_events},
                execution_time_ms=0,
            )

        snapshot = state.get("snapshot") or self._capture_snapshot_data(page)
        previous_hash = str((previous_result.result_data or {}).get("content_hash", "")) if previous_result else ""
        detected_change = bool(previous_hash) and snapshot["content_hash"] != previous_hash

        return ExecutionOutcome(
            summary=(
                f"{task.structured_instructions.get('website')} changed since the previous run."
                if detected_change
                else f"Captured the latest snapshot from {task.structured_instructions.get('website')}."
            ),
            result_data={
                **snapshot,
                "page_title": page_title,
                "workflow_steps": step_outputs,
                "repaired_steps": len(repair_events),
                "workflow_version": "steps-v1",
            },
            detected_change=detected_change,
            repaired=repaired,
            repair_details={"workflow_repairs": repair_events},
            execution_time_ms=0,
        )

    def _execute_by_type(
        self,
        page,
        task: AutomationTask,
        task_type: str,
        selectors: list[str],
        previous_result: TaskResult | None,
    ) -> ExecutionOutcome:
        if task_type == "PRICE_TRACKER":
            return self._extract_price(page, task, selectors, previous_result)
        if task_type == "JOB_MONITOR":
            return self._extract_line_items(page, task, previous_result, "jobs")
        if task_type == "NEWS_DIGEST":
            return self._extract_line_items(page, task, previous_result, "news")
        return self._extract_snapshot(page, task, previous_result)

    def _extract_price(
        self,
        page,
        task: AutomationTask,
        selectors: list[str],
        previous_result: TaskResult | None,
    ) -> ExecutionOutcome:
        price_text = ""
        selector_used = None
        for selector in selectors:
            try:
                candidate = (page.locator(selector).first.text_content(timeout=2000) or "").strip()
                if candidate and self._find_price(candidate):
                    price_text = candidate
                    selector_used = selector
                    break
            except Exception:
                continue

        repaired = False
        repair_details: dict[str, Any] = {}
        if not price_text:
            repair = repair_missing_element(
                page,
                "PRICE_TRACKER",
                selectors,
                fallback_keywords=[str(task.structured_instructions.get("keyword", "")), "price"],
                action="extract",
                regex=PRICE_PATTERN.pattern,
            )
            repaired = repair.found
            repair_details = {"selector": repair.selector, "strategy": repair.strategy, "evidence": repair.evidence or []}
            price_text = repair.value or ""
            selector_used = repair.selector

        match = self._find_price(price_text)
        if not match:
            raise RuntimeError("No product price could be extracted from the target page.")

        current_price = float(match.group(1).replace(",", ""))
        previous_price = float((previous_result.result_data or {}).get("numeric_price", 0) or 0)
        detected_change = bool(previous_price) and current_price != previous_price
        dropped = bool(previous_price) and current_price < previous_price
        summary = (
            f"{task.title} dropped from {previous_price:.2f} to {current_price:.2f}."
            if dropped
            else f"{task.title} is currently {current_price:.2f}."
        )

        return ExecutionOutcome(
            summary=summary,
            result_data={
                "numeric_price": current_price,
                "matched_price": match.group(0),
                "selector_used": selector_used,
                "page_title": page.title(),
            },
            detected_change=detected_change or dropped,
            repaired=repaired,
            repair_details=repair_details,
            execution_time_ms=0,
        )

    def _extract_line_items(
        self,
        page,
        task: AutomationTask,
        previous_result: TaskResult | None,
        mode: str,
    ) -> ExecutionOutcome:
        lines = self._text_lines(page.content())
        keyword = str(task.structured_instructions.get("keyword", "")).lower()
        filtered = [line for line in lines if len(line) > 15 and (keyword in line.lower() if keyword else True)][:8]
        if not filtered:
            raise RuntimeError("No matching items were extracted from the target website.")

        previous_items = previous_result.result_data.get("items", []) if previous_result else []
        previous_first = str(previous_items[0]) if previous_items else ""
        detected_change = filtered[0] != previous_first if previous_first else True
        label = "roles" if mode == "jobs" else "headlines"

        return ExecutionOutcome(
            summary=f"Collected {len(filtered)} {label} from {task.structured_instructions.get('website')}.",
            result_data={"items": filtered, "page_title": page.title(), "mode": mode},
            detected_change=detected_change,
            repaired=False,
            repair_details={},
            execution_time_ms=0,
        )

    def _extract_snapshot(
        self,
        page,
        task: AutomationTask,
        previous_result: TaskResult | None,
    ) -> ExecutionOutcome:
        snapshot = self._capture_snapshot_data(page)
        previous_hash = str((previous_result.result_data or {}).get("content_hash", "")) if previous_result else ""
        detected_change = bool(previous_hash) and snapshot["content_hash"] != previous_hash

        return ExecutionOutcome(
            summary=(
                f"{task.structured_instructions.get('website')} changed since the previous run."
                if detected_change
                else f"Captured the latest snapshot from {task.structured_instructions.get('website')}."
            ),
            result_data={**snapshot, "page_title": page.title()},
            detected_change=detected_change,
            repaired=False,
            repair_details={},
            execution_time_ms=0,
        )

    def _selector_candidates(self, step: AutomationStep, defaults: list[str]) -> list[str]:
        candidates = []
        if step.selector:
            candidates.append(step.selector)
        candidates.extend(step.selectors)
        if step.wait_for_selector:
            candidates.append(step.wait_for_selector)
        if not candidates and step.action in {"extract_text", "extract_list"}:
            candidates.extend(defaults)
        deduped: list[str] = []
        seen: set[str] = set()
        for candidate in candidates:
            value = str(candidate).strip()
            if not value or value in seen:
                continue
            seen.add(value)
            deduped.append(value)
        return deduped

    def _fallback_keywords(self, step: AutomationStep, state: dict[str, Any]) -> list[str]:
        values = list(step.fallback_keywords)
        if state.get("keyword"):
            values.append(str(state["keyword"]))
        if state.get("extract"):
            values.append(str(state["extract"]))
        return values

    @staticmethod
    def _render_template(value: str, state: dict[str, Any]) -> str:
        rendered = str(value or "")
        for key, state_value in state.items():
            if isinstance(state_value, (str, int, float)):
                rendered = rendered.replace(f"{{{{{key}}}}}", str(state_value))
        return rendered

    @staticmethod
    def _parse_int(value: str, *, default: int) -> int:
        try:
            return int(float(value))
        except Exception:
            return default

    @staticmethod
    def _apply_regex(value: str, regex: str | None) -> str:
        if not value:
            return ""
        if not regex:
            return value
        match = re.search(regex, value)
        return match.group(0) if match else ""

    @staticmethod
    def _collect_text_candidates(locator, *, max_items: int) -> list[str]:
        texts = locator.all_text_contents()
        normalized: list[str] = []
        seen: set[str] = set()
        for text in texts:
            value = re.sub(r"\s+", " ", str(text)).strip()
            if len(value) < 4 or value in seen:
                continue
            seen.add(value)
            normalized.append(value)
            if len(normalized) >= max_items:
                break
        return normalized

    @staticmethod
    def _filter_items(values: list[str], keywords: list[str], *, max_items: int) -> list[str]:
        if not values:
            return []
        lowered_keywords = [keyword.lower() for keyword in keywords if keyword]
        if lowered_keywords:
            filtered = [value for value in values if any(keyword in value.lower() for keyword in lowered_keywords)]
            if filtered:
                return filtered[:max_items]
        return values[:max_items]

    def _capture_snapshot_data(self, page) -> dict[str, Any]:
        body_text = page.locator("body").text_content(timeout=2000) or ""
        return {
            "content_hash": hashlib.sha256(body_text.encode("utf-8")).hexdigest(),
            "snippet": self._text_lines(page.content())[:5],
        }

    @staticmethod
    def _find_price(value: str) -> re.Match[str] | None:
        return PRICE_PATTERN.search(value or "")

    @staticmethod
    def _text_lines(html: str) -> list[str]:
        soup = BeautifulSoup(html, "html.parser")
        text = soup.get_text(" ", strip=True)
        lines = [re.sub(r"\s+", " ", chunk).strip() for chunk in re.split(r"(?<=[.!?])\s+", text)]
        return [line for line in lines if line]
