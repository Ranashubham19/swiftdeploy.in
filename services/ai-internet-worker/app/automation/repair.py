from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from playwright.sync_api import Locator, Page


PRICE_PATTERN = re.compile(r"(?:\$|USD|INR|EUR|GBP|Rs\.?)\s?([0-9][0-9,]*(?:\.[0-9]{1,2})?)")


@dataclass
class RepairOutcome:
    found: bool
    selector: str | None = None
    value: str | None = None
    values: list[str] | None = None
    evidence: list[str] = field(default_factory=list)
    strategy: str | None = None
    locator: Any | None = None


COMMON_SELECTORS = {
    "PRICE_TRACKER": [
        "[data-testid*='price']",
        "[class*='price']",
        "[id*='price']",
        "[itemprop='price']",
        "main [class*='amount']",
        "main [class*='sale']",
    ],
    "JOB_MONITOR": [
        "article h2",
        "article h3",
        "[data-testid*='job'] h2",
        "[class*='job'] h2",
        "main h2",
        "main h3",
    ],
    "NEWS_DIGEST": ["article h1", "article h2", "[class*='headline']", "main h1", "main h2"],
    "PAGE_CHANGE": ["main", "article", "[role='main']", "body"],
    "WEBSITE_MONITOR": ["main", "article", "[role='main']", "body"],
}


COMMON_INTERACTIVE_SELECTORS = {
    "type": [
        "input[type='search']",
        "input[name*='search']",
        "input[name='q']",
        "input[type='text']",
        "textarea",
    ],
    "click": [
        "button[type='submit']",
        "button",
        "[role='button']",
        "a",
    ],
    "wait": [
        "main",
        "article",
        "body",
    ],
}


def repair_missing_element(
    page: "Page",
    task_type: str,
    extra_selectors: list[str] | None = None,
    *,
    fallback_keywords: list[str] | None = None,
    hint_text: str | None = None,
    action: str = "extract",
    timeout_ms: int = 2000,
    all_matches: bool = False,
    regex: str | None = None,
    max_items: int | None = None,
) -> RepairOutcome:
    outcome = resolve_locator(
        page,
        task_type,
        extra_selectors=extra_selectors,
        fallback_keywords=fallback_keywords,
        hint_text=hint_text,
        action=action,
        timeout_ms=timeout_ms,
    )
    if not outcome.found:
        return outcome

    if all_matches and outcome.selector:
        texts = _collect_texts(page.locator(outcome.selector), max_items=max_items)
        if texts:
            return RepairOutcome(
                found=True,
                selector=outcome.selector,
                value=texts[0],
                values=texts,
                evidence=outcome.evidence,
                strategy=outcome.strategy,
                locator=outcome.locator,
            )

    extracted_text = outcome.value or _read_locator_text(outcome.locator, timeout_ms=timeout_ms)
    if regex and extracted_text:
        match = re.search(regex, extracted_text)
        if match:
            extracted_text = match.group(0)
    return RepairOutcome(
        found=True,
        selector=outcome.selector,
        value=extracted_text,
        values=outcome.values,
        evidence=outcome.evidence,
        strategy=outcome.strategy,
        locator=outcome.locator,
    )


def resolve_locator(
    page: "Page",
    task_type: str,
    extra_selectors: list[str] | None = None,
    *,
    fallback_keywords: list[str] | None = None,
    hint_text: str | None = None,
    action: str = "extract",
    timeout_ms: int = 2000,
) -> RepairOutcome:
    evidence: list[str] = []
    text_hints = _build_text_hints(fallback_keywords=fallback_keywords, hint_text=hint_text)
    selector_candidates = _build_selector_candidates(
        task_type=task_type,
        action=action,
        extra_selectors=extra_selectors,
        fallback_keywords=fallback_keywords,
    )

    for selector in selector_candidates:
        try:
            locator = page.locator(selector)
            if _locator_is_usable(locator, action=action, timeout_ms=timeout_ms):
                return RepairOutcome(
                    found=True,
                    selector=selector,
                    value=_read_locator_text(locator.first, timeout_ms=timeout_ms),
                    evidence=evidence,
                    strategy="selector",
                    locator=locator.first,
                )
            evidence.append(f"No usable element for {selector}")
        except Exception as error:  # pragma: no cover - depends on target page structure
            evidence.append(f"{selector}: {error}")

    role_candidates = _build_role_candidates(page, text_hints=text_hints, action=action)
    for strategy, locator in role_candidates:
        try:
            if _locator_is_usable(locator, action=action, timeout_ms=timeout_ms):
                return RepairOutcome(
                    found=True,
                    selector=strategy,
                    value=_read_locator_text(locator, timeout_ms=timeout_ms),
                    evidence=evidence,
                    strategy=strategy,
                    locator=locator,
                )
            evidence.append(f"No usable element for {strategy}")
        except Exception as error:  # pragma: no cover - depends on target page structure
            evidence.append(f"{strategy}: {error}")

    if action == "extract" and any(token in {"price", "amount", "cost"} for token in _keyword_tokens(fallback_keywords)):
        try:
            body_text = (page.locator("body").text_content(timeout=timeout_ms) or "").strip()
            match = PRICE_PATTERN.search(body_text)
            if match:
                return RepairOutcome(
                    found=True,
                    selector="body",
                    value=match.group(0),
                    evidence=evidence,
                    strategy="body-price-scan",
                    locator=page.locator("body").first,
                )
        except Exception as error:  # pragma: no cover - depends on target page structure
            evidence.append(f"body-price-scan: {error}")

    return RepairOutcome(found=False, evidence=evidence)


def _build_selector_candidates(
    *,
    task_type: str,
    action: str,
    extra_selectors: list[str] | None,
    fallback_keywords: list[str] | None,
) -> list[str]:
    candidates: list[str] = []
    candidates.extend(_normalize_selectors(extra_selectors))
    candidates.extend(COMMON_SELECTORS.get(task_type, ["body"]))
    candidates.extend(COMMON_INTERACTIVE_SELECTORS.get(action, []))

    for token in _keyword_tokens(fallback_keywords):
        candidates.extend(
            [
                f"[data-testid*='{token}']",
                f"[class*='{token}']",
                f"[id*='{token}']",
                f"[name*='{token}']",
                f"[placeholder*='{token}']",
                f"[aria-label*='{token}']",
            ]
        )

    deduped: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        normalized = candidate.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(normalized)
    return deduped


def _build_role_candidates(page: "Page", *, text_hints: list[str], action: str) -> list[tuple[str, "Locator"]]:
    candidates: list[tuple[str, "Locator"]] = []

    for hint in text_hints:
        if action == "type":
            candidates.extend(
                [
                    (f"label:{hint}", page.get_by_label(hint)),
                    (f"placeholder:{hint}", page.get_by_placeholder(hint)),
                    (f"textbox:{hint}", page.get_by_role("textbox", name=hint)),
                ]
            )
        elif action == "click":
            candidates.extend(
                [
                    (f"button:{hint}", page.get_by_role("button", name=hint)),
                    (f"link:{hint}", page.get_by_role("link", name=hint)),
                    (f"text:{hint}", page.get_by_text(hint)),
                ]
            )
        elif action == "wait":
            candidates.extend(
                [
                    (f"text:{hint}", page.get_by_text(hint)),
                    (f"heading:{hint}", page.get_by_role("heading", name=hint)),
                ]
            )
        else:
            candidates.extend(
                [
                    (f"text:{hint}", page.get_by_text(hint)),
                    (f"heading:{hint}", page.get_by_role("heading", name=hint)),
                ]
            )

    return candidates


def _build_text_hints(*, fallback_keywords: list[str] | None, hint_text: str | None) -> list[str]:
    hints: list[str] = []
    if hint_text:
        hints.append(hint_text.strip())
    for token in _keyword_tokens(fallback_keywords):
        hints.append(token.replace("-", " "))
    return [hint for hint in hints if hint]


def _keyword_tokens(values: list[str] | None) -> list[str]:
    if not values:
        return []
    tokens: list[str] = []
    for value in values:
        for chunk in re.split(r"[^a-z0-9]+", str(value).lower()):
            if len(chunk) >= 3:
                tokens.append(chunk)
    deduped: list[str] = []
    seen: set[str] = set()
    for token in tokens:
        if token in seen:
            continue
        seen.add(token)
        deduped.append(token)
    return deduped


def _normalize_selectors(selectors: list[str] | None) -> list[str]:
    return [selector.strip() for selector in (selectors or []) if str(selector).strip()]


def _locator_is_usable(locator: "Locator", *, action: str, timeout_ms: int) -> bool:
    target = locator.first
    if action in {"click", "type", "wait"}:
        target.wait_for(state="attached", timeout=timeout_ms)
        return True

    text = _read_locator_text(target, timeout_ms=timeout_ms)
    return bool(text)


def _read_locator_text(locator: "Locator" | None, *, timeout_ms: int) -> str:
    if locator is None:
        return ""

    try:
        input_value = locator.input_value(timeout=timeout_ms)
        if input_value:
            return input_value.strip()
    except Exception:
        pass

    try:
        text = locator.text_content(timeout=timeout_ms) or ""
        if text.strip():
            return text.strip()
    except Exception:
        pass

    try:
        attr = locator.get_attribute("content")
        if attr:
            return attr.strip()
    except Exception:
        pass

    return ""


def _collect_texts(locator: "Locator", *, max_items: int | None = None) -> list[str]:
    texts = []
    try:
        texts = locator.all_text_contents()
    except Exception:
        try:
            text = _read_locator_text(locator.first, timeout_ms=2000)
            texts = [text] if text else []
        except Exception:
            texts = []

    normalized: list[str] = []
    seen: set[str] = set()
    for text in texts:
        value = re.sub(r"\s+", " ", str(text)).strip()
        if not value or value in seen:
            continue
        seen.add(value)
        normalized.append(value)
        if max_items and len(normalized) >= max_items:
            break
    return normalized
