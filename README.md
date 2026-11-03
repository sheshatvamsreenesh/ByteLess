# ByteLess

**Less data. Same knowledge.**

ByteLess converts webpages and uploaded documents into lighter, readable content. It uses a React/Vite frontend, a FastAPI conversion service, local IndexedDB for offline saves, and optional Supabase accounts and cloud history.

## Stack

- Frontend: React 19, TypeScript, Vite, Tailwind CSS v4
- Backend: FastAPI, HTTPX, Readability, BeautifulSoup, PyMuPDF, Pillow
- Optional account storage: Supabase Auth and PostgreSQL
- ML utilities: Python collection and feature extraction under `ml-engine/`

## Run locally

Requirements: Node.js 18+, Python 3.10+.

### FastAPI backend

In a terminal from the repository root:

```sh
cd backend
python -m venv .venv

# Linux/macOS
source .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1

pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --env-file .env --host 127.0.0.1 --port 8000 --reload
```

The API runs at `http://127.0.0.1:8000`. `BYTELESS_CORS_ORIGINS` controls allowed frontend origins. `GEMINI_API_KEY` is optional and belongs only in `backend/.env`; do not put it in a `VITE_*` variable.

### React frontend

In a second terminal from the repository root:

```sh
cp .env.example .env.local
npm install
npm run dev
```

Vite runs at `http://localhost:3000`. The default backend URL is `http://localhost:8000`; set `VITE_BYTELESS_API_BASE_URL` in `.env.local` if it differs. Restart Vite after changing environment variables.

## Features

### Web and HTML conversion

- `POST /api/convert` fetches publicly accessible HTTP(S) pages, validates DNS and redirect destinations, extracts article content, sanitizes output, and reports document byte metrics.
- `POST /api/text/convert` normalizes pasted text or HTML.
- `POST /api/html/optimize` optimizes eligible embedded images in uploaded `.html` or `.htm` files.
- Light, Ultra, and Terminal modes control the delivered article. Ultra can defer image retrieval through `GET /api/image/proxy`; remote image resources are not fetched during conversion.
- The frontend displays a network advisory when browser network information is available. It is advisory and does not alter or measure network traffic.

The URL converter accepts HTML responses up to 5 MB and blocks localhost, private addresses, and redirects to non-public destinations. It does not execute webpage JavaScript or fetch page subresources during conversion.

Uploaded HTML is limited to 10 MB. Pillow optimization supports embedded static PNG, JPEG, and WebP data images only. PNG uses lossless optimization; JPEG/WebP use the selected quality (1–95), and an image is replaced only if the re-encoded data is smaller. Dimensions, alt text, title, and surrounding figure/caption are retained. Remote/relative images are not fetched or optimized. Unsupported, animated, malformed, oversized (over 5 MB per embedded image or 40 megapixels), or non-beneficial images are preserved and reported.

### PDF tools

The PDF service supports files up to 20 MB and 100 pages. It provides PDF information/thumbnails, selectable text extraction with page ranges, image compression, page rendering to PNG ZIP, page reordering/deletion, Markdown export, and DOCX export. PDF text extraction does not run OCR; scanned PDFs are detected and reported. Compression creates a new download and preserves the original. PyMuPDF is offered under AGPL-3.0 or a commercial license; review that license before distributing or hosting the backend.

### Reader and scorecard

The Reader includes adjustable typography, progress and estimated reading time, browser text-to-speech, HTML/TXT/Markdown export, translation, and summary actions. Translation and summary requests use the FastAPI provider implementation. Configure `GEMINI_API_KEY` in `backend/.env` for Gemini-backed processing; the backend also provides its documented fallback behavior when no key is set. These services receive the text/HTML sent to the backend.

The performance scorecard compares measured input and converted document bytes, including when output is larger. It reports image counts and script/tracker-like detection separately from their absence in the converted output. Tracker removal is not network blocking. The optional load-time comparison is an **estimate** based on document bytes, an assumed throughput of 250 Kbps, and an assumed 300 ms round-trip latency. It excludes third-party subresources, headers, and network compression; it is not a measured page load or network transfer. ByteLess does not claim measured bandwidth, carbon, or monetary savings.

### Offline saved content

Reader's save control persists documents in IndexedDB. Saved Content supports search, open, confirmed deletion, and TXT/Markdown export. Local saved documents remain available after refresh and offline; linked media may still need a connection. The production service worker caches only the app shell and built assets, not API or Supabase responses.

```sh
npm run build
npm run preview
```

Visit the preview online once before testing offline navigation.

### Supabase accounts and cloud history

Supabase is optional. Without configuration, conversion, Reader, and IndexedDB continue to work. The Account page supports email sign-up/sign-in, sign-out, persisted sessions, and display-name updates. Supabase Auth uses the official `@supabase/supabase-js` client.

1. Create a Supabase project and copy its Project URL and **publishable key** from the project API settings. Put these values in the root `.env.local`:

   ```dotenv
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=your-sb_publishable-key
   ```

   Supabase's legacy `anon` key is also accepted. These are public client credentials. Never place a Supabase `service_role` or secret key in frontend code or `VITE_*` variables. Publishable keys are intended for browser clients; secret keys bypass RLS and must stay in trusted server environments. [Supabase API key guidance](https://supabase.com/docs/guides/getting-started/api-keys)

2. Apply [`supabase/migrations/20261103000000_initial_schema.sql`](supabase/migrations/20261103000000_initial_schema.sql) in the Supabase SQL Editor, or use the CLI after `supabase init` and `supabase link --project-ref YOUR_PROJECT_REF`, then run `supabase db push`. The migration creates profiles, optimization history, file metadata, and optimization statistics tables, indexes, constraints, a profile creation trigger, and RLS policies. Policies restrict each table to the authenticated owner; file/statistics rows also have owner-matched foreign keys. Supabase recommends RLS for exposed tables and policies based on `auth.uid()`. [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security)

3. In Supabase Authentication → URL Configuration, set the deployed site URL and add the local (`http://localhost:3000`) and deployed ByteLess URLs to the redirect allow list. Set email confirmation and password rules under Authentication → Providers to match your deployment.

Cloud history sync is off by default and its preference is stored per account. On the Account page, enable future sync or explicitly sync local saved/active documents. The Saved page displays the latest 100 cloud entries separately from the offline library. Cloud history stores converted HTML/text and measured metadata; original uploaded PDF/HTML binaries stay in the browser. File metadata contains only the filename, MIME type, and byte counts. Combined converted HTML/text over 5 MB is not synced. Cloud history requires internet and is not cached offline.

The FastAPI service remains stateless for account storage. The authenticated frontend writes user-specific data directly to Supabase with the user's session; PostgreSQL RLS enforces ownership. The backend does not need a Supabase service-role credential. Existing upload validation and URL SSRF protections remain in place.

For deployment, set `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_BYTELESS_API_BASE_URL` in the frontend build environment; configure backend CORS for the deployed frontend; apply the migration; and add the production URL to Supabase Auth's redirect allow list. Never commit `.env.local`, `backend/.env`, or production secrets.

## Environment files

- Root `.env.example` → copy to `.env.local`; contains frontend API URL and Supabase public variable names only.
- `backend/.env.example` → copy to `backend/.env`; contains backend CORS settings and an empty optional Gemini key.

## Checks

```sh
npm run lint
npm test
npm run build
python -m unittest discover -s backend -v
```

Automated tests do not contact a live Supabase project. After configuring Supabase, manually verify sign-up/email confirmation, sign-in/out, profile updates, sync, deletion, and that two test users cannot read each other's rows. `supabase test db` can be used for database policy tests when the Supabase CLI/local database is available.

---

Built with ❤️ by Team ByteLess.
