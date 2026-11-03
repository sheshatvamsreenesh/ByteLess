# ml-engine/src/dataset_builder.py
# ─────────────────────────────────────────────────────────────────────────────
# ByteLess Adaptive Intelligence Engine — Dataset Builder
#
# PURPOSE
# ───────
# Join pages.csv, features.csv, and annotations.csv using page_id as the key.
# Perform integrity checks before producing a clean ML-ready dataset.
#
# WHAT THIS SCRIPT DOES NOT DO
# ─────────────────────────────
# • It does NOT train a model.
# • It does NOT impute or fill in missing label values.
# • It does NOT delete problematic rows silently.
# • It does NOT fabricate features or annotations.
#
# HOW TO USE
# ──────────
# Do NOT call this file directly.  Use the wrapper:
#   python scripts/run_collection.py   (which calls this at the end)
# Or run the feature extraction script which calls build_dataset() for you.
# Or import and call build_dataset() from your own code.
#
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from config import (
    ANNOTATIONS_CSV,
    ANNOTATION_STATUS_DONE,
    DATASET_CSV,
    FEATURES_CSV,
    PAGES_CSV,
    PROCESSED_DIR,
)

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("dataset_builder")

# ── Label columns (must match annotations.csv) ────────────────────────────────
LABEL_COLUMNS = [
    "defer_images",
    "optimise_images",
    "preserve_diagrams",
    "remove_decorative_elements",
    "remove_safe_scripts",
    "prioritise_text",
    "recommend_ultra_mode",
]


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 1 — Loaders with error handling
# ─────────────────────────────────────────────────────────────────────────────


def _load_csv(path: Path, name: str) -> pd.DataFrame:
    """
    Load a CSV file into a DataFrame.

    Returns an empty DataFrame (with correct dtypes) if the file is missing
    or contains only a header row.
    """
    if not path.exists():
        log.error("%s not found at %s", name, path)
        return pd.DataFrame()

    df = pd.read_csv(path, dtype=str, keep_default_na=True)
    log.info("Loaded %s: %d rows", name, len(df))
    return df


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 2 — Main builder
# ─────────────────────────────────────────────────────────────────────────────


def build_dataset() -> pd.DataFrame:
    """
    Join pages, features, and annotations into a clean ML dataset.

    Build steps
    ───────────
    1.  Load the three source CSVs.
    2.  Check for duplicate page_ids in each source.
    3.  Exclude failed or skipped collection records.
    4.  Join pages ↔ features (inner join → only pages with features).
    5.  Optionally join annotations (left join → keeps unannotated pages in
        the intermediate set but excludes them from the final ML split).
    6.  Identify and log integrity issues.
    7.  Produce an "ML-eligible" subset: pages that have features AND have
        fully reviewed annotations with no unknown label values.
    8.  Save the joined dataset (all integrity-flagged pages included with
        a status column) and the ML-eligible subset separately.

    Returns
    -------
    The full joined DataFrame (including integrity-flagged rows).
    Inspect the `build_status` column to understand each row's eligibility.
    """
    log.info("═" * 60)
    log.info("ByteLess Dataset Builder")
    log.info("═" * 60)

    # ── 1. Load sources ────────────────────────────────────────────────────
    pages_df      = _load_csv(PAGES_CSV,       "pages.csv")
    features_df   = _load_csv(FEATURES_CSV,    "features.csv")
    annotations_df = _load_csv(ANNOTATIONS_CSV, "annotations.csv")

    if pages_df.empty:
        log.error("pages.csv is empty or missing — cannot build dataset.")
        return pd.DataFrame()

    # ── 2. Duplicate page_id checks ────────────────────────────────────────
    for df, name in [(pages_df, "pages.csv"), (features_df, "features.csv")]:
        if df.empty or "page_id" not in df.columns:
            continue
        dupes = df[df.duplicated("page_id", keep=False)]
        if not dupes.empty:
            log.warning(
                "DUPLICATE page_ids found in %s: %s",
                name,
                dupes["page_id"].unique().tolist(),
            )

    # ── 3. Exclude failed collections ─────────────────────────────────────
    if "fetch_success" in pages_df.columns:
        before = len(pages_df)
        pages_df = pages_df[pages_df["fetch_success"].str.strip().str.lower() == "true"].copy()
        excluded = before - len(pages_df)
        if excluded:
            log.info("Excluded %d failed/skipped collection records.", excluded)

    if pages_df.empty:
        log.warning("No successfully collected pages found.  Dataset is empty.")
        return pd.DataFrame()

    # ── 4. Join pages ↔ features ───────────────────────────────────────────
    if features_df.empty or "page_id" not in features_df.columns:
        log.warning("features.csv is empty — no features to join.")
        joined = pages_df.copy()
        joined["has_features"] = False
    else:
        # Drop duplicate page_ids in features (keep the latest version if duped)
        features_df = features_df.drop_duplicates(subset="page_id", keep="last")
        joined = pages_df.merge(features_df, on="page_id", how="left", suffixes=("", "_feat"))
        # Flag pages that have no feature record
        joined["has_features"] = joined["html_size_kb"].notna()

        missing_features = joined[~joined["has_features"]]["page_id"].tolist()
        if missing_features:
            log.warning(
                "%d page(s) have no feature record: %s",
                len(missing_features),
                missing_features,
            )

    # ── 5. Join annotations (left join) ───────────────────────────────────
    if not annotations_df.empty and "page_id" in annotations_df.columns:
        annotations_df = annotations_df.drop_duplicates(subset="page_id", keep="last")
        joined = joined.merge(
            annotations_df, on="page_id", how="left", suffixes=("", "_ann")
        )
        joined["has_annotations"] = joined["annotation_status"].notna()
        joined["annotation_reviewed"] = (
            joined["annotation_status"].str.strip().str.lower() == ANNOTATION_STATUS_DONE
        )
    else:
        log.warning("annotations.csv is empty or missing.  No labels will be available.")
        joined["has_annotations"] = False
        joined["annotation_reviewed"] = False

    # ── 6. Integrity flags ─────────────────────────────────────────────────
    issues: list[str] = []

    def _flag(condition: pd.Series, message: str) -> None:
        count = condition.sum()
        if count:
            issues.append(f"  • {count} rows: {message}")

    _flag(~joined["has_features"], "Missing feature record")
    _flag(~joined.get("has_annotations", pd.Series([False] * len(joined))),
          "No annotation record")
    _flag(
        joined.get("annotation_reviewed", pd.Series([False] * len(joined))) == False
        if "annotation_reviewed" in joined.columns
        else pd.Series([False] * len(joined)),
        "Annotation not yet reviewed"
    )

    if issues:
        log.warning("Integrity issues found:")
        for issue in issues:
            log.warning(issue)

    # ── 7. Build status column ─────────────────────────────────────────────
    # "ml_eligible" → has features + fully reviewed annotation + no unknown labels.
    # Everything else is flagged with a reason.

    def _determine_status(row: pd.Series) -> str:
        if not row.get("has_features", False):
            return "no_features"
        if not row.get("has_annotations", False):
            return "no_annotations"
        if not row.get("annotation_reviewed", False):
            return "annotation_pending"
        # Check for any unknown (NaN) label values
        for col in LABEL_COLUMNS:
            if col in row and pd.isna(row[col]):
                return f"unknown_label:{col}"
        return "ml_eligible"

    joined["build_status"] = joined.apply(_determine_status, axis=1)

    # ── 8. Save outputs ────────────────────────────────────────────────────
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")

    # Full joined dataset (all rows, all statuses)
    joined_path = PROCESSED_DIR / f"dataset_joined_{timestamp}.csv"
    joined.to_csv(joined_path, index=False, encoding="utf-8")
    log.info("Full joined dataset → %s (%d rows)", joined_path.name, len(joined))

    # ML-eligible subset only
    ml_eligible = joined[joined["build_status"] == "ml_eligible"].copy()
    if not ml_eligible.empty:
        ml_eligible.to_csv(DATASET_CSV, index=False, encoding="utf-8")
        log.info(
            "ML-eligible dataset → %s (%d rows)", DATASET_CSV.name, len(ml_eligible)
        )
    else:
        log.warning(
            "No ML-eligible rows yet. "
            "Complete annotations and re-run the builder."
        )

    log.info("═" * 60)
    log.info("Build summary:")
    log.info("  Total collected pages : %d", len(joined))
    log.info("  With features         : %d", joined["has_features"].sum())
    log.info("  With annotations      : %d", joined.get("has_annotations", pd.Series(dtype=bool)).sum())
    log.info("  ML-eligible           : %d", len(ml_eligible))
    log.info("═" * 60)

    return joined

