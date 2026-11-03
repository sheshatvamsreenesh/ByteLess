# ml-engine/src/config.py
# ─────────────────────────────────────────────────────────────────────────────
# ByteLess Adaptive Intelligence Engine — Central Configuration
#
# All tuneable settings live here so you only need to change one file when
# you want to adjust behaviour.  Every constant is clearly explained so a
# second-year CS student can understand and modify it confidently.
# ─────────────────────────────────────────────────────────────────────────────

from pathlib import Path

# ── Directory Layout ──────────────────────────────────────────────────────────
# This file sits at  ml-engine/src/config.py
# ML_ROOT points two levels up (ml-engine/).
ML_ROOT = Path(__file__).resolve().parent.parent

DATA_DIR        = ML_ROOT / "data"
RAW_HTML_DIR    = DATA_DIR / "raw" / "html"       # saved .html files
RAW_META_DIR    = DATA_DIR / "raw" / "metadata"   # per-page JSON metadata
PROCESSED_DIR   = DATA_DIR / "processed"           # CSV outputs
ANNOTATIONS_DIR = DATA_DIR / "annotations"         # human labels
REPORTS_DIR     = ML_ROOT / "reports"
MODELS_DIR      = ML_ROOT / "models"
SCRIPTS_DIR     = ML_ROOT / "scripts"

# ── URL Configuration File ────────────────────────────────────────────────────
# The YAML file that you populate with manually approved URLs before running
# any collection.  The collector will REFUSE to fetch un-approved entries.
URL_CONFIG_FILE = ML_ROOT / "scripts" / "url_config.yaml"

# ── CSV Output Paths ──────────────────────────────────────────────────────────
PAGES_CSV       = PROCESSED_DIR / "pages.csv"
FEATURES_CSV    = PROCESSED_DIR / "features.csv"
ANNOTATIONS_CSV = ANNOTATIONS_DIR / "annotations.csv"
DATASET_CSV     = PROCESSED_DIR / "ml_dataset.csv"   # joined, clean output

# ── HTTP Collection Settings ──────────────────────────────────────────────────
# USER_AGENT: identifies our crawler to web servers.
# A transparent user-agent string is both polite and may be required
# by some websites' terms of service.
USER_AGENT = (
    "ByteLessResearchCrawler/0.1 "
    "(Educational ML dataset; non-commercial; "
    "contact: byteless-ml@example.com)"
)

# TIMEOUT_SECONDS: how long to wait for a server to respond before giving up.
# 15 seconds is generous enough for slow government sites.
TIMEOUT_SECONDS = 15

# REQUEST_DELAY_SECONDS: pause between consecutive HTTP requests.
# Do NOT set this below 2.  Some servers will rate-limit or ban you if you
# make too many requests too quickly.
REQUEST_DELAY_SECONDS = 3

# MAX_RETRIES: how many times to retry a failed request (network errors only,
# not HTTP 4xx errors — those are the server telling you to stop).
MAX_RETRIES = 2

# RETRY_BACKOFF_SECONDS: extra wait added for each retry attempt.
# First retry waits REQUEST_DELAY_SECONDS + RETRY_BACKOFF_SECONDS,
# second retry waits REQUEST_DELAY_SECONDS + 2 * RETRY_BACKOFF_SECONDS, etc.
RETRY_BACKOFF_SECONDS = 5

# MAX_HTML_SIZE_MB: skip pages whose raw HTML exceeds this limit.
# Very large HTML files (> 10 MB) are unusual and may indicate JavaScript-
# rendered content or a download link rather than a normal webpage.
MAX_HTML_SIZE_MB = 10

# ── Feature Extraction Settings ───────────────────────────────────────────────
# FEATURE_EXTRACTION_VERSION: bump this string whenever you change how
# features are computed so you can always trace which algorithm produced
# a given features.csv row.
FEATURE_EXTRACTION_VERSION = "0.1.0"

# LARGE_IMAGE_THRESHOLD_KB: an image is counted as "large" if its declared
# size (when available from the HTML) exceeds this value.
# Note: we do NOT download images to measure them — we use values declared
# in the HTML attributes only.  Missing values are stored as NaN, not zero.
LARGE_IMAGE_THRESHOLD_KB = 100

# THIRD_PARTY_THRESHOLD: a resource is "third-party" when its domain does not
# match OR is not a subdomain of the page's own domain.
# This is a heuristic — resource sizes are NOT fetched.
# (No constant needed here; logic lives in extract_features.py.)

# ── Validation Settings ───────────────────────────────────────────────────────
VALIDATION_REPORT_PATH = REPORTS_DIR / "dataset_validation_report.txt"

# Minimum number of pages required before the dataset is considered usable
# for model development.  Phase 2 pilot target is 20.
MIN_PAGES_FOR_ML = 20

# Minimum fraction of pages that must have positive labels for each output
# class (to detect severely imbalanced datasets early).
MIN_POSITIVE_FRACTION = 0.10

# ── Annotation Settings ───────────────────────────────────────────────────────
# Valid values for every binary label column in annotations.csv.
# 1 = positive (action recommended)
# 0 = negative (action not recommended)
# NaN / empty = unknown / not yet reviewed
VALID_LABEL_VALUES = {0, 1}

# annotation_status values
ANNOTATION_STATUS_DONE     = "reviewed"
ANNOTATION_STATUS_PENDING  = "pending"
ANNOTATION_STATUS_DISPUTED = "disputed"

