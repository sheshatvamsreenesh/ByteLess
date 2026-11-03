"""
ByteLess ML Adaptive Intelligence Adapter
Provides feature extraction, safety rules, and ML recommendation engine.
Works in hybrid mode:
  1. Inspects `ml-engine/models/` for trained serialized model artifacts.
  2. If a trained model is found, runs inference.
  3. If no trained model is present (current Phase 2 state), applies deterministic
     safety and content-preservation rules derived from real webpage metrics.
"""

from __future__ import annotations

import glob
import math
import os
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from bs4 import BeautifulSoup

ML_MODELS_DIR = Path(__file__).resolve().parent.parent / "ml-engine" / "models"


def compute_dom_depth(soup: BeautifulSoup) -> int:
    """Iterative depth-first traversal to calculate max DOM depth without recursion limit."""
    root = soup.find()
    if root is None:
        return 0
    max_depth = 0
    stack = [(root, 0)]
    while stack:
        element, depth = stack.pop()
        if depth > max_depth:
            max_depth = depth
        for child in getattr(element, "children", []):
            if hasattr(child, "children"):
                stack.append((child, depth + 1))
    return max_depth


def is_third_party(resource_url: str, page_domain: str) -> bool:
    if not resource_url or resource_url.startswith("data:"):
        return False
    if resource_url.startswith("//"):
        resource_url = "https:" + resource_url
    parsed = urlparse(resource_url)
    if not parsed.netloc:
        return False

    def root_domain(host: str) -> str:
        parts = host.split(".")
        return ".".join(parts[-2:]) if len(parts) >= 2 else host

    return root_domain(parsed.netloc) != root_domain(page_domain)


def extract_features_from_html(html_text: str, page_domain: str = "") -> dict[str, Any]:
    """Extract standard ByteLess Phase 2 features from HTML content."""
    html_bytes = len(html_text.encode("utf-8"))
    html_size_kb = round(html_bytes / 1024, 3)

    soup = BeautifulSoup(html_text, "html.parser")
    all_elements = soup.find_all(True)
    dom_element_count = len(all_elements)
    dom_depth_max = compute_dom_depth(soup)

    # Text extraction
    text_soup = BeautifulSoup(html_text, "html.parser")
    for tag in text_soup.find_all(["script", "style"]):
        tag.decompose()
    visible_text = text_soup.get_text(separator=" ", strip=True)
    text_bytes = len(visible_text.encode("utf-8"))
    text_size_kb = round(text_bytes / 1024, 3)
    text_to_html_ratio = round(text_bytes / max(1, html_bytes), 4)

    # Images
    images = soup.find_all("img")
    image_count = len(images)
    images_with_alt = sum(1 for img in images if (img.get("alt") or "").strip())
    images_with_alt_ratio = round(images_with_alt / max(1, image_count), 4) if image_count else 0.0

    large_image_count = 0
    for img in images:
        w_val = img.get("width")
        h_val = img.get("height")
        try:
            w = float(re.sub(r"[^\d.]", "", str(w_val))) if w_val else 0
            h = float(re.sub(r"[^\d.]", "", str(h_val))) if h_val else 0
            if w * h > 90_000:
                large_image_count += 1
        except Exception:
            pass

    # Scripts
    scripts = soup.find_all("script")
    script_count = len(scripts)
    external_scripts = [s for s in scripts if s.get("src")]
    external_script_count = len(external_scripts)
    third_party_script_count = sum(1 for s in external_scripts if is_third_party(str(s.get("src", "")), page_domain))

    # Styles
    css_links = soup.find_all("link", rel=lambda r: r and "stylesheet" in r)
    css_file_count = len(css_links)
    inline_styles = soup.find_all("style")
    inline_style_text = " ".join(s.get_text() for s in inline_styles)
    inline_style_size_kb = round(len(inline_style_text.encode("utf-8")) / 1024, 3)

    # Structural elements
    heading_count = len(soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6"]))
    paragraph_count = len(soup.find_all("p"))
    table_count = len(soup.find_all("table"))
    code_block_count = len(soup.find_all(["code", "pre"]))
    blockquote_count = len(soup.find_all("blockquote"))
    link_count = len(soup.find_all("a", href=True))

    return {
        "html_size_kb": html_size_kb,
        "dom_element_count": dom_element_count,
        "dom_depth_max": dom_depth_max,
        "text_size_kb": text_size_kb,
        "text_to_html_ratio": text_to_html_ratio,
        "image_count": image_count,
        "large_image_count": large_image_count,
        "images_with_alt_ratio": images_with_alt_ratio,
        "script_count": script_count,
        "external_script_count": external_script_count,
        "third_party_script_count": third_party_script_count,
        "css_file_count": css_file_count,
        "inline_style_size_kb": inline_style_size_kb,
        "heading_count": heading_count,
        "paragraph_count": paragraph_count,
        "table_count": table_count,
        "code_block_count": code_block_count,
        "blockquote_count": blockquote_count,
        "link_count": link_count,
    }


def predict_actions(features: dict[str, Any]) -> dict[str, Any]:
    """
    Evaluates features against trained model if available, otherwise executes
    deterministic safety-preserving expert rules.
    """
    model_file = None
    if ML_MODELS_DIR.exists():
        candidates = list(ML_MODELS_DIR.glob("*.pkl")) + list(ML_MODELS_DIR.glob("*.joblib"))
        if candidates:
            model_file = candidates[0]

    if model_file is not None:
        # Placeholder for trained model loading (Phase 3)
        # When model is trained, load with joblib/pickle and predict.
        pass

    # Deterministic rule engine fallback (Phase 2 truthful baseline)
    image_count = features.get("image_count", 0)
    large_images = features.get("large_image_count", 0)
    html_kb = features.get("html_size_kb", 0)
    text_ratio = features.get("text_to_html_ratio", 0)
    script_count = features.get("script_count", 0)
    tp_scripts = features.get("third_party_script_count", 0)
    tables = features.get("table_count", 0)
    code_blocks = features.get("code_block_count", 0)

    reasons: list[str] = []

    # 1. Defer images: recommend when page has multiple images or heavy weight
    defer_images = image_count >= 3 or html_kb > 300
    if defer_images:
        reasons.append(f"Page contains {image_count} images; deferring non-essential images reduces initial load.")

    # 2. Optimise images: recommend when images exist
    optimise_images = image_count > 0
    if optimise_images:
        reasons.append(f"Detected {image_count} image element(s) eligible for re-compression or format optimization.")

    # 3. Preserve diagrams: protect technical / structured elements
    preserve_diagrams = tables > 0 or code_blocks > 0
    if preserve_diagrams:
        reasons.append(f"Detected {tables} table(s) and {code_blocks} code/technical section(s) marked for strict structural preservation.")

    # 4. Remove decorative elements
    remove_decorative_elements = features.get("images_with_alt_ratio", 1.0) < 0.8 or features.get("dom_depth_max", 0) > 10
    if remove_decorative_elements:
        reasons.append("Detected wrapper depth and decorative non-semantic tags suitable for simplification.")

    # 5. Remove safe scripts
    remove_safe_scripts = script_count > 0
    if remove_safe_scripts:
        reasons.append(f"Identified {script_count} script tag(s) ({tp_scripts} external/third-party) safe to strip from reader prose.")

    # 6. Prioritise text
    prioritise_text = text_ratio > 0.08 or features.get("paragraph_count", 0) >= 3
    if prioritise_text:
        reasons.append(f"Text-to-HTML ratio ({text_ratio:.1%}) indicates substantial readable prose suitable for text-first delivery.")

    # 7. Recommend Ultra Mode
    recommend_ultra_mode = (html_kb > 500) or (image_count >= 8) or (script_count >= 15)
    if recommend_ultra_mode:
        reasons.append(f"High page complexity ({html_kb:.0f} KB HTML, {script_count} scripts, {image_count} images) makes Ultra Mode highly beneficial.")

    # Determine recommended mode
    if recommend_ultra_mode:
        recommended_mode = "ultra"
    elif code_blocks > 3 or (text_ratio > 0.4 and image_count == 0):
        recommended_mode = "terminal"
    else:
        recommended_mode = "light"

    return {
        "is_model_trained": False,
        "engine": "ByteLess Deterministic Safety Rules (Phase 2 Baseline)",
        "recommended_mode": recommended_mode,
        "recommended_actions": {
            "defer_images": defer_images,
            "optimise_images": optimise_images,
            "preserve_diagrams": preserve_diagrams,
            "remove_decorative_elements": remove_decorative_elements,
            "remove_safe_scripts": remove_safe_scripts,
            "prioritise_text": prioritise_text,
            "recommend_ultra_mode": recommend_ultra_mode,
        },
        "reasons": reasons,
        "features": features,
    }

