# ml-engine/src/extract_features.py
# ─────────────────────────────────────────────────────────────────────────────
# ByteLess Adaptive Intelligence Engine — Feature Extraction Pipeline
#
# PURPOSE
# ───────
# For each successfully collected HTML page, parse the saved .html file and
# compute every feature defined in data/processed/features.csv.
#
# IMPORTANT LIMITATIONS (read before using the output)
# ─────────────────────────────────────────────────────
# 1. STATIC HTML ONLY — We analyse the raw HTML returned by the server.
#    JavaScript-rendered content is NOT captured.  Some modern pages (SPAs)
#    may appear almost empty in their raw HTML.
#
# 2. RESOURCE SIZES ARE ESTIMATES — We do NOT download images, stylesheets,
#    or scripts.  Sizes declared in HTML attributes (width/height/data-size)
#    are extracted when available.  Missing sizes are stored as NaN, never
#    as zero.  The field `estimated_page_weight_kb` is therefore a rough
#    lower bound based only on the HTML itself.
#
# 3. THIRD-PARTY DETECTION IS HEURISTIC — A resource is "third-party" when
#    its host does not match or is not a subdomain of the page's own domain.
#    CDN subdomains of the same company may be incorrectly classified.
#
# 4. NO SCRIPT EXECUTION — We never run any JavaScript.
#
# 5. NO SAFETY CLASSIFICATION — We do NOT classify scripts as "safe" or
#    "unsafe" based on filenames or counts.  That is the annotator's job.
#
# HOW TO USE
# ──────────
# Do NOT call this file directly.  Use the wrapper:
#   python scripts/run_feature_extraction.py
#
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import csv
import json
import logging
import math
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

from bs4 import BeautifulSoup

from config import (
    FEATURE_EXTRACTION_VERSION,
    FEATURES_CSV,
    LARGE_IMAGE_THRESHOLD_KB,
    RAW_HTML_DIR,
    RAW_META_DIR,
)

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("extract_features")

# ── CSV Columns ───────────────────────────────────────────────────────────────
# Must exactly match the header in data/processed/features.csv.
FEATURES_CSV_COLUMNS = [
    "page_id",
    "feature_extraction_version",
    "collected_at",
    "html_size_kb",
    "dom_element_count",
    "dom_depth_max",
    "text_size_kb",
    "text_to_html_ratio",
    "image_count",
    "total_image_size_kb",
    "avg_image_size_kb",
    "large_image_count",
    "images_with_alt_ratio",
    "image_dimension_variation",
    "script_count",
    "external_script_count",
    "third_party_script_count",
    "css_file_count",
    "inline_style_size_kb",
    "heading_count",
    "paragraph_count",
    "table_count",
    "code_block_count",
    "blockquote_count",
    "link_count",
    "video_embed_count",
    "total_resource_count",
    "third_party_resource_count",
    "estimated_page_weight_kb",
    "resource_type_diversity",
]

# Sentinel for "we could not measure this value".
# Written as an empty string in CSV so pandas reads it as NaN.
MISSING = ""


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 1 — Helper: DOM depth
# ─────────────────────────────────────────────────────────────────────────────


def _compute_dom_depth(soup: BeautifulSoup) -> int:
    """
    Return the maximum nesting depth of HTML elements in the parsed tree.

    We do an iterative depth-first traversal to avoid hitting Python's
    recursion limit on very deeply nested pages.

    Depth is measured from the root tag (depth = 0).
    A document with only <html><body><p>text</p></body></html>
    has a max depth of 3 (html→body→p).
    """
    root = soup.find()  # first real tag
    if root is None:
        return 0

    max_depth = 0
    # Stack entries: (element, current_depth)
    stack = [(root, 0)]

    while stack:
        element, depth = stack.pop()
        max_depth = max(max_depth, depth)
        for child in element.children:
            if hasattr(child, "children"):  # it's a Tag, not a NavigableString
                stack.append((child, depth + 1))

    return max_depth


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 2 — Helper: third-party detection
# ─────────────────────────────────────────────────────────────────────────────


def _is_third_party(resource_url: str, page_domain: str) -> bool:
    """
    Return True if resource_url's registered domain differs from page_domain.

    We use a simple heuristic: extract the last two dot-separated parts of
    each hostname (e.g. "cdn.example.com" → "example.com") and compare.
    This correctly handles subdomains but may mis-classify some CDNs.
    """
    if not resource_url or resource_url.startswith("data:"):
        return False  # inline data URI → same page
    if resource_url.startswith("//"):
        resource_url = "https:" + resource_url

    parsed = urlparse(resource_url)
    if not parsed.netloc:
        # Relative URL → same domain
        return False

    def _root_domain(host: str) -> str:
        parts = host.split(".")
        return ".".join(parts[-2:]) if len(parts) >= 2 else host

    return _root_domain(parsed.netloc) != _root_domain(page_domain)


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 3 — Helper: image dimension extraction
# ─────────────────────────────────────────────────────────────────────────────


def _parse_px(value: str) -> Optional[float]:
    """
    Try to extract a numeric pixel value from an HTML attribute string.
    Handles "300", "300px", "50%" (ignored), etc.
    Returns None if the value cannot be parsed as pixels.
    """
    if not value:
        return None
    value = value.strip().lower()
    # Remove "px" suffix if present
    value = re.sub(r"px$", "", value)
    try:
        v = float(value)
        return v if v > 0 else None
    except ValueError:
        return None


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 4 — Core feature extractor
# ─────────────────────────────────────────────────────────────────────────────


def extract_features(page_id: str) -> Optional[dict]:
    """
    Parse the saved HTML for `page_id` and return a feature dict.

    Returns None (and logs a warning) if the HTML file does not exist.
    On partial extraction failures, individual features are set to MISSING
    rather than raising an exception — we always write a row.
    """
    html_path = RAW_HTML_DIR / f"{page_id}.html"
    meta_path = RAW_META_DIR / f"{page_id}.json"

    if not html_path.exists():
        log.warning("[%s] HTML file not found: %s", page_id, html_path)
        return None

    # ── Load raw HTML ─────────────────────────────────────────────────────
    html_text = html_path.read_text(encoding="utf-8", errors="replace")
    html_size_kb = round(len(html_text.encode("utf-8")) / 1024, 3)

    # ── Load metadata (for domain info) ───────────────────────────────────
    page_domain = ""
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            page_domain = meta.get("domain", "")
        except Exception:
            pass  # missing metadata is not fatal

    # ── Parse with BeautifulSoup ──────────────────────────────────────────
    # We use lxml as the parser because it is fast and tolerant of malformed
    # HTML.  If lxml is not installed, BeautifulSoup falls back to html.parser.
    try:
        soup = BeautifulSoup(html_text, "lxml")
    except Exception:
        try:
            soup = BeautifulSoup(html_text, "html.parser")
        except Exception as exc:
            log.error("[%s] Failed to parse HTML: %s", page_id, exc)
            return None

    log.info("[%s] Parsed HTML (%.1f KB)", page_id, html_size_kb)

    # ── Initialise feature dict with MISSING for all numeric fields ────────
    feats: dict = {col: MISSING for col in FEATURES_CSV_COLUMNS}
    feats["page_id"] = page_id
    feats["feature_extraction_version"] = FEATURE_EXTRACTION_VERSION
    feats["collected_at"] = datetime.now(timezone.utc).isoformat()
    feats["html_size_kb"] = html_size_kb

    # ═══════════════════════════════════════════════════════════════════════
    # DOM STRUCTURE
    # ═══════════════════════════════════════════════════════════════════════

    # Total element count (every HTML tag, not text nodes)
    all_elements = soup.find_all(True)
    feats["dom_element_count"] = len(all_elements)

    # Maximum DOM nesting depth
    feats["dom_depth_max"] = _compute_dom_depth(soup)

    # ═══════════════════════════════════════════════════════════════════════
    # TEXT CONTENT
    # ═══════════════════════════════════════════════════════════════════════

    # get_text() extracts visible text (excludes script/style tags by default
    # when using BeautifulSoup's internal mechanics — but we explicitly remove
    # script and style to be safe).
    for tag in soup.find_all(["script", "style"]):
        tag.decompose()  # remove in-place so get_text is cleaner

    # Re-parse after decompose (soup already mutated in-place)
    visible_text = soup.get_text(separator=" ", strip=True)
    text_size_bytes = len(visible_text.encode("utf-8"))
    text_size_kb = round(text_size_bytes / 1024, 3)
    feats["text_size_kb"] = text_size_kb

    # text_to_html_ratio: how much of the page's raw size is actual text.
    # Close to 1.0 → mostly text.  Close to 0 → mostly markup/scripts.
    html_size_bytes = len(html_text.encode("utf-8"))
    if html_size_bytes > 0:
        feats["text_to_html_ratio"] = round(text_size_bytes / html_size_bytes, 4)

    # ═══════════════════════════════════════════════════════════════════════
    # IMAGES
    # ═══════════════════════════════════════════════════════════════════════

    # NOTE: We re-parse the original HTML (before decompose mutated soup)
    # for images.  Since we already decomposed scripts/styles, img tags
    # are still present.  Use `html_text` for a fresh parse if needed.
    img_soup = BeautifulSoup(html_text, "lxml")
    images = img_soup.find_all("img")

    image_count = len(images)
    feats["image_count"] = image_count

    images_with_alt = sum(
        1 for img in images if img.get("alt") is not None and img.get("alt") != ""
    )
    if image_count > 0:
        feats["images_with_alt_ratio"] = round(images_with_alt / image_count, 4)

    # Collect image areas (width × height) from HTML attributes where available.
    # We do NOT download images to determine actual file sizes.
    image_areas = []
    large_image_count = 0

    for img in images:
        w_str = img.get("width", "") or img.get("data-width", "")
        h_str = img.get("height", "") or img.get("data-height", "")
        w = _parse_px(str(w_str))
        h = _parse_px(str(h_str))
        if w is not None and h is not None:
            area = w * h
            image_areas.append(area)
            # Heuristic: a 600×200 image ≈ 120,000 px² → roughly "large"
            # This is an approximation; actual file size depends on encoding.
            # LARGE_IMAGE_THRESHOLD_KB (from config) is used here symbolically.
            # We flag images whose declared pixel area > 90,000 px² (≈ 300×300)
            # as "large" because they are likely to be visually significant.
            if area > 90_000:
                large_image_count += 1

    feats["large_image_count"] = large_image_count

    # Image dimension variation: std-dev of image areas as a proxy for
    # whether the page mixes many different image sizes (diverse) or uses
    # uniform thumbnail grids (low variation).
    if len(image_areas) >= 2:
        mean_area = sum(image_areas) / len(image_areas)
        variance = sum((a - mean_area) ** 2 for a in image_areas) / len(image_areas)
        feats["image_dimension_variation"] = round(math.sqrt(variance), 2)
    # else: remains MISSING (not enough dimension data)

    # total_image_size_kb, avg_image_size_kb:
    # We do NOT download images.  These cannot be determined from HTML alone.
    # Left as MISSING.  Do not substitute zero.

    # ═══════════════════════════════════════════════════════════════════════
    # SCRIPTS
    # ═══════════════════════════════════════════════════════════════════════

    # Re-use img_soup (which still has <script> tags intact).
    scripts = img_soup.find_all("script")
    script_count = len(scripts)
    feats["script_count"] = script_count

    external_script_count = 0
    third_party_script_count = 0
    for script in scripts:
        src = script.get("src", "")
        if src:
            external_script_count += 1
            if _is_third_party(src, page_domain):
                third_party_script_count += 1

    feats["external_script_count"] = external_script_count
    feats["third_party_script_count"] = third_party_script_count

    # ═══════════════════════════════════════════════════════════════════════
    # STYLESHEETS AND INLINE STYLES
    # ═══════════════════════════════════════════════════════════════════════

    css_links = img_soup.find_all("link", rel=lambda r: r and "stylesheet" in r)
    feats["css_file_count"] = len(css_links)

    inline_styles = img_soup.find_all("style")
    inline_style_text = " ".join(s.get_text() for s in inline_styles)
    feats["inline_style_size_kb"] = round(len(inline_style_text.encode("utf-8")) / 1024, 3)

    # ═══════════════════════════════════════════════════════════════════════
    # STRUCTURAL CONTENT ELEMENTS
    # ═══════════════════════════════════════════════════════════════════════

    feats["heading_count"] = len(img_soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6"]))
    feats["paragraph_count"] = len(img_soup.find_all("p"))
    feats["table_count"] = len(img_soup.find_all("table"))
    feats["code_block_count"] = len(img_soup.find_all(["code", "pre"]))
    feats["blockquote_count"] = len(img_soup.find_all("blockquote"))
    feats["link_count"] = len(img_soup.find_all("a", href=True))

    # Video embeds: <video>, <iframe> with known video domains, <embed>
    video_tags = img_soup.find_all("video")
    iframe_videos = [
        t for t in img_soup.find_all("iframe")
        if any(
            domain in (t.get("src") or "")
            for domain in ["youtube.com", "youtu.be", "vimeo.com", "dailymotion.com"]
        )
    ]
    embed_tags = img_soup.find_all("embed")
    feats["video_embed_count"] = len(video_tags) + len(iframe_videos) + len(embed_tags)

    # ═══════════════════════════════════════════════════════════════════════
    # RESOURCE INVENTORY
    # ═══════════════════════════════════════════════════════════════════════

    # Collect all external resource references (not downloaded — just counted).
    resource_types_seen: set[str] = set()
    all_resources: list[tuple[str, str]] = []  # (type, url)

    for img in images:
        src = img.get("src", "")
        if src:
            all_resources.append(("image", src))
            resource_types_seen.add("image")

    for script in scripts:
        src = script.get("src", "")
        if src:
            all_resources.append(("script", src))
            resource_types_seen.add("script")

    for link in img_soup.find_all("link"):
        href = link.get("href", "")
        rel = link.get("rel", [])
        if isinstance(rel, str):
            rel = [rel]
        rtype = "stylesheet" if "stylesheet" in rel else "link_resource"
        if href:
            all_resources.append((rtype, href))
            resource_types_seen.add(rtype)

    for source in img_soup.find_all("source"):
        src = source.get("src", "") or source.get("srcset", "")
        if src:
            all_resources.append(("media_source", src))
            resource_types_seen.add("media_source")

    feats["total_resource_count"] = len(all_resources)
    feats["resource_type_diversity"] = len(resource_types_seen)

    # Third-party resource count
    tp_count = sum(
        1 for rtype, rurl in all_resources
        if _is_third_party(rurl, page_domain)
    )
    feats["third_party_resource_count"] = tp_count

    # estimated_page_weight_kb:
    # This is ONLY the HTML file size — it does NOT include images, scripts,
    # fonts, or stylesheets because we do not download those resources.
    # Label this clearly in any report or model card.
    feats["estimated_page_weight_kb"] = html_size_kb  # HTML only

    log.info(
        "[%s] Features extracted — %d elements, %d images, %d scripts",
        page_id,
        feats["dom_element_count"],
        feats["image_count"],
        feats["script_count"],
    )

    return feats


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 5 — CSV Writer
# ─────────────────────────────────────────────────────────────────────────────


def _append_feature_record(record: dict) -> None:
    """Append one feature row to features.csv (writes header if file is new)."""
    FEATURES_CSV.parent.mkdir(parents=True, exist_ok=True)
    write_header = not FEATURES_CSV.exists() or FEATURES_CSV.stat().st_size == 0

    with FEATURES_CSV.open("a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FEATURES_CSV_COLUMNS, extrasaction="ignore")
        if write_header:
            writer.writeheader()
        writer.writerow(record)


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 6 — Batch runner
# ─────────────────────────────────────────────────────────────────────────────


def extract_features_for_batch(page_ids: list[str]) -> dict[str, bool]:
    """
    Extract and save features for a list of page IDs.

    Parameters
    ----------
    page_ids : list of page_id strings (e.g. ["pg_3a7f2c91", ...])

    Returns
    -------
    Dict mapping page_id → True (success) / False (failed / missing HTML).
    """
    results = {}
    log.info("═" * 60)
    log.info("Feature Extraction — %d pages", len(page_ids))
    log.info("═" * 60)

    for i, page_id in enumerate(page_ids, start=1):
        log.info("─" * 60)
        log.info("Extracting %d/%d: %s", i, len(page_ids), page_id)
        feats = extract_features(page_id)
        if feats is not None:
            _append_feature_record(feats)
            results[page_id] = True
        else:
            results[page_id] = False

    successes = sum(results.values())
    log.info("═" * 60)
    log.info("Extraction complete: %d/%d succeeded.", successes, len(page_ids))
    log.info("features.csv → %s", FEATURES_CSV)
    log.info("═" * 60)

    return results

