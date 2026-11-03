# ml-engine/src/validate_dataset.py
# ─────────────────────────────────────────────────────────────────────────────
# ByteLess Adaptive Intelligence Engine — Dataset Validation Module
#
# PURPOSE
# ───────
# Run a comprehensive quality check across pages.csv, features.csv, and
# annotations.csv.  Write a human-readable validation report to:
#   reports/dataset_validation_report.txt
#
# Validation findings are clearly labelled as either ERROR or WARNING:
#   ERROR   → a problem that must be fixed before using the data for ML.
#   WARNING → a potential issue that should be reviewed but does not
#             necessarily block usage.
#
# WHAT THIS SCRIPT DOES NOT DO
# ─────────────────────────────
# • It does NOT delete or modify any rows.
# • It does NOT fill missing values.
# • It does NOT train a model.
#
# HOW TO USE
# ──────────
# Do NOT call this file directly.  Use the wrapper:
#   python scripts/run_validation.py
#
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable
from urllib.parse import urlparse

import numpy as np
import pandas as pd

from config import (
    ANNOTATIONS_CSV,
    ANNOTATION_STATUS_DONE,
    FEATURES_CSV,
    MIN_PAGES_FOR_ML,
    MIN_POSITIVE_FRACTION,
    PAGES_CSV,
    VALID_LABEL_VALUES,
    VALIDATION_REPORT_PATH,
)

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("validate_dataset")

# ── Label columns ─────────────────────────────────────────────────────────────
LABEL_COLUMNS = [
    "defer_images",
    "optimise_images",
    "preserve_diagrams",
    "remove_decorative_elements",
    "remove_safe_scripts",
    "prioritise_text",
    "recommend_ultra_mode",
]

# Numeric feature columns that must be non-negative when present.
NON_NEGATIVE_FEATURES = [
    "html_size_kb", "dom_element_count", "dom_depth_max", "text_size_kb",
    "image_count", "total_image_size_kb", "avg_image_size_kb",
    "large_image_count", "script_count", "external_script_count",
    "third_party_script_count", "css_file_count", "inline_style_size_kb",
    "heading_count", "paragraph_count", "table_count", "code_block_count",
    "blockquote_count", "link_count", "video_embed_count",
    "total_resource_count", "third_party_resource_count",
    "estimated_page_weight_kb", "resource_type_diversity",
]

# Ratio features (must be in [0.0, 1.0] when present).
RATIO_FEATURES = [
    "text_to_html_ratio",
    "images_with_alt_ratio",
]


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 1 — Report builder
# ─────────────────────────────────────────────────────────────────────────────


class ValidationReport:
    """Accumulates errors and warnings, then writes a formatted text report."""

    def __init__(self) -> None:
        self._errors: list[str] = []
        self._warnings: list[str] = []
        self._info: list[str] = []

    def error(self, message: str) -> None:
        self._errors.append(message)
        log.error("  [ERROR] %s", message)

    def warning(self, message: str) -> None:
        self._warnings.append(message)
        log.warning("  [WARN ] %s", message)

    def info(self, message: str) -> None:
        self._info.append(message)
        log.info("  [INFO ] %s", message)

    def write(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        lines = []
        ts = datetime.now(timezone.utc).isoformat()

        lines.append("=" * 72)
        lines.append("ByteLess Adaptive Intelligence Engine")
        lines.append("Dataset Validation Report")
        lines.append(f"Generated: {ts}")
        lines.append("=" * 72)
        lines.append("")

        lines.append(f"SUMMARY: {len(self._errors)} ERROR(s), {len(self._warnings)} WARNING(s)")
        lines.append("")

        if self._errors:
            lines.append("─" * 72)
            lines.append("ERRORS  (must be fixed before ML training)")
            lines.append("─" * 72)
            for e in self._errors:
                lines.append(f"  [ERROR] {e}")
            lines.append("")

        if self._warnings:
            lines.append("─" * 72)
            lines.append("WARNINGS  (review recommended)")
            lines.append("─" * 72)
            for w in self._warnings:
                lines.append(f"  [WARN ] {w}")
            lines.append("")

        if self._info:
            lines.append("─" * 72)
            lines.append("INFORMATION")
            lines.append("─" * 72)
            for i in self._info:
                lines.append(f"  [INFO ] {i}")
            lines.append("")

        lines.append("=" * 72)
        lines.append("End of Report")
        lines.append("=" * 72)

        report_text = "\n".join(lines)
        path.write_text(report_text, encoding="utf-8")
        log.info("Validation report saved → %s", path)


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 2 — CSV loaders
# ─────────────────────────────────────────────────────────────────────────────


def _load(path: Path, name: str, report: ValidationReport) -> pd.DataFrame:
    if not path.exists():
        report.error(f"{name} not found at {path}")
        return pd.DataFrame()
    df = pd.read_csv(path, dtype=str, keep_default_na=True)
    if df.empty:
        report.warning(f"{name} exists but contains no data rows.")
    else:
        report.info(f"Loaded {name}: {len(df)} rows, {len(df.columns)} columns.")
    return df


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 3 — Individual check functions
# ─────────────────────────────────────────────────────────────────────────────


def _check_duplicate_page_ids(df: pd.DataFrame, name: str, report: ValidationReport) -> None:
    if "page_id" not in df.columns:
        report.error(f"{name}: missing 'page_id' column.")
        return
    dupes = df[df.duplicated("page_id", keep=False)]["page_id"].unique()
    if len(dupes) > 0:
        report.error(
            f"{name}: {len(dupes)} duplicate page_id value(s): "
            + ", ".join(str(d) for d in dupes[:10])
            + ("…" if len(dupes) > 10 else "")
        )
    else:
        report.info(f"{name}: No duplicate page_ids found.")


def _check_required_columns(
    df: pd.DataFrame, name: str, required: list[str], report: ValidationReport
) -> None:
    missing_cols = [c for c in required if c not in df.columns]
    if missing_cols:
        report.error(f"{name}: Missing required columns: {missing_cols}")
    else:
        report.info(f"{name}: All required columns present.")


def _check_missing_page_ids(df: pd.DataFrame, name: str, report: ValidationReport) -> None:
    if "page_id" not in df.columns:
        return
    empty_ids = df["page_id"].isna() | (df["page_id"].str.strip() == "")
    n = empty_ids.sum()
    if n:
        report.error(f"{name}: {n} row(s) with empty/null page_id.")


def _check_non_negative(df: pd.DataFrame, name: str, report: ValidationReport) -> None:
    for col in NON_NEGATIVE_FEATURES:
        if col not in df.columns:
            continue
        numeric = pd.to_numeric(df[col], errors="coerce")
        negatives = (numeric < 0).sum()
        if negatives:
            report.error(
                f"{name}: Column '{col}' has {negatives} negative value(s)."
            )


def _check_ratios(df: pd.DataFrame, name: str, report: ValidationReport) -> None:
    for col in RATIO_FEATURES:
        if col not in df.columns:
            continue
        numeric = pd.to_numeric(df[col], errors="coerce")
        out_of_range = ((numeric < 0) | (numeric > 1)).sum()
        if out_of_range:
            report.error(
                f"{name}: Column '{col}' has {out_of_range} value(s) outside [0, 1]."
            )


def _check_binary_labels(df: pd.DataFrame, report: ValidationReport) -> None:
    for col in LABEL_COLUMNS:
        if col not in df.columns:
            continue
        numeric = pd.to_numeric(df[col], errors="coerce")
        known = numeric.dropna()
        invalid = known[~known.isin(VALID_LABEL_VALUES)]
        if not invalid.empty:
            report.error(
                f"annotations.csv: Label '{col}' has {len(invalid)} invalid "
                f"value(s) (expected 0, 1, or blank): {invalid.unique().tolist()}"
            )


def _check_unreviewed_labels(df: pd.DataFrame, report: ValidationReport) -> None:
    if "annotation_status" not in df.columns:
        report.warning("annotations.csv: 'annotation_status' column not found.")
        return
    unreviewed = df[df["annotation_status"].str.strip().str.lower() != ANNOTATION_STATUS_DONE]
    if not unreviewed.empty:
        report.warning(
            f"annotations.csv: {len(unreviewed)} annotation(s) not yet marked "
            f"as '{ANNOTATION_STATUS_DONE}'. These will be excluded from ML training."
        )


def _check_failed_collections(df: pd.DataFrame, report: ValidationReport) -> None:
    if "fetch_success" not in df.columns:
        return
    failed = df[df["fetch_success"].str.strip().str.lower() != "true"]
    if not failed.empty:
        report.warning(
            f"pages.csv: {len(failed)} page(s) were not successfully collected "
            "(fetch_success != True). These are excluded from ML training."
        )
        for _, row in failed.iterrows():
            report.info(
                f"  Failed: {row.get('page_id')} | {row.get('url')} "
                f"| {row.get('collection_notes')}"
            )


def _check_missing_feature_records(
    pages_df: pd.DataFrame,
    features_df: pd.DataFrame,
    report: ValidationReport,
) -> None:
    if pages_df.empty or features_df.empty:
        return
    if "page_id" not in pages_df.columns or "page_id" not in features_df.columns:
        return

    collected_ids = set(
        pages_df[pages_df.get("fetch_success", pd.Series(dtype=str)).str.lower() == "true"][
            "page_id"
        ].dropna()
    )
    featured_ids = set(features_df["page_id"].dropna())
    missing = collected_ids - featured_ids

    if missing:
        report.warning(
            f"{len(missing)} successfully collected page(s) have no feature record: "
            + ", ".join(sorted(missing)[:10])
            + ("…" if len(missing) > 10 else "")
        )
    else:
        report.info("All collected pages have feature records.")


def _check_domain_diversity(df: pd.DataFrame, report: ValidationReport) -> None:
    if "url" not in df.columns:
        return

    domain_counts: dict[str, int] = defaultdict(int)
    for url in df["url"].dropna():
        netloc = urlparse(str(url)).netloc
        # Strip "www." prefix for root-domain grouping
        root = netloc.lstrip("www.").split(":")[0]
        domain_counts[root] += 1

    repeated = {d: c for d, c in domain_counts.items() if c > 3}
    if repeated:
        report.warning(
            "The following domains appear more than 3 times — "
            "consider replacing some with pages from different sites to improve diversity: "
            + str(repeated)
        )


def _check_label_distribution(
    annotations_df: pd.DataFrame, pages_df: pd.DataFrame, report: ValidationReport
) -> None:
    if annotations_df.empty:
        return

    reviewed = annotations_df[
        annotations_df.get("annotation_status", pd.Series(dtype=str))
        .str.strip()
        .str.lower()
        == ANNOTATION_STATUS_DONE
    ]
    n = len(reviewed)
    if n == 0:
        report.warning("No reviewed annotations yet — cannot check label distribution.")
        return

    report.info(f"Label distribution across {n} reviewed annotation(s):")
    for col in LABEL_COLUMNS:
        if col not in reviewed.columns:
            continue
        numeric = pd.to_numeric(reviewed[col], errors="coerce")
        n_pos = (numeric == 1).sum()
        n_neg = (numeric == 0).sum()
        n_unk = numeric.isna().sum()
        pos_frac = n_pos / n if n > 0 else 0.0
        report.info(
            f"  {col}: pos={n_pos} ({pos_frac:.0%}), "
            f"neg={n_neg}, unknown={n_unk}"
        )
        if n_pos < MIN_PAGES_FOR_ML * MIN_POSITIVE_FRACTION and n >= MIN_PAGES_FOR_ML:
            report.warning(
                f"Label '{col}' has very few positive examples ({n_pos}). "
                "Consider adding more pages where this label should be 1."
            )


def _check_dataset_size(pages_df: pd.DataFrame, report: ValidationReport) -> None:
    if "fetch_success" not in pages_df.columns:
        return
    n_collected = (
        pages_df["fetch_success"].str.strip().str.lower() == "true"
    ).sum()

    if n_collected < MIN_PAGES_FOR_ML:
        report.warning(
            f"Only {n_collected} pages successfully collected. "
            f"Target is {MIN_PAGES_FOR_ML} for the Phase 2 pilot batch."
        )
    else:
        report.info(
            f"Dataset size OK: {n_collected} pages collected "
            f"(target: {MIN_PAGES_FOR_ML})."
        )


# ─────────────────────────────────────────────────────────────────────────────
# SECTION 4 — Orchestrator
# ─────────────────────────────────────────────────────────────────────────────


def validate_dataset() -> ValidationReport:
    """
    Run all validation checks and save the report.

    Returns
    -------
    The populated ValidationReport object.
    """
    report = ValidationReport()

    log.info("═" * 60)
    log.info("ByteLess Dataset Validation")
    log.info("═" * 60)

    # ── Load CSVs ──────────────────────────────────────────────────────────
    pages_df       = _load(PAGES_CSV,       "pages.csv",       report)
    features_df    = _load(FEATURES_CSV,    "features.csv",    report)
    annotations_df = _load(ANNOTATIONS_CSV, "annotations.csv", report)

    # ── pages.csv checks ──────────────────────────────────────────────────
    if not pages_df.empty:
        log.info("Checking pages.csv …")
        _check_duplicate_page_ids(pages_df, "pages.csv", report)
        _check_missing_page_ids(pages_df, "pages.csv", report)
        _check_required_columns(
            pages_df, "pages.csv",
            ["page_id", "url", "domain", "category", "collection_date",
             "http_status", "fetch_success", "robots_allowed"],
            report,
        )
        _check_failed_collections(pages_df, report)
        _check_domain_diversity(pages_df, report)
        _check_dataset_size(pages_df, report)

    # ── features.csv checks ───────────────────────────────────────────────
    if not features_df.empty:
        log.info("Checking features.csv …")
        _check_duplicate_page_ids(features_df, "features.csv", report)
        _check_missing_page_ids(features_df, "features.csv", report)
        _check_non_negative(features_df, "features.csv", report)
        _check_ratios(features_df, "features.csv", report)

    # ── Cross-table: missing feature records ──────────────────────────────
    _check_missing_feature_records(pages_df, features_df, report)

    # ── annotations.csv checks ────────────────────────────────────────────
    if not annotations_df.empty:
        log.info("Checking annotations.csv …")
        _check_duplicate_page_ids(annotations_df, "annotations.csv", report)
        _check_binary_labels(annotations_df, report)
        _check_unreviewed_labels(annotations_df, report)
        _check_label_distribution(annotations_df, pages_df, report)

    # ── Write report ───────────────────────────────────────────────────────
    report.write(VALIDATION_REPORT_PATH)

    return report

