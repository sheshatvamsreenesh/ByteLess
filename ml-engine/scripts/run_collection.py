# ml-engine/scripts/run_collection.py
# ─────────────────────────────────────────────────────────────────────────────
# ByteLess Adaptive Intelligence Engine — Collection Runner
#
# PURPOSE
# ───────
# Read the approved URL list from url_config.yaml and run the webpage
# collection pipeline.
#
# HOW TO RUN (from the ml-engine/ directory)
# ──────────────────────────────────────────
#   python scripts/run_collection.py
#
# BEFORE RUNNING
# ──────────────
# 1. Edit scripts/url_config.yaml — add real URLs and set approved: true
#    for each URL you have personally reviewed.
# 2. Make sure your virtual environment is activated and requirements are
#    installed (see README.md for step-by-step instructions).
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import sys
import logging
from pathlib import Path

# ── Path setup ────────────────────────────────────────────────────────────────
# Add the src/ directory to sys.path so that `import config` works.
_SCRIPT_DIR = Path(__file__).resolve().parent          # ml-engine/scripts/
_ML_ROOT    = _SCRIPT_DIR.parent                       # ml-engine/
_SRC_DIR    = _ML_ROOT / "src"
sys.path.insert(0, str(_SRC_DIR))

# ── Import after path is set ──────────────────────────────────────────────────
try:
    import yaml  # PyYAML — add to requirements.txt if not already present
except ImportError:
    print(
        "\n[ERROR] PyYAML is not installed.\n"
        "Run:  pip install pyyaml\n"
        "Or add it to requirements.txt and re-run: pip install -r requirements.txt\n"
    )
    sys.exit(1)

from collect_pages import collect_batch

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("run_collection")


def main() -> None:
    config_path = _SCRIPT_DIR / "url_config.yaml"

    if not config_path.exists():
        log.error("url_config.yaml not found at %s", config_path)
        log.error(
            "Run this script from the ml-engine/ directory, or check the path."
        )
        sys.exit(1)

    log.info("Loading URL configuration from %s", config_path)
    with config_path.open("r", encoding="utf-8") as f:
        config_data = yaml.safe_load(f)

    page_configs = config_data.get("pages", [])
    if not page_configs:
        log.error(
            "No pages found in url_config.yaml.  "
            "Please add URL entries under the 'pages:' key."
        )
        sys.exit(1)

    approved_urls = [
        p for p in page_configs
        if p.get("url", "").strip() and p.get("approved", False)
    ]
    unapproved = len(page_configs) - len(approved_urls)

    log.info("URL config: %d total entries, %d approved, %d unapproved/empty",
             len(page_configs), len(approved_urls), unapproved)

    if not approved_urls:
        log.warning(
            "\n"
            "═══════════════════════════════════════════════════════════════\n"
            "  No approved URLs found.\n"
            "\n"
            "  To start collection:\n"
            "  1. Open  scripts/url_config.yaml\n"
            "  2. Fill in real public URLs under each category.\n"
            "  3. Set  approved: true  for each URL you have reviewed.\n"
            "  4. Re-run this script.\n"
            "═══════════════════════════════════════════════════════════════\n"
        )
        sys.exit(0)

    collect_batch(page_configs)


if __name__ == "__main__":
    main()

