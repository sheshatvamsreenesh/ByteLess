# ml-engine/scripts/run_feature_extraction.py
# ─────────────────────────────────────────────────────────────────────────────
# ByteLess Adaptive Intelligence Engine — Feature Extraction Runner
#
# PURPOSE
# ───────
# Read successfully collected page IDs from pages.csv and run the feature
# extraction pipeline on every page that has a saved HTML file.
#
# HOW TO RUN (from the ml-engine/ directory)
# ──────────────────────────────────────────
#   python scripts/run_feature_extraction.py
#
# BEFORE RUNNING
# ──────────────
# 1. You must have already run:  python scripts/run_collection.py
# 2. data/raw/html/ must contain at least one .html file.
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import sys
import logging
from pathlib import Path

# ── Path setup ────────────────────────────────────────────────────────────────
_SCRIPT_DIR = Path(__file__).resolve().parent
_ML_ROOT    = _SCRIPT_DIR.parent
_SRC_DIR    = _ML_ROOT / "src"
sys.path.insert(0, str(_SRC_DIR))

from config import PAGES_CSV, RAW_HTML_DIR
from extract_features import extract_features_for_batch

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("run_feature_extraction")


def main() -> None:
    # ── Discover page IDs from existing HTML files ─────────────────────────
    # We prefer to read pages.csv for the authoritative list, but fall back
    # to scanning the HTML directory if the CSV is unavailable.

    page_ids: list[str] = []

    if PAGES_CSV.exists():
        try:
            import csv
            with PAGES_CSV.open("r", encoding="utf-8", newline="") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    if row.get("fetch_success", "").strip().lower() == "true":
                        pid = row.get("page_id", "").strip()
                        if pid:
                            page_ids.append(pid)
            log.info(
                "Found %d successfully collected page(s) in pages.csv.", len(page_ids)
            )
        except Exception as exc:
            log.warning("Could not read pages.csv: %s — falling back to HTML scan.", exc)

    if not page_ids:
        # Fallback: scan HTML directory for .html files
        html_files = sorted(RAW_HTML_DIR.glob("*.html"))
        page_ids = [f.stem for f in html_files]
        if page_ids:
            log.info(
                "Found %d HTML file(s) in %s (pages.csv not available or empty).",
                len(page_ids),
                RAW_HTML_DIR,
            )

    if not page_ids:
        log.warning(
            "\n"
            "═══════════════════════════════════════════════════════════════\n"
            "  No collected pages found.\n"
            "\n"
            "  Run webpage collection first:\n"
            "    python scripts/run_collection.py\n"
            "═══════════════════════════════════════════════════════════════\n"
        )
        sys.exit(0)

    # ── Run extraction ─────────────────────────────────────────────────────
    results = extract_features_for_batch(page_ids)

    successes = sum(results.values())
    failures  = len(results) - successes
    log.info("Feature extraction done: %d succeeded, %d failed.", successes, failures)

    if failures:
        failed_ids = [pid for pid, ok in results.items() if not ok]
        log.warning(
            "The following pages had no HTML file or could not be parsed: %s",
            failed_ids,
        )


if __name__ == "__main__":
    main()

