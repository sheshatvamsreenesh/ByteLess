# ByteLess Adaptive Intelligence Engine — ML Engine

> **Less data. Same knowledge.**
>
> This directory contains the machine learning components for the ByteLess project.
> It is completely independent of the React frontend and does not modify any frontend files.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Directory Structure](#2-directory-structure)
3. [Phase 2 Goal](#3-phase-2-goal)
4. [Windows Setup Guide](#4-windows-setup-guide)
5. [Running the Pipeline](#5-running-the-pipeline)
6. [Annotation Guide](#6-annotation-guide)
7. [Feature Reference](#7-feature-reference)
8. [Common Errors and Fixes](#8-common-errors-and-fixes)
9. [Design Decisions](#9-design-decisions)
10. [What Still Needs Human Input](#10-what-still-needs-human-input)

---

## 1. Project Overview

The **ByteLess Adaptive Intelligence Engine** is a supervised multi-label classification
model that analyses real webpage characteristics and recommends suitable optimisation actions.

The model will eventually learn to recommend:

| Label | Meaning |
|---|---|
| `defer_images` | Non-essential images can be deferred (lazy-loaded or hidden initially) |
| `optimise_images` | Images are eligible for compression or format conversion |
| `preserve_diagrams` | Meaningful diagrams must be protected from removal |
| `remove_decorative_elements` | Verified decorative elements can be safely removed |
| `remove_safe_scripts` | Non-critical scripts can be removed or deferred |
| `prioritise_text` | Semantic text content should be delivered first |
| `recommend_ultra_mode` | All aggressive optimisations are appropriate for this page |

> **Important:** The model *recommends* actions. It does not directly remove webpage content.
> A separate deterministic safety layer must always protect important images, tables,
> references, and meaningful content before any removal action is executed.

---

## 2. Directory Structure

```
ml-engine/
│
├── data/
│   ├── raw/
│   │   ├── html/          ← saved .html files (one per collected page)
│   │   └── metadata/      ← per-page .json metadata files
│   │
│   ├── processed/
│   │   ├── pages.csv      ← collection log (one row per URL attempted)
│   │   └── features.csv   ← extracted features (one row per successful page)
│   │
│   └── annotations/
│       └── annotations.csv ← human-reviewed labels (one row per reviewed page)
│
├── notebooks/             ← Jupyter notebooks for exploration (future phases)
│
├── src/
│   ├── __init__.py
│   ├── config.py          ← all settings in one place
│   ├── collect_pages.py   ← webpage fetcher
│   ├── extract_features.py← HTML feature extractor
│   ├── dataset_builder.py ← joins CSVs into ML-ready dataset
│   └── validate_dataset.py← quality checker
│
├── scripts/
│   ├── url_config.yaml    ← YOUR approved URL list goes here
│   ├── run_collection.py  ← entry point: fetch pages
│   ├── run_feature_extraction.py ← entry point: extract features
│   └── run_validation.py  ← entry point: validate dataset
│
├── reports/               ← validation reports are saved here
├── models/                ← trained model artifacts (Phase 3+)
├── requirements.txt
├── README.md              ← this file
└── .gitignore
```

---

## 3. Phase 2 Goal

Collect **20 real public webpages** across six categories, extract features from each,
and prepare the dataset for human annotation.

| Category | Target count |
|---|---|
| News and articles | 4 |
| E-commerce | 3 |
| Technical documentation | 4 |
| Educational content | 4 |
| Government / public services | 3 |
| Forums and reference | 2 |
| **Total** | **20** |

> **No model training happens in Phase 2.** The output is a clean, validated CSV dataset
> ready for human annotation and then model development in Phase 3.

---

## 4. Windows Setup Guide

Follow these steps exactly, in order.

### Step 1 — Open PowerShell in the right folder

```powershell
cd "C:\Users\LENOVO\OneDrive\Desktop\PROJECTS AND DESIGNS\byteless\ml-engine"
```

### Step 2 — Create a Python virtual environment

```powershell
python -m venv .venv
```

This creates a `.venv` folder inside `ml-engine/`. It is your isolated Python environment
and will **not** affect the rest of your system.

> **Troubleshooting:** If you see `python is not recognized`, install Python from
> https://python.org and tick "Add Python to PATH" during installation.
> Then close and reopen PowerShell.

### Step 3 — Activate the virtual environment

```powershell
.\.venv\Scripts\Activate.ps1
```

Your prompt will now start with `(.venv)`. This means the virtual environment is active.

> **Troubleshooting — script execution policy error:**
> If PowerShell refuses with "execution of scripts is disabled on this system", run:
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
> ```
> Then try the activation command again.

### Step 4 — Install Python dependencies

```powershell
pip install -r requirements.txt
```

This installs requests, BeautifulSoup, pandas, and the other libraries listed in
`requirements.txt`. It takes 1–2 minutes.

---

## 5. Running the Pipeline

Always run commands from the `ml-engine/` directory with the virtual environment active.

### Step A — Populate the URL configuration

Open `scripts/url_config.yaml` in any text editor.

For each of the 20 URLs you want to collect:
1. Paste the full URL into the `url:` field.
2. Set the correct `category:` (must match one of the six valid strings exactly).
3. Write a note about where you found the URL and that you checked the site's terms.
4. Set `approved: true` **only after** you have personally verified:
   - The page is publicly accessible (no login required).
   - You have checked the site's `robots.txt` and terms of service.
   - The page content is appropriate for an educational dataset.

> **The collection script will refuse to fetch any URL where `approved: false`.**

### Step B — Run webpage collection

```powershell
python scripts/run_collection.py
```

The script will:
- Check `robots.txt` for each approved URL.
- Fetch the page HTML (with a 3-second polite delay between requests).
- Save the HTML to `data/raw/html/`.
- Save metadata to `data/raw/metadata/`.
- Record every attempt (success or failure) in `data/processed/pages.csv`.

A page can fail for several reasons: robots.txt disallows it, HTTP errors, timeouts,
or unexpected content types. Failed pages are recorded with a reason — they are **not**
silently dropped.

### Step C — Run feature extraction

```powershell
python scripts/run_feature_extraction.py
```

The script reads every successfully collected HTML file and computes the 30 features
defined in `data/processed/features.csv`.

> **Note:** Feature extraction only analyses the static HTML — it does not execute
> JavaScript, download images, or fetch any additional resources.

### Step D — Human annotation

Open `data/annotations/annotations.csv` and fill in the label columns for each
successfully collected page. See the [Annotation Guide](#6-annotation-guide) below
for detailed rules.

### Step E — Build the ML dataset

The dataset builder joins pages, features, and annotations into one clean file.
It is called automatically at the end of the feature extraction script, or you
can call it manually:

```powershell
python -c "import sys; sys.path.insert(0, 'src'); from dataset_builder import build_dataset; build_dataset()"
```

The output is saved to `data/processed/ml_dataset.csv` (ML-eligible rows only)
and a timestamped `dataset_joined_*.csv` (all rows with status flags).

### Step F — Run validation

```powershell
python scripts/run_validation.py
```

Opens every CSV, runs quality checks, and writes a human-readable report to
`reports/dataset_validation_report.txt`.

Fix all **ERRORS** before using the dataset for model training.
Review all **WARNINGS** and resolve any that indicate real problems.

---

## 6. Annotation Guide

### Why human annotation?

Deciding whether a page's images should be deferred, or whether its scripts are safe
to remove, requires **human judgement**. The ML model learns from these human decisions.
If the labels are wrong, the model will learn the wrong thing.

### When to use a second reviewer

Every annotation contains subjective judgement. To measure this subjectivity,
**10–15% of pages** (2–3 out of 20 in Phase 2) should be independently reviewed
by a second annotator who has not seen the first annotator's labels.

If their labels agree on 80% or more of the seven decisions, both reviews are consistent.
If they disagree, discuss and resolve the disagreement before finalising the label.

### How to resolve disagreements

1. Both annotators review the page together.
2. Discuss the specific element causing disagreement.
3. Agree on a final label and record the reasoning in the `review_notes` column.
4. If consensus cannot be reached, mark the label as **unknown** (leave blank).

### Label definitions

---

#### `defer_images` — Should non-essential images be deferred?

**Positive (1) when:**
- The page contains images that do not contribute to understanding the main content
  (decorative banners, author photos in article lists, advertisement images).
- Images are below the fold and are unlikely to be immediately viewed.
- The page is primarily text-based and images are supplementary.

**Negative (0) when:**
- Every image on the page is directly required to understand the content
  (diagrams, screenshots, instructional illustrations, product images on a product page).
- The page has very few images (e.g. 0–2).

**Unknown (leave blank) when:**
- You cannot determine image purpose from the rendered HTML alone.
- The page did not load completely (JavaScript-rendered content is missing).

---

#### `optimise_images` — Are images eligible for format/size optimisation?

**Positive (1) when:**
- The page contains images that appear to be served as large JPEGs or PNGs
  where a smaller file size or modern format (WebP, AVIF) would be sufficient.
- Large images are present with no explicit quality constraint visible in the markup.

**Negative (0) when:**
- The page contains no images, or images are already tiny (e.g. icons under 5 KB).
- Images are SVGs or CSS-generated (no file to compress).

**Unknown (leave blank) when:**
- Image file sizes cannot be determined from the HTML (this is the common case —
  our feature extractor does not download images).
- You cannot assess image quality from static HTML.

> **Note:** It is expected that `optimise_images` will frequently be unknown in Phase 2
> because actual file sizes require downloading each image.

---

#### `preserve_diagrams` — Are there meaningful diagrams that must be protected?

**Positive (1) when:**
- The page contains technical or explanatory diagrams, flowcharts, architecture images,
  or scientific figures that are essential to the content's meaning.
- Removing these images would significantly impair comprehension.
- Tables that serve as reference data (not just layout) are present.

**Negative (0) when:**
- The page contains no diagrams or data tables.
- All images are purely decorative.

**Unknown (leave blank) when:**
- You cannot determine from the static HTML whether images are diagrams or decorative.

---

#### `remove_decorative_elements` — Can verified decorative elements be removed?

**Positive (1) when:**
- The page contains elements that can be confidently identified as purely decorative:
  background images, decorative dividers, empty spacer images, purely visual icons
  with no functional meaning.
- These elements have no `alt` text, no ARIA label, and serve no functional purpose.

**Negative (0) when:**
- All elements appear to serve a functional or informational purpose.
- Removing any element would break navigation or degrade comprehension.

**Unknown (leave blank) when:**
- The purpose of elements is ambiguous from static HTML alone.

> **Safety requirement:** Even when this label is positive, the deterministic safety
> layer must independently verify decorative status before any element is removed.

---

#### `remove_safe_scripts` — Can non-critical scripts be removed or deferred?

**Positive (1) when:**
- The page contains a large number of third-party scripts (analytics, advertising,
  social sharing widgets, chat widgets) that do not affect the page's core content.
- Script count is high relative to content complexity.

**Negative (0) when:**
- Scripts are integral to the page's core functionality
  (a web application, interactive tool, or form processor).
- The page is a minimal, script-free document.

**Unknown (leave blank) when:**
- Script purpose cannot be determined from filenames or HTML context alone.

> **Important:** Do NOT classify scripts as safe or unsafe purely from their names
> or counts. Inspecting script content would require a different tool.
> When in doubt, leave this label unknown rather than guessing.

---

#### `prioritise_text` — Should semantic text be delivered first?

**Positive (1) when:**
- The page is primarily a text document (article, documentation, educational content,
  government notice) where the text content is the core value.
- Delivering text before images and scripts would preserve the page's primary purpose.

**Negative (0) when:**
- The page's primary value is interactive or visual (e-commerce product images,
  video page, image gallery, interactive map).
- Text is minimal and the page cannot be meaningfully consumed as text alone.

**Unknown (leave blank) when:**
- The page's purpose is unclear from the HTML.

---

#### `recommend_ultra_mode` — Is aggressive optimisation appropriate?

**Positive (1) when:**
- The page is high-bandwidth (large HTML, many scripts, many images).
- The core content can be delivered meaningfully with most supplementary elements removed.
- The annotator would confidently recommend all six other optimisations simultaneously.

**Negative (0) when:**
- The page is already lightweight.
- Aggressive optimisation would remove content essential to the page's purpose.
- The page is interactive or media-heavy in a way that cannot be simplified.

**Unknown (leave blank) when:**
- There is disagreement about other labels that would affect this overall recommendation.

---

### `annotation_status` values

| Value | Meaning |
|---|---|
| `pending` | Labels have not been filled in yet |
| `reviewed` | Labels are complete and reviewed |
| `disputed` | Labels are under discussion between annotators |

---

## 7. Feature Reference

| Feature | Description | Unit | Notes |
|---|---|---|---|
| `html_size_kb` | Raw HTML file size | KB | Measured from saved file |
| `dom_element_count` | Total number of HTML tags | count | Includes all tag types |
| `dom_depth_max` | Maximum nesting depth of HTML elements | depth | 0 = root |
| `text_size_kb` | Visible text content size | KB | After removing script/style tags |
| `text_to_html_ratio` | text_size / html_size | 0–1 | Higher = more text, less markup |
| `image_count` | Number of `<img>` elements | count | |
| `total_image_size_kb` | Sum of image file sizes | KB | **Not available** — not downloaded |
| `avg_image_size_kb` | Average image file size | KB | **Not available** — not downloaded |
| `large_image_count` | Images with pixel area > 90,000 px² | count | Based on HTML width/height attributes only |
| `images_with_alt_ratio` | Fraction of images with non-empty alt text | 0–1 | |
| `image_dimension_variation` | Std-dev of declared image areas | px² | Measures size uniformity |
| `script_count` | Total `<script>` elements | count | Inline + external |
| `external_script_count` | `<script src="...">` elements | count | |
| `third_party_script_count` | External scripts from other domains | count | Heuristic root-domain match |
| `css_file_count` | `<link rel="stylesheet">` elements | count | |
| `inline_style_size_kb` | Size of all `<style>` block content | KB | |
| `heading_count` | h1–h6 elements | count | |
| `paragraph_count` | `<p>` elements | count | |
| `table_count` | `<table>` elements | count | |
| `code_block_count` | `<code>` and `<pre>` elements | count | |
| `blockquote_count` | `<blockquote>` elements | count | |
| `link_count` | `<a href>` elements | count | |
| `video_embed_count` | Video embeds (video/iframe/embed) | count | |
| `total_resource_count` | Total referenced external resources | count | Not downloaded |
| `third_party_resource_count` | Resources from other domains | count | Heuristic |
| `estimated_page_weight_kb` | **HTML file size only** | KB | **Does NOT include images/scripts/fonts** |
| `resource_type_diversity` | Number of distinct resource types referenced | count | |

> **Missing values:** When a feature cannot be measured (e.g. image file sizes without
> downloading), it is stored as an empty cell (NaN in pandas). This is correct behaviour.
> Do **not** replace missing values with zero — that would introduce false information.

---

## 8. Common Errors and Fixes

### `ModuleNotFoundError: No module named 'requests'`

Your virtual environment is not active, or you have not installed the dependencies.

```powershell
# Make sure you are in ml-engine/
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### `ModuleNotFoundError: No module named 'yaml'`

PyYAML is missing. Install it:

```powershell
pip install pyyaml
```

### `Scripts\Activate.ps1 cannot be loaded because running scripts is disabled`

Run this once in PowerShell (as your normal user, not administrator):

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

### The script says "No approved URLs found"

Open `scripts/url_config.yaml`, fill in real URLs, and set `approved: true`.

### A page collected successfully but has no features

Run `python scripts/run_feature_extraction.py`. If that page still has no features,
check whether `data/raw/html/<page_id>.html` exists and is non-empty.

### `lxml` installation fails on Windows

Replace lxml with the built-in parser by editing `config.py`.
The extractor already falls back to `html.parser` automatically.

### A page returns HTTP 429 (Too Many Requests)

Increase `REQUEST_DELAY_SECONDS` in `src/config.py` (try 5 or 10 seconds),
then re-run collection for that URL.

---

## 9. Design Decisions

### Why static HTML only?

Phase 2 deliberately avoids JavaScript execution. Executing JavaScript (e.g. via
Playwright or Selenium) would require a full browser, is slower, and can trigger
bot detection systems. Static HTML collection is simpler, faster, and more transparent.
Phase 3 may extend this if needed.

### Why are image sizes stored as missing rather than zero?

Reporting zero for an unknown value creates false data. If the model were trained on
a dataset where "total_image_size_kb = 0" actually means "we didn't measure it", the
model would learn incorrect associations. Missing values must be handled explicitly
during model preprocessing.

### Why is estimated_page_weight_kb only the HTML?

Downloading every referenced image, script, and stylesheet for 120 pages would be
bandwidth-intensive and ethically borderline. The HTML size is a real, measurable
quantity. It is documented clearly so nobody misinterprets it.

### Why is there an explicit approval gate in url_config.yaml?

An automated crawler that freely follows links could accidentally collect private pages,
authenticated content, or pages that disallow crawling. Requiring human approval for
every URL makes the boundary of what is collected fully explicit and auditable.

---

## 10. What Still Needs Human Input

Before the pipeline can produce an ML-ready dataset, you must:

- [ ] **Populate `scripts/url_config.yaml`** with 20 real, manually reviewed URLs.
- [ ] **Set `approved: true`** for each URL after checking robots.txt and terms of service.
- [ ] **Run the collection pipeline** (`python scripts/run_collection.py`).
- [ ] **Run feature extraction** (`python scripts/run_feature_extraction.py`).
- [ ] **Manually complete annotations** in `data/annotations/annotations.csv`:
  - Add one row per successfully collected page.
  - Fill in all seven label columns (0, 1, or blank for unknown).
  - Set `annotation_status` to `reviewed` when done.
  - Annotate 2–3 pages independently with a second reviewer.
- [ ] **Run validation** (`python scripts/run_validation.py`) and fix all ERRORs.
- [ ] **Review and document** the label distribution (roughly balanced datasets
  produce better ML models).

---

*ByteLess ML Engine — Phase 2: Dataset Collection*
*Built as part of the ByteLess project. Do not train models on this data until
annotations are complete and the validation report shows no errors.*

