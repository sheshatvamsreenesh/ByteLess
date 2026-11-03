# ml-engine/src/collect_pages.py
# ─────────────────────────────────────────────────────────────────────────────
# ByteLess Adaptive Intelligence Engine — Webpage Collection Module
#
# PURPOSE
# ───────
# Fetch a pre-approved list of public webpages and save:
#   • Raw HTML → data/raw/html/<page_id>.html
#   • Collection metadata → data/raw/metadata/<page_id>.json
#   • Summary record → data/processed/pages.csv  (one row per page)
#
# WHAT THIS SCRIPT DOES NOT DO
# ─────────────────────────────
# • It does NOT execute JavaScript (we use plain HTTP requests).
# • It does NOT download images, CSS files, or other resources.
# • It does NOT bypass robots.txt, paywalls, or rate limits.
# • It does NOT collect private or authenticated content.
# • It does NOT crawl links found on fetched pages.
# • It does NOT invent or fabricate webpage content.
#
# HOW TO USE
# ──────────
# Do NOT call this file directly.  Use the wrapper:
#   python scripts/run_collection.py
#
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import csv
import hashlib
import json
import logging
import re
import time
import urllib.robotparser
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from config import (
    ANNOTATIONS_CSV,
    FEATURE_EXTRACTION_VERSION,
    MAX_HTML_SIZE_MB,
    MAX_RETRIES,
    PAGES_CSV,
    RAW_HTML_DIR,
    RAW_META_DIR,
    REQUEST_DELAY_SECONDS,
    RETRY_BACKOFF_SECONDS,
    TIMEOUT_SECONDS,
    USER_AGENT,
)

# ── Logging Setup ─────────────────────────────────────────────────────────────
# We log to both the console and a file so you can review what happened.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("collect_pages")

# ── Constants ─────────────────────────────────────────────────────────────────
# Column order for pages.csv — must match the header created in Task 2.
PAGES_CSV_COLUMNS = [
    "page_id",
    "url",
    "domain",
    "category",
    "collection_date",
    "http_status",
    "fetch_success",
    "content_type",
    "final_url",
    "duplicate_group",
    "robots_allowed",
    "collection_notes",
]

# Valid category strings (must match url_config.yaml choices).
VALID_CATEGORIES = {
    "news_and_articles",
    "ecommerce",
    "technical_documentation",
    "educational_content",
    "government_and_public_services",
    "forums_and_reference",
}

# ─────────────────────────────────────────────────────────────────────────────
# SECTION 1 — Robots.txt Checker
# ─────────────────────────────────────────────────────────────────────────────

# We cache robots.txt results so we don't re-fetch the same domain's
# robots.txt file multiple times in one collection run.
_robots_cache: dict[str, urllib.robotparser.RobotFileParser] = {}


def _get_robot_parser(domain_root: str) -> Optional[urllib.robotparser.RobotFileParser]:
    """
    Download and parse robots.txt for the given domain root URL.

    Parameters
    ----------
    domain_root : str
        The scheme + domain, e.g. "https://example.com"

    Returns
    -------
    RobotFileParser on success, None if robots.txt could not be fetched
    (in which case the caller should treat the page as disallowed to be safe).
    """
    if domain_root in _robots_cache:
        return _robots_cache[domain_root]

    robots_url = f"{domain_root}/robots.txt"
    try:
        rp = urllib.robotparser.RobotFileParser()
        rp.set_url(robots_url)
        # urllib's read() uses its own HTTP client — we set a short timeout
        # by monkey-patching urllib.request is messy, so we fetch manually.
        response = requests.get(
            robots_url,
            headers={"User-Agent": USER_AGENT},
            timeout=10,
        )
        if response.status_code == 200:
            rp.parse(response.text.splitlines())
        elif response.status_code == 404:
            # No robots.txt → treat as fully allowed (standard interpretation).
            log.info("No robots.txt at %s (404) — treating as allowed.", robots_url)
            rp.parse([])  # empty → allow all
        else:
            # Any other status (403, 5xx, etc.) → treat as disallowed to be safe.
            log.warning(
                "robots.txt at %s returned HTTP %d — treating as disallowed.",
                robots_url,
                response.status_code,
            )
            _robots_cache[domain_root] = None
            return None

        _robots_cache[domain_root] = rp
        return rp

    except Exception as exc:
        log.warning(
            "Could not fetch robots.txt for %s: %s — treating as disallowed.",
            domain_root,
            exc,
        )
        _robots_cache[domain_root] = None
        return None


def is_robots_allowed(url: str) -> tuple[bool, str]:
    """
    Check whether our crawler is allowed to fetch the given URL.

    Returns
    -------
    (allowed: bool, reason: str)
        allowed = True  → safe to proceed
        allowed = False → skip this URL and record the reason
    """
    parsed = urlparse(url)
    domain_root = f"{parsed.scheme}://{parsed.netloc}"

    rp = _get_robot_parser(domain_root)
    if rp is None:
        return False, "Could not fetch or parse robots.txt"

    allowed = rp.can_fetch(USER_AGENT, url)
    if allowed:
        return True, "robots.txt allows access"
    else:
        return False, f"robots.txt disallows crawling {url}"


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 2 — HTTP Session
# ─────────────────────────────────────────────────────────────────────────────


def _build_session() -> requests.Session:
    """
    Create a requests Session with:
    • Our descriptive User-Agent header.
    • Automatic retries for connection errors and server errors (5xx).
    • A retry limit (MAX_RETRIES from config.py).

    NOTE: We do NOT retry on 4xx errors.  A 403 Forbidden or 429 Too Many
    Requests means the server is explicitly rejecting us — retrying would
    be rude and potentially a ToS violation.
    """
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    # Retry only on connection-level errors and 500/502/503/504 server errors.
    retry_strategy = Retry(
        total=MAX_RETRIES,
        backoff_factor=RETRY_BACKOFF_SECONDS,
        status_forcelist=[500, 502, 503, 504],
        allowed_methods=["GET"],
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry_strategy)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 3 — Page ID Generation
# ─────────────────────────────────────────────────────────────────────────────


def _generate_page_id(url: str, collection_timestamp: str) -> str:
    """
    Generate a stable, unique page identifier.

    We hash the URL + timestamp so that:
    • The same URL collected at different times gets different IDs.
    • IDs are short and filesystem-safe.
    • IDs are deterministic (reproducible from the same inputs).

    Format: "pg_<8-char hex>"
    Example: "pg_3a7f2c91"
    """
    raw = f"{url}|{collection_timestamp}"
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return f"pg_{digest[:8]}"


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 4 — Single-Page Fetch
# ─────────────────────────────────────────────────────────────────────────────


def fetch_page(
    session: requests.Session,
    url: str,
    category: str,
) -> dict:
    """
    Attempt to fetch one webpage and save its HTML + metadata.

    Parameters
    ----------
    session  : active requests.Session (shared across the batch)
    url      : the URL to fetch
    category : the page's dataset category string

    Returns
    -------
    A dict with all fields needed for one row of pages.csv.
    The dict is fully populated even when the fetch fails, so the caller can
    always write a row and understand what happened.
    """
    timestamp = datetime.now(timezone.utc).isoformat()
    page_id = _generate_page_id(url, timestamp)

    # Default result — populated progressively below.
    result = {
        "page_id": page_id,
        "url": url,
        "domain": urlparse(url).netloc,
        "category": category,
        "collection_date": timestamp,
        "http_status": None,
        "fetch_success": False,
        "content_type": None,
        "final_url": url,
        "duplicate_group": None,
        "robots_allowed": None,
        "collection_notes": "",
    }

    # ── Step 1: robots.txt check ──────────────────────────────────────────
    log.info("[%s] Checking robots.txt for %s", page_id, url)
    allowed, robots_reason = is_robots_allowed(url)
    result["robots_allowed"] = allowed

    if not allowed:
        result["collection_notes"] = f"SKIPPED: {robots_reason}"
        log.warning("[%s] Skipping %s — %s", page_id, url, robots_reason)
        _append_page_record(result)
        return result

    # ── Step 2: HTTP GET ──────────────────────────────────────────────────
    log.info("[%s] Fetching %s", page_id, url)
    try:
        response = session.get(
            url,
            timeout=TIMEOUT_SECONDS,
            allow_redirects=True,
            stream=False,
        )
    except requests.exceptions.TooManyRedirects:
        result["collection_notes"] = "FAILED: Too many redirects"
        log.error("[%s] Too many redirects for %s", page_id, url)
        _append_page_record(result)
        return result
    except requests.exceptions.Timeout:
        result["collection_notes"] = f"FAILED: Timed out after {TIMEOUT_SECONDS}s"
        log.error("[%s] Timeout for %s", page_id, url)
        _append_page_record(result)
        return result
    except requests.exceptions.ConnectionError as exc:
        result["collection_notes"] = f"FAILED: Connection error — {exc}"
        log.error("[%s] Connection error for %s: %s", page_id, url, exc)
        _append_page_record(result)
        return result
    except requests.exceptions.RequestException as exc:
        result["collection_notes"] = f"FAILED: Request error — {exc}"
        log.error("[%s] Request error for %s: %s", page_id, url, exc)
        _append_page_record(result)
        return result

    result["http_status"] = response.status_code
    result["final_url"] = response.url

    # ── Step 3: Retry-After handling ──────────────────────────────────────
    if response.status_code == 429:
        retry_after = response.headers.get("Retry-After", "unknown")
        result["collection_notes"] = (
            f"SKIPPED: HTTP 429 Too Many Requests. "
            f"Retry-After header: {retry_after}. "
            "Increase REQUEST_DELAY_SECONDS in config.py and retry later."
        )
        log.warning("[%s] Rate-limited (429) for %s. Retry-After: %s", page_id, url, retry_after)
        _append_page_record(result)
        return result

    # ── Step 4: Non-success status codes ─────────────────────────────────
    if response.status_code != 200:
        result["collection_notes"] = f"FAILED: HTTP {response.status_code}"
        log.warning("[%s] HTTP %d for %s", page_id, response.status_code, url)
        _append_page_record(result)
        return result

    # ── Step 5: Content-Type check ────────────────────────────────────────
    content_type = response.headers.get("Content-Type", "")
    result["content_type"] = content_type

    if "text/html" not in content_type.lower():
        result["collection_notes"] = (
            f"SKIPPED: Content-Type is '{content_type}', expected text/html"
        )
        log.warning(
            "[%s] Unexpected content-type '%s' for %s", page_id, content_type, url
        )
        _append_page_record(result)
        return result

    # ── Step 6: Size guard ────────────────────────────────────────────────
    html_text = response.text
    html_size_mb = len(html_text.encode("utf-8")) / (1024 * 1024)
    if html_size_mb > MAX_HTML_SIZE_MB:
        result["collection_notes"] = (
            f"SKIPPED: HTML size {html_size_mb:.1f} MB exceeds "
            f"MAX_HTML_SIZE_MB={MAX_HTML_SIZE_MB}"
        )
        log.warning(
            "[%s] HTML too large (%.1f MB) for %s", page_id, html_size_mb, url
        )
        _append_page_record(result)
        return result

    # ── Step 7: Save raw HTML ─────────────────────────────────────────────
    RAW_HTML_DIR.mkdir(parents=True, exist_ok=True)
    html_path = RAW_HTML_DIR / f"{page_id}.html"
    html_path.write_text(html_text, encoding="utf-8", errors="replace")
    log.info("[%s] Saved HTML (%d bytes) → %s", page_id, len(html_text), html_path.name)

    # ── Step 8: Save metadata JSON ────────────────────────────────────────
    metadata = {
        "page_id": page_id,
        "url": url,
        "final_url": response.url,
        "domain": urlparse(url).netloc,
        "category": category,
        "collection_date": timestamp,
        "http_status": response.status_code,
        "content_type": content_type,
        "response_headers": dict(response.headers),
        "html_file": str(html_path),
        "html_size_bytes": len(html_text.encode("utf-8")),
        "fetch_success": True,
        "feature_extraction_version": FEATURE_EXTRACTION_VERSION,
    }
    RAW_META_DIR.mkdir(parents=True, exist_ok=True)
    meta_path = RAW_META_DIR / f"{page_id}.json"
    meta_path.write_text(json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8")
    log.info("[%s] Saved metadata → %s", page_id, meta_path.name)

    # ── Step 9: Mark success ──────────────────────────────────────────────
    result["fetch_success"] = True
    result["collection_notes"] = "OK"
    _append_page_record(result)
    return result


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 5 — CSV Writer
# ─────────────────────────────────────────────────────────────────────────────


def _append_page_record(record: dict) -> None:
    """
    Append one record to pages.csv.

    We append (rather than overwrite) so that if collection is interrupted
    mid-batch, already-collected pages are not lost.

    The header row is only written if the file is new/empty.
    """
    PAGES_CSV.parent.mkdir(parents=True, exist_ok=True)
    write_header = not PAGES_CSV.exists() or PAGES_CSV.stat().st_size == 0

    with PAGES_CSV.open("a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=PAGES_CSV_COLUMNS, extrasaction="ignore")
        if write_header:
            writer.writeheader()
        writer.writerow(record)


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 6 — Batch Collection
# ─────────────────────────────────────────────────────────────────────────────


def collect_batch(page_configs: list[dict]) -> list[dict]:
    """
    Fetch a batch of pre-approved pages.

    Parameters
    ----------
    page_configs : list of dicts, each with keys:
        url      (str)  — the URL to fetch
        category (str)  — one of VALID_CATEGORIES
        approved (bool) — must be True or the page is skipped
        notes    (str)  — free-text reviewer note (stored but not used by script)

    Returns
    -------
    List of result dicts (one per input entry), in order.
    """
    session = _build_session()
    results = []
    approved_count = 0
    skipped_unapproved = 0

    log.info("═" * 60)
    log.info("ByteLess Collection Run — %d entries in config", len(page_configs))
    log.info("═" * 60)

    for i, cfg in enumerate(page_configs, start=1):
        url = (cfg.get("url") or "").strip()
        category = (cfg.get("category") or "").strip()
        approved = bool(cfg.get("approved", False))
        reviewer_notes = cfg.get("notes", "")

        log.info("─" * 60)
        log.info("Entry %d/%d: %s", i, len(page_configs), url or "(empty URL)")

        # ── Guard: empty URL ──────────────────────────────────────────────
        if not url:
            log.info("  ↳ Skipping: URL is empty (template placeholder).")
            skipped_unapproved += 1
            continue

        # ── Guard: not approved ───────────────────────────────────────────
        if not approved:
            log.info(
                "  ↳ Skipping: approved=false. "
                "Review the URL and set approved: true in url_config.yaml."
            )
            skipped_unapproved += 1
            continue

        # ── Guard: invalid category ───────────────────────────────────────
        if category not in VALID_CATEGORIES:
            log.warning(
                "  ↳ Skipping: category '%s' is not recognised. "
                "Valid options: %s",
                category,
                ", ".join(sorted(VALID_CATEGORIES)),
            )
            skipped_unapproved += 1
            continue

        # ── Guard: URL must start with http(s) ────────────────────────────
        if not re.match(r"^https?://", url, re.IGNORECASE):
            log.warning("  ↳ Skipping: URL does not start with http:// or https://")
            skipped_unapproved += 1
            continue

        approved_count += 1
        result = fetch_page(session, url, category)
        results.append(result)

        # ── Polite delay ──────────────────────────────────────────────────
        if i < len(page_configs):
            log.info("  Waiting %ds before next request …", REQUEST_DELAY_SECONDS)
            time.sleep(REQUEST_DELAY_SECONDS)

    session.close()

    # ── Summary ───────────────────────────────────────────────────────────
    successes = sum(1 for r in results if r.get("fetch_success"))
    failures = len(results) - successes

    log.info("═" * 60)
    log.info("Collection complete.")
    log.info("  Entries in config    : %d", len(page_configs))
    log.info("  Skipped (unapproved) : %d", skipped_unapproved)
    log.info("  Attempted            : %d", approved_count)
    log.info("  Successful           : %d", successes)
    log.info("  Failed / Skipped     : %d", failures)
    log.info("  pages.csv            : %s", PAGES_CSV)
    log.info("═" * 60)

    return results

