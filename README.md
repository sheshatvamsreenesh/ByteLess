# ByteLess

**Less data. Same knowledge.**

An AI-powered low-bandwidth web content converter that transforms heavy webpages into lightweight, readable experiences while preserving essential information.

## Project Status

Frontend foundation created. Core functionality is under development.

## Tech Stack

- React
- TypeScript
- Vite
- Tailwind CSS

## Run Locally

### Prerequisites
- Node.js

### Installation

1. Clone the repository:

   `git clone https://github.com/sheshatvamsreenesh/ByteLess.git`

2. Navigate into the project:

   `cd ByteLess`

3. Install dependencies:

   `npm install`

4. Start the development server:

   `npm run dev`

### URL conversion backend

The URL conversion interface requires the FastAPI service in `backend/`. In one terminal:

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
cp backend/.env.example backend/.env
uvicorn main:app --app-dir backend --env-file backend/.env --host 127.0.0.1 --port 8000
```

The Convert workspace also supports PDFs up to 20 MB and 100 pages: it extracts selectable text, compresses embedded images with a 1–100 JPEG quality setting, and exports page renders as PNG files in a ZIP (up to 30 pages, rendered at 120 DPI). Compression returns a new download and never replaces the source upload. Size reports use the actual source and output byte lengths. Image-only scans are previewable and can be rendered, but text extraction does not run OCR; encrypted and malformed PDFs are rejected. PDF operations use PyMuPDF, which is offered under AGPL-3.0 or a commercial license; review that licensing before distributing or deploying this backend.

### Image optimization and performance reporting

Uploaded `.html` and `.htm` files can optimize supported **embedded static PNG, JPEG, and WebP data images** through `POST /api/html/optimize`. Install the backend requirements (including Pillow) before using it. PNG processing uses Pillow's lossless optimizer; JPEG and WebP use the selected quality (1–95) and replace an image only when the re-encoded bytes are smaller. Image dimensions and the HTML image element are retained, including its alt text, title, and surrounding figure/caption. Animated, unsupported, malformed, oversized (over 5 MB encoded image or 40 megapixels), or non-beneficial conversions are left in place and reported. HTML uploads are limited to 10 MB. The browser continues sanitization if the optimizer service is unreachable and reports that optimization was skipped.

Remote and relative images are never fetched or altered by this optimizer. URL conversion leaves remote images alone and counts source images missing from extracted article HTML as omitted; Ultra and Terminal replace article images with text markers and report them as deferred. The PDF text export reports raster image objects omitted from its plain-text result; it does not count vector art. Image counts describe the converted document, not network requests.

The Reader scorecard reports source and converted **document** byte sizes, actual byte difference (including when output is larger), image counts, script detection/removal, tracker-like reference detection/removal, conversion mode, and processing notes. Script removal is checked against output; tracker detection is a heuristic over recognizable resource references and inline-script text, and absence from output is checked separately. Neither indicates that network requests were blocked. Size comparisons use the input document bytes and generated Reader HTML (or, for PDF extraction, source PDF bytes and UTF-8 text bytes); they do not measure whole-page weight, subresource traffic, transfer compression, load time, bandwidth, carbon, or monetary savings. No connection-speed estimates are shown.

In another terminal, configure the frontend API address (the default is already suitable for local development) and run Vite:

```sh
cp .env.example .env.local
npm run dev
```

Set `VITE_BYTELESS_API_BASE_URL` in `.env.local` if the backend runs elsewhere. Configure `BYTELESS_CORS_ORIGINS` on the backend with the exact frontend origins permitted to call it; the defaults allow Vite on localhost:3000. `backend/.env.example` documents this setting. The endpoint fetches only public HTTP(S) HTML, pins each connection to a DNS-validated public IP, validates redirect destinations, and caps the decoded response body at 5 MB. Tracker counts are recognizable tracker-like references in the fetched HTML; scripts never execute and page subresources are not fetched, and detected tracker elements are omitted from the converted output.

### Saved documents and offline use

Reader's bookmark control saves the active converted document to the Saved Content library in IndexedDB. The library persists across reloads, supports search, open, and confirmed deletion, and offers TXT and Markdown downloads. Saved text remains available offline on this device; linked remote images/media may still need a connection, and converting a new webpage requires internet access. Legacy localStorage saves are migrated into IndexedDB on first library access. Storage quota and browser-storage errors are surfaced in the interface.

The service worker is enabled for production builds only. To exercise offline navigation locally, build and serve the production app, visit it once while online, then switch the browser offline:

```sh
npm run build
npm run preview
```

It pre-caches the same-origin app shell and the built `/assets/` JavaScript/CSS referenced by it. It bypasses API, cross-origin, and other requests, and skips private or `no-store` responses. The app shell must be installed online once before it can be reopened offline; external web fonts may be unavailable offline.

### Reader speech, translation, and summaries

The Reader uses the browser's built-in SpeechSynthesis API and lists only voices and language tags reported by the browser/operating system. Availability and playback behavior vary by browser and installed voices. ByteLess does not send text to its own speech service; the selected system voice may have its own platform-specific processing and privacy behavior.

Translation and AI summarization are unavailable because this repository has no configured provider endpoint or credentials. The installed `@google/genai` package is not wired into the application. Reader content is not sent to a translation or summarization provider. Enabling either later requires a real backend provider integration, server-side secret configuration, and clear user disclosure/consent because document text would leave the device.

## Project Vision

Make web content accessible even on slow or limited internet connections by intelligently removing unnecessary page weight while preserving meaningful information.

---

Built with ❤️ by Team ByteLess.
