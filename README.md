# ByteLess

**Less data. Same knowledge.**

An AI-powered low-bandwidth web content converter that transforms heavy webpages into lightweight, readable experiences while preserving essential information.

## Project Status

Core feature implementation completed across the React frontend and FastAPI backend.

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, Lucide Icons, Motion
- **Backend**: FastAPI, Uvicorn, HTTPX, Readability-lxml, BeautifulSoup4, PyMuPDF, Pillow, python-docx, pytesseract
- **ML Engine**: Python-based dataset collection pipeline, 30-feature DOM extraction, deterministic safety & content-preservation rules

## Run Locally

### Prerequisites
- Node.js (v18+)
- Python (3.10+)

### 1. Backend Service (FastAPI)

In one terminal:

```sh
cd backend
python -m venv .venv

# On Linux/macOS:
source .venv/bin/activate
# On Windows PowerShell:
.\.venv\Scripts\Activate.ps1

pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --env-file .env --host 127.0.0.1 --port 8000 --reload
```

Backend will be running at `http://127.0.0.1:8000`.

### 2. Frontend Application (React + Vite)

In a second terminal:

```sh
# In repository root:
npm install
npm run dev
```

Frontend will be running at `http://localhost:3000`.

---

## Features & Endpoints

### 1. Intelligent Content Extraction & Modes
- `POST /api/convert`: Remote URL conversion with DNS validation, private IP/SSRF blocking, Readability article extraction, and script/tracker stripping.
- `POST /api/text/convert`: Pasted text and raw HTML normalization into semantic article structures.
- `POST /api/html/optimize`: Optimizes embedded PNG/JPEG/WebP images in uploaded HTML files with configurable quality.
- **Three Delivery Modes**:
  - **Light Mode**: Full semantic article structure with optimized inline visuals.
  - **Ultra Mode**: Text-first delivery with interactive on-demand deferred image retrieval.
  - **Terminal Mode**: Minimalist plain text and Markdown formatting for extreme low-bandwidth scenarios.
- **Adaptive Bandwidth Selection**: Advises users on low-bandwidth connections (2G/3G/Save-Data) using the Network Information API.

### 2. Deferred Image Retrieval (Ultra Mode)
- `GET /api/image/proxy?url={url}&quality={quality}`: Secure proxy fetching deferred images on demand with SSRF defense, size checks, and WebP compression.

### 3. Complete PDF Processing Suite
- `POST /api/pdf/info`: Returns metadata and thumbnail previews for PDF pages.
- `POST /api/pdf/extract`: Extracts selectable text with start/end page range support and scanned document detection.
- `POST /api/pdf/compress`: Recompresses embedded raster images at configurable quality (1–100).
- `POST /api/pdf/images`: Exports all PDF pages as a ZIP archive of high-resolution PNGs.
- `POST /api/pdf/edit`: Reorders, removes, and extracts selected page ranges, producing a downloadable modified PDF.
- `POST /api/pdf/to-markdown`: Converts PDF pages to structured Markdown.
- `POST /api/pdf/to-docx`: Converts PDF pages into editable Microsoft Word (.docx) documents.
- **Frontend PDF Editor**: Visual thumbnail grid with page reordering, page deletion, range selection, and instant exports.

### 4. Intelligent Reader
- **Typography & Progress**: Adjustable font sizes, reading progress percentage, and estimated reading time.
- **English <-> Hindi Translation** (`POST /api/translate`): Translates leaf text nodes while preserving exact HTML tags and document structure.
- **AI Summary** (`POST /api/summarize`): Generates 3–5 bullet points using Gemini (when `GEMINI_API_KEY` is provided) or an intelligent local extractive summary fallback.
- **Voice Reading**: Browser-based text-to-speech using the Web Speech API with play, pause, resume, stop, and voice/language selection.
- **Theme**: Fixed warm off-white / light visual theme throughout.

### 5. Content Integrity & Live Savings Scorecard
- Real document byte measurements (original vs. converted bytes and true percentage reduction).
- Detailed breakdown of elements preserved (headings, paragraphs, lists, tables, links, images).
- Clear tracking of scripts removed and tracker references stripped from output (without false claims of network-level packet interception).
- Estimated 2G load time comparisons based on measured document sizes.

### 6. Offline-First Saved Content
- Persistent local storage using IndexedDB (`byteless-documents`).
- Searchable personal library, reader integration, and export to TXT or Markdown.
- Service worker caching for the application shell in production builds (`npm run build && npm run preview`).

### 7. ML Adaptive Intelligence Engine
- `POST /api/ml/recommend`: Analyzes DOM features and recommends optimal delivery mode and actions.
- Features hybrid adapter that switches seamlessly from deterministic safety rules to serialized model weights once Phase 3 model training completes.

---

## Environment Variables

### Backend (`backend/.env`)
- `BYTELESS_CORS_ORIGINS`: Comma-separated frontend origins (default: `http://localhost:3000,http://127.0.0.1:3000`).
- `GEMINI_API_KEY`: (Optional) Google Gemini API key for generative summaries and translation. If unset, ByteLess falls back to local extractive summarization and web translation automatically.

### Frontend (`.env.local`)
- `VITE_BYTELESS_API_BASE_URL`: Backend API base URL (default: `http://localhost:8000`).

---

## Testing

```sh
# Run backend tests (Python):
python -m unittest discover -s backend -p "test_*.py"

# Run frontend tests (TypeScript):
npx tsx --test src/lib/*.test.ts

# Run TypeScript typecheck:
npm run lint

# Build production bundle:
npm run build
```

---

Built with ❤️ by Team ByteLess.
