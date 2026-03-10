from __future__ import annotations

import json
import re
from urllib.parse import quote_plus, urlparse

import httpx

from app.core.config import get_settings
from app.schemas.task import AutomationStep, StructuredInstructions
from app.services.task_utils import normalize_schedule


KNOWN_WEBSITES: tuple[tuple[tuple[str, ...], str, str], ...] = (
    (("amazon.in", "amazon india"), "Amazon India", "https://www.amazon.in/s?k={query}"),
    (("amazon.com", "amazon"), "Amazon", "https://www.amazon.com/s?k={query}"),
    (("flipkart.com", "flipkart"), "Flipkart", "https://www.flipkart.com/search?q={query}"),
    (("indeed.com", "indeed"), "Indeed", "https://www.indeed.com/jobs?q={query}"),
    (("linkedin.com", "linkedin"), "LinkedIn Jobs", "https://www.linkedin.com/jobs/search/?keywords={query}"),
    (("remoteok.com", "remote ok", "remoteok"), "Remote OK", "https://remoteok.com/remote-{query}-jobs"),
    (("wellfound.com", "wellfound", "angel.co"), "Wellfound", "https://wellfound.com/jobs"),
    (("news.google.com", "google news"), "Google News", "https://news.google.com/search?q={query}"),
    (("news.ycombinator.com", "hacker news"), "Hacker News", "https://news.ycombinator.com/"),
    (("producthunt.com", "product hunt"), "Product Hunt", "https://www.producthunt.com/search?q={query}"),
)

DUCKDUCKGO_TEMPLATE = "https://duckduckgo.com/?q={query}"
PRICE_REGEX = r"(?:\\$|USD|INR|EUR|GBP|Rs\\.?|USD\\s|INR\\s)?\\s?[0-9][0-9,]*(?:\\.[0-9]{1,2})?"

SITE_PROFILES: dict[str, dict[str, object]] = {
    "amazon.in": {
        "home_url": "https://www.amazon.in/",
        "search_input_selectors": ["#twotabsearchtextbox", "input[name='field-keywords']"],
        "result_selectors": ["[data-component-type='s-search-result'] h2 span", "main h2 span"],
        "price_selectors": ["[data-a-price-whole]", "[class*='price']", "[itemprop='price']"],
    },
    "amazon.com": {
        "home_url": "https://www.amazon.com/",
        "search_input_selectors": ["#twotabsearchtextbox", "input[name='field-keywords']"],
        "result_selectors": ["[data-component-type='s-search-result'] h2 span", "main h2 span"],
        "price_selectors": ["[data-a-price-whole]", "[class*='price']", "[itemprop='price']"],
    },
    "flipkart.com": {
        "home_url": "https://www.flipkart.com/",
        "search_input_selectors": ["input[name='q']", "input[title='Search for products, brands and more']"],
        "result_selectors": ["main a[title]", "main h1", "main h2"],
        "price_selectors": ["[class*='price']", "[data-testid*='price']", "[class*='amount']"],
    },
    "indeed.com": {
        "home_url": "https://www.indeed.com/",
        "search_input_selectors": ["input[name='q']", "input[placeholder*='job']"],
        "result_selectors": ["main h2", "[data-testid='jobTitle']", "[data-jk] h2"],
        "list_selectors": ["[data-testid='jobTitle']", "main h2", "main h3"],
    },
    "linkedin.com": {
        "home_url": "https://www.linkedin.com/jobs/",
        "prefer_direct_search": True,
        "result_selectors": [".job-search-card__title", "[data-job-id] h3", "main h3"],
        "list_selectors": [".job-search-card__title", "[data-job-id] h3", "main h3"],
    },
    "remoteok.com": {
        "home_url": "https://remoteok.com/",
        "prefer_direct_search": True,
        "result_selectors": ["td.company_and_position h2", "main h2", "main h3"],
        "list_selectors": ["td.company_and_position h2", "main h2", "main h3"],
    },
    "wellfound.com": {
        "home_url": "https://wellfound.com/jobs",
        "prefer_direct_search": True,
        "result_selectors": ["[data-testid*='job'] h2", "main h2", "main h3"],
        "list_selectors": ["[data-testid*='job'] h2", "main h2", "main h3"],
    },
    "news.google.com": {
        "home_url": "https://news.google.com/",
        "prefer_direct_search": True,
        "result_selectors": ["article h3", "article h4", "main h3"],
        "list_selectors": ["article h3", "article h4", "main h3"],
    },
    "news.ycombinator.com": {
        "home_url": "https://news.ycombinator.com/",
        "result_selectors": [".titleline a", "a.titlelink", "tr.athing .title a"],
        "list_selectors": [".titleline a", "a.titlelink", "tr.athing .title a"],
    },
    "producthunt.com": {
        "home_url": "https://www.producthunt.com/",
        "prefer_direct_search": True,
        "result_selectors": ["main h3", "main h2", "article h3"],
        "list_selectors": ["main h3", "main h2", "article h3"],
    },
}


class TaskInterpreterService:
    def __init__(self) -> None:
        self.settings = get_settings()

    def interpret(self, description: str) -> StructuredInstructions:
        cleaned = self._clean(description)
        interpreted: StructuredInstructions | None = None
        if self.settings.openai_api_key:
            interpreted = self._interpret_with_llm(cleaned)
        if interpreted is None:
            interpreted = self._interpret_with_rules(cleaned)
        return self._attach_workflow_steps(interpreted)

    def _interpret_with_llm(self, description: str) -> StructuredInstructions | None:
        payload = {
            "model": self.settings.openai_model,
            "response_format": {"type": "json_object"},
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "Convert internet automation requests into JSON with keys "
                        "website, website_url, action, keyword, extract, schedule, task_type, "
                        "condition, selectors, steps, metadata. "
                        "Steps must use these actions only: open_url, wait_for, type, press, click, scroll, "
                        "extract_text, extract_list, capture_snapshot. "
                        "Prefer direct public sources, direct URLs, and repair-friendly selectors. "
                        "Return JSON only."
                    ),
                },
                {"role": "user", "content": description},
            ],
        }
        headers = {
            "Authorization": f"Bearer {self.settings.openai_api_key}",
            "Content-Type": "application/json",
        }
        try:
            with httpx.Client(base_url=self.settings.openai_base_url, timeout=20.0) as client:
                response = client.post("/chat/completions", headers=headers, json=payload)
                response.raise_for_status()
                content = response.json()["choices"][0]["message"]["content"]
                interpreted = StructuredInstructions(**json.loads(content))
                metadata = dict(interpreted.metadata or {})
                metadata.setdefault("source", "llm-interpreter-v3")
                return interpreted.model_copy(update={"metadata": metadata})
        except Exception:
            return None

    def _interpret_with_rules(self, description: str) -> StructuredInstructions:
        task_type = self._detect_task_type(description)
        schedule = normalize_schedule(self._detect_schedule(description))
        website, website_url = self._detect_website(description, task_type)
        keyword = self._detect_keyword(description, task_type, website, website_url)

        return StructuredInstructions(
            website=website,
            website_url=website_url,
            action=self._detect_action(task_type),
            keyword=keyword,
            extract=self._detect_extract_target(task_type),
            schedule=schedule,
            task_type=task_type,
            condition=self._detect_condition(description, task_type),
            selectors=self._default_selectors(task_type),
            metadata={"source": "heuristic-interpreter-v3"},
        )

    def _attach_workflow_steps(self, instructions: StructuredInstructions) -> StructuredInstructions:
        metadata = dict(instructions.metadata or {})
        steps = list(instructions.steps or [])
        if not steps:
            steps = self._build_workflow_steps(instructions)
        metadata["workflow_version"] = "steps-v1"
        metadata["step_count"] = len(steps)
        return instructions.model_copy(update={"steps": steps, "metadata": metadata})

    def _build_workflow_steps(self, instructions: StructuredInstructions) -> list[AutomationStep]:
        if instructions.task_type == "PRICE_TRACKER":
            return self._build_price_workflow(instructions)
        if instructions.task_type == "JOB_MONITOR":
            return self._build_listing_workflow(
                instructions,
                fallback_keywords=[instructions.keyword, "job", "role", "remote"],
                item_store="items",
                max_items=8,
            )
        if instructions.task_type == "NEWS_DIGEST":
            topic = instructions.keyword or "AI"
            return self._build_listing_workflow(
                instructions,
                fallback_keywords=[topic, "headline", "news", "story"],
                item_store="items",
                max_items=8,
            )
        return [
            AutomationStep(action="open_url", label="Open target page", url=instructions.website_url),
            AutomationStep(
                action="wait_for",
                label="Wait for page content",
                selectors=instructions.selectors or ["main", "article", "[role='main']", "body"],
                fallback_keywords=[instructions.keyword or instructions.website, instructions.extract],
            ),
            AutomationStep(action="capture_snapshot", label="Capture page snapshot", store_as="snapshot"),
        ]

    def _build_price_workflow(self, instructions: StructuredInstructions) -> list[AutomationStep]:
        profile = self._match_search_site(instructions.website_url)
        steps: list[AutomationStep] = []
        search_url = instructions.website_url
        direct_search = bool(profile and profile.get("prefer_direct_search"))
        search_inputs = self._profile_selectors(profile, "search_input_selectors")
        result_selectors = self._profile_selectors(profile, "result_selectors")
        price_selectors = self._profile_selectors(profile, "price_selectors") or list(instructions.selectors)

        if profile and search_inputs and not direct_search and self._should_use_home_search(search_url):
            steps.extend(
                [
                    AutomationStep(action="open_url", label="Open marketplace", url=self._home_url_from_profile(profile, search_url)),
                    AutomationStep(
                        action="wait_for",
                        label="Wait for search input",
                        selectors=search_inputs,
                        fallback_keywords=[instructions.keyword, "search"],
                    ),
                    AutomationStep(
                        action="type",
                        label="Type product keyword",
                        selectors=search_inputs,
                        value="{{keyword}}",
                        fallback_keywords=[instructions.keyword, "search"],
                    ),
                    AutomationStep(
                        action="press",
                        label="Submit product search",
                        selectors=search_inputs,
                        key="Enter",
                        fallback_keywords=[instructions.keyword, "search"],
                    ),
                ]
            )
        else:
            steps.append(AutomationStep(action="open_url", label="Open product search", url=search_url))

        steps.append(
            AutomationStep(
                action="wait_for",
                label="Wait for search results",
                selectors=result_selectors or price_selectors or instructions.selectors,
                fallback_keywords=[instructions.keyword, "price", "results"],
            )
        )
        steps.append(AutomationStep(action="scroll", label="Load product pricing", value="720"))
        steps.append(
            AutomationStep(
                action="extract_text",
                label="Extract visible price",
                selectors=price_selectors or instructions.selectors,
                fallback_keywords=[instructions.keyword, "price", "amount", "cost"],
                extract_regex=PRICE_REGEX,
                store_as="current_value",
            )
        )
        return steps

    def _build_listing_workflow(
        self,
        instructions: StructuredInstructions,
        *,
        fallback_keywords: list[str],
        item_store: str,
        max_items: int,
    ) -> list[AutomationStep]:
        profile = self._match_search_site(instructions.website_url)
        steps: list[AutomationStep] = []
        direct_search = bool(profile and profile.get("prefer_direct_search"))
        search_inputs = self._profile_selectors(profile, "search_input_selectors")
        result_selectors = self._profile_selectors(profile, "result_selectors")
        list_selectors = self._profile_selectors(profile, "list_selectors") or list(instructions.selectors)
        search_url = instructions.website_url

        if profile and search_inputs and not direct_search and self._should_use_home_search(search_url):
            steps.extend(
                [
                    AutomationStep(action="open_url", label="Open source website", url=self._home_url_from_profile(profile, search_url)),
                    AutomationStep(
                        action="wait_for",
                        label="Wait for search input",
                        selectors=search_inputs,
                        fallback_keywords=[instructions.keyword, "search"],
                    ),
                    AutomationStep(
                        action="type",
                        label="Type search keyword",
                        selectors=search_inputs,
                        value="{{keyword}}",
                        fallback_keywords=[instructions.keyword, "search"],
                    ),
                    AutomationStep(
                        action="press",
                        label="Submit search",
                        selectors=search_inputs,
                        key="Enter",
                        fallback_keywords=[instructions.keyword, "search"],
                    ),
                ]
            )
        else:
            steps.append(AutomationStep(action="open_url", label="Open search page", url=search_url))

        steps.append(
            AutomationStep(
                action="wait_for",
                label="Wait for results",
                selectors=result_selectors or list_selectors or instructions.selectors,
                fallback_keywords=fallback_keywords,
            )
        )
        steps.append(AutomationStep(action="scroll", label="Load more results", value="820"))
        steps.append(
            AutomationStep(
                action="extract_list",
                label="Extract matching items",
                selectors=list_selectors or instructions.selectors,
                fallback_keywords=fallback_keywords,
                store_as=item_store,
                max_items=max_items,
            )
        )
        return steps

    @staticmethod
    def _profile_selectors(profile: dict[str, object] | None, key: str) -> list[str]:
        values = profile.get(key) if profile else None
        return [str(item) for item in values] if isinstance(values, list) else []

    @staticmethod
    def _home_url_from_profile(profile: dict[str, object] | None, fallback_url: str) -> str:
        if profile and isinstance(profile.get("home_url"), str):
            return str(profile["home_url"])
        return TaskInterpreterService._home_url_from_template(fallback_url)

    @staticmethod
    def _home_url_from_template(website_url: str) -> str:
        cleaned = website_url.replace("{query}", "query")
        parsed = urlparse(cleaned)
        if parsed.scheme and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}/"
        return website_url

    @staticmethod
    def _should_use_home_search(website_url: str) -> bool:
        if "{query}" in website_url:
            return True
        parsed = urlparse(website_url)
        if not parsed.scheme or not parsed.netloc:
            return False
        path = (parsed.path or "/").strip()
        return path in {"", "/"}

    @staticmethod
    def _match_search_site(website_url: str) -> dict[str, object] | None:
        cleaned = website_url.replace("{query}", "query")
        host = urlparse(cleaned).netloc.lower()
        if host.startswith("www."):
            host = host[4:]
        for domain, profile in SITE_PROFILES.items():
            if host == domain or host.endswith(f".{domain}"):
                return profile
        return None

    @staticmethod
    def _clean(value: str) -> str:
        return re.sub(r"\s+", " ", value).strip()

    @staticmethod
    def _detect_task_type(description: str) -> str:
        if re.search(r"\bprice|discount|deal|availability\b", description, re.I):
            return "PRICE_TRACKER"
        if re.search(r"\bjob|hiring|vacanc|remote developer|remote role\b", description, re.I):
            return "JOB_MONITOR"
        if re.search(r"\bnews|headlines|digest|stories\b", description, re.I):
            return "NEWS_DIGEST"
        if re.search(r"\bchange|changed|changes|monitor page|watch webpage\b", description, re.I):
            return "PAGE_CHANGE"
        return "WEBSITE_MONITOR"

    @staticmethod
    def _detect_schedule(description: str) -> str:
        if re.search(r"\bhour|hourly|every hour\b", description, re.I):
            return "hourly"
        if re.search(r"\bweek|weekly|every week\b", description, re.I):
            return "weekly"
        return "daily"

    def _detect_website(self, description: str, task_type: str) -> tuple[str, str]:
        direct_url = self._extract_direct_url(description)
        if direct_url:
            website = self._domain_to_label(re.sub(r"^https?://", "", direct_url).split("/")[0])
            return website, direct_url

        bare_domain = self._extract_bare_domain(description)
        if bare_domain:
            matched_site = self._match_known_website(bare_domain)
            if matched_site:
                aliases, label, template = matched_site
                if task_type in {"PAGE_CHANGE", "WEBSITE_MONITOR"}:
                    return label, f"https://{bare_domain.split('/')[0]}"
                return label, template if "{query}" in template else f"https://{bare_domain}"
            return self._domain_to_label(bare_domain), f"https://{bare_domain}"

        lowered = description.lower()
        for aliases, label, template in KNOWN_WEBSITES:
            if any(alias in lowered for alias in aliases):
                if task_type in {"PAGE_CHANGE", "WEBSITE_MONITOR"} and "{query}" in template:
                    primary_domain = next((alias for alias in aliases if "." in alias), aliases[0])
                    return label, f"https://{primary_domain}"
                return label, template

        fallback = {
            "PRICE_TRACKER": ("Price search", f"{DUCKDUCKGO_TEMPLATE}+price"),
            "JOB_MONITOR": ("Remote job search", f"{DUCKDUCKGO_TEMPLATE}+remote+jobs"),
            "NEWS_DIGEST": ("Google News", "https://news.google.com/search?q={query}"),
            "PAGE_CHANGE": ("Target webpage", f"{DUCKDUCKGO_TEMPLATE}+official+site"),
            "WEBSITE_MONITOR": ("Target webpage", f"{DUCKDUCKGO_TEMPLATE}+official+site"),
        }
        return fallback[task_type]

    def _detect_keyword(self, description: str, task_type: str, website: str, website_url: str) -> str:
        quoted_match = re.search(r"[\"']([^\"']{2,120})[\"']", description)
        if quoted_match:
            return self._clean(quoted_match.group(1))

        if task_type in {"PAGE_CHANGE", "WEBSITE_MONITOR"} and self._looks_like_page_url(website_url):
            return website

        cleaned = re.sub(r"https?://[^\s]+", " ", description, flags=re.I)
        cleaned = re.sub(r"\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:/[^\s]*)?\b", " ", cleaned, flags=re.I)
        cleaned = re.sub(
            r"\b(?:every hour|hourly|daily|weekly|every week|every day|every month|every morning|each morning)\b",
            " ",
            cleaned,
            flags=re.I,
        )
        cleaned = re.sub(
            r"\b(?:track|monitor|watch|find|send|notify me if|notify me when|notify me about|alert me if|alert me when|show me|scrape|collect)\b",
            " ",
            cleaned,
            flags=re.I,
        )
        cleaned = re.sub(
            r"\b(?:price|prices|news|headlines|jobs|job listings|changes|change detection|alerts|alert|webpage|website|page)\b",
            " ",
            cleaned,
            flags=re.I,
        )
        for aliases, _, _ in KNOWN_WEBSITES:
            for alias in aliases:
                cleaned = re.sub(rf"\b{re.escape(alias)}\b", " ", cleaned, flags=re.I)

        for pattern in (r"\b(?:on|from|at|for)\b.*$", r"\b(?:if|when)\b.*$"):
            cleaned = re.sub(pattern, " ", cleaned, flags=re.I)

        cleaned = self._clean(cleaned.strip(" ,.-"))
        if cleaned:
            return cleaned
        if task_type == "NEWS_DIGEST":
            return "AI"
        if task_type == "JOB_MONITOR":
            return "remote developer"
        return website

    @staticmethod
    def _detect_extract_target(task_type: str) -> str:
        return {
            "PRICE_TRACKER": "price",
            "JOB_MONITOR": "job_listings",
            "NEWS_DIGEST": "headlines",
            "PAGE_CHANGE": "page_snapshot",
            "WEBSITE_MONITOR": "page_summary",
        }[task_type]

    @staticmethod
    def _detect_action(task_type: str) -> str:
        return {
            "PRICE_TRACKER": "search_product",
            "JOB_MONITOR": "collect_jobs",
            "NEWS_DIGEST": "collect_news",
            "PAGE_CHANGE": "watch_page",
            "WEBSITE_MONITOR": "capture_page",
        }[task_type]

    def _detect_condition(self, description: str, task_type: str) -> str | None:
        if task_type == "PRICE_TRACKER":
            threshold = re.search(r"(?:below|under)\s+\$?([0-9][0-9,\.]*)", description, re.I)
            if threshold:
                return f"notify_when_price_below_{threshold.group(1).replace(',', '')}"
            return "notify_on_price_change"
        if task_type in {"PAGE_CHANGE", "WEBSITE_MONITOR"}:
            return "notify_on_change"
        return "notify_on_new_results"

    @staticmethod
    def _default_selectors(task_type: str) -> list[str]:
        return {
            "PRICE_TRACKER": [
                "[data-testid*='price']",
                "[class*='price']",
                "[id*='price']",
                "[itemprop='price']",
            ],
            "JOB_MONITOR": ["article h2", "article h3", "[data-testid*='job']", "[class*='job']"],
            "NEWS_DIGEST": ["article h1", "article h2", "h1", "h2", "[class*='headline']"],
            "PAGE_CHANGE": ["main", "article", "body"],
            "WEBSITE_MONITOR": ["main", "article", "body"],
        }[task_type]

    @staticmethod
    def _extract_direct_url(description: str) -> str | None:
        direct_url = re.search(r"https?://[^\s]+", description, re.I)
        if not direct_url:
            return None
        return direct_url.group(0).rstrip(".,);")

    @staticmethod
    def _extract_bare_domain(description: str) -> str | None:
        match = re.search(
            r"\b((?:[a-z0-9-]+\.)+(?:com|in|org|net|io|co|ai|app|dev|jobs|news)(?:/[^\s]*)?)\b",
            description,
            re.I,
        )
        if not match:
            return None
        candidate = match.group(1).rstrip(".,);")
        if candidate.lower().startswith("www."):
            return candidate[4:]
        return candidate

    @staticmethod
    def _domain_to_label(domain: str) -> str:
        host = domain.split("/")[0].lower()
        for aliases, label, _ in KNOWN_WEBSITES:
            if any(host == alias or host.endswith(alias) for alias in aliases):
                return label
        return host.replace("-", " ").replace(".", " ").title()

    @staticmethod
    def _match_known_website(domain: str) -> tuple[tuple[str, ...], str, str] | None:
        host = domain.split("/")[0].lower()
        for website in KNOWN_WEBSITES:
            aliases, _, _ = website
            if any(host == alias or host.endswith(alias) for alias in aliases):
                return website
        return None

    @staticmethod
    def _looks_like_page_url(url: str) -> bool:
        return url.startswith("http://") or url.startswith("https://")


def hydrate_website_url(instructions: StructuredInstructions) -> StructuredInstructions:
    query = quote_plus(instructions.keyword or instructions.website)
    data = instructions.model_dump()
    website_url = str(data.get("website_url") or "")
    if "{query}" in website_url:
        data["website_url"] = website_url.format(query=query)

    hydrated_steps: list[dict[str, object]] = []
    for step in data.get("steps", []):
        step_data = dict(step)
        for key in ("url", "value", "text"):
            raw_value = step_data.get(key)
            if isinstance(raw_value, str) and "{query}" in raw_value:
                step_data[key] = raw_value.format(query=query)
        hydrated_steps.append(step_data)
    data["steps"] = hydrated_steps
    return StructuredInstructions(**data)
