# ml-engine/scripts/run_validation.py
# ─────────────────────────────────────────────────────────────────────────────
# ByteLess Adaptive Intelligence Engine — Validation Runner
#
# PURPOSE
# ───────
# Run all dataset quality checks and produce a validation report at:
#   reports/dataset_validation_report.txt
#
# HOW TO RUN (from the ml-engine/ directory)
# ──────────────────────────────────────────
#   python scripts/run_validation.py
#
# You can run this script at any stage — even when the dataset is empty —
# to see what is currently wrong or missing.
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

from validate_dataset import validate_dataset
from config import VALIDATION_REPORT_PATH

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("run_validation")


def main() -> None:
    report = validate_dataset()

    n_errors   = len(report._errors)
    n_warnings = len(report._warnings)

    print()
    print("=" * 60)
    print(f"  Validation complete: {n_errors} error(s), {n_warnings} warning(s)")
    print(f"  Report saved to: {VALIDATION_REPORT_PATH}")
    print("=" * 60)
    print()

    if n_errors > 0:
        print("There are ERRORs that must be resolved before ML training.")
        print("Open the report for details.")
        sys.exit(1)   # non-zero exit so CI/scripts can detect failure
    else:
        print("No blocking errors.  Review warnings before proceeding.")
        sys.exit(0)


if __name__ == "__main__":
    main()

