from __future__ import annotations

import asyncio
import base64
import binascii
import io
import ipaddress
import json
import os
import re
import socket
import ssl
import zipfile
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urljoin, urlparse, urlsplit, urlunsplit

import httpcore
import httpx
from bs4 import BeautifulSoup, Comment
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field
from readability import Document
import pymupdf
from PIL import Image, UnidentifiedImageError
from starlette.concurrency import run_in_threadpool

# Optional imports
try:
    import docx
except ImportError:
    docx = None

try:
    import pytesseract
except ImportError:
    pytesseract = None

# ML adapter
import ml_adapter

MAX_BYTES = 5 * 1024 * 1024
MAX_PDF_BYTES = 20 * 1024 * 1024
MAX_PDF_PAGES = 100
MAX_HTML_BYTES = 10 * 1024 * 1024
MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024
MAX_INLINE_IMAGE_PIXELS = 40_000_000
MAX_REDIRECTS = 5
TIMEOUT = httpx.Timeout(12.0, connect=4.0)

ALLOWED_TAGS = {
    "article", "main", "section", "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "ul", "ol", "li", "blockquote", "pre", "code", "table", "thead",
    "tbody", "tr", "th", "td", "a", "img", "strong", "b", "em", "i",
    "br", "hr", "figure", "figcaption", "div", "span", "button",
}

DROP_TAGS = {
    "script", "style", "noscript", "iframe", "form", "nav", "footer",
    "header", "aside", "svg", "canvas", "object", "embed", "link", "meta",
}

TRACKER_HINTS = (
    "analytics", "track", "pixel", "beacon", "doubleclick",
    "googletagmanager", "facebook.net", "adsystem", "telemetry",
)

DECORATIVE_HINTS = (
    "banner", "sponsor", "advert", "popup", "newsletter", "cookie-banner",
    "social-share", "sidebar-ad",
)

app = FastAPI(title="ByteLess conversion service", version="1.1.0")

origins = [
    x.strip()
    for x in os.getenv("BYTELESS_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    if x.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=[
        "X-Original-Bytes", "X-Converted-Bytes", "X-Bytes-Saved",
        "X-Reduction-Percent", "X-Page-Count", "Content-Disposition",
    ],
)


# ── Request Models ────────────────────────────────────────────────────────────

class ConvertRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2048)
    mode: str = "light"


class PastedTextRequest(BaseModel):
    text: str = Field(min_length=1, max_length=10_000_000)
    title: Optional[str] = None
    mode: str = "light"


class SummarizeRequest(BaseModel):
    text: str = Field(min_length=10)
    title: Optional[str] = None


class TranslateRequest(BaseModel):
    html: str = Field(min_length=1)
    source_lang: str = "en"
    target_lang: str = "hi"


class MLRecommendRequest(BaseModel):
    html: Optional[str] = None
    url: Optional[str] = None
    text: Optional[str] = None


# ── Security & URL Validation ─────────────────────────────────────────────────

async def validate_public_url(value: str) -> str:
    """Validates that a URL is a public http(s) address to prevent SSRF."""
    try:
        parts = urlsplit(value.strip())
        if parts.scheme.lower() not in ("http", "https") or not parts.hostname:
            raise ValueError("Only http and https URLs are supported.")
        if parts.username or parts.password:
            raise ValueError("URLs containing credentials are not supported.")
        host = parts.hostname.rstrip(".").encode("idna").decode("ascii")
        if host.lower() in {"localhost", "localhost.localdomain"} or host.lower().endswith(
            (".localhost", ".local", ".internal", ".test")
        ):
            raise ValueError("Local and internal hosts are not allowed.")
        await public_addresses(host, parts.port or (443 if parts.scheme == "https" else 80))
        netloc = f"[{host}]" if ":" in host else host
        if parts.port:
            netloc += f":{parts.port}"
        return urlunsplit((parts.scheme.lower(), netloc, parts.path or "/", parts.query, ""))
    except asyncio.TimeoutError as exc:
        raise HTTPException(status_code=504, detail="DNS lookup took too long.") from exc
    except (ValueError, UnicodeError, socket.gaierror, OSError) as exc:
        raise HTTPException(status_code=400, detail=str(exc) or "Invalid or unresolvable URL.") from exc


async def public_addresses(host: str, port: int) -> list[str]:
    try:
        addresses = [ipaddress.ip_address(host)]
    except ValueError:
        infos = await asyncio.wait_for(
            asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM),
            timeout=TIMEOUT.connect,
        )
        addresses = [ipaddress.ip_address(info[4][0].split("%")[0]) for info in infos]
    if not addresses or any(not address.is_global for address in addresses):
        raise ValueError("The URL resolves to a non-public network address.")
    return [str(address) for address in addresses]


class ValidatingNetworkBackend(httpcore.AsyncNetworkBackend):
    def __init__(self):
        self.backend = httpcore._backends.auto.AutoBackend()

    async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        addresses = await public_addresses(host, port)
        return await self.backend.connect_tcp(
            addresses[0], port, timeout=timeout, local_address=local_address, socket_options=socket_options
        )

    async def connect_unix_socket(self, path, timeout=None, socket_options=None):
        raise OSError("Unix domain sockets are disabled.")

    async def sleep(self, seconds):
        await self.backend.sleep(seconds)


class PinnedAsyncHTTPTransport(httpx.AsyncHTTPTransport):
    def __init__(self):
        super().__init__(trust_env=False, limits=httpx.Limits(max_connections=4, max_keepalive_connections=0))
        self._pool = httpcore.AsyncConnectionPool(
            ssl_context=ssl.create_default_context(),
            max_connections=4,
            max_keepalive_connections=0,
            retries=0,
            network_backend=ValidatingNetworkBackend(),
        )


async def fetch_page(value: str) -> tuple[bytes, str, str]:
    current = await validate_public_url(value)
    async with httpx.AsyncClient(
        transport=PinnedAsyncHTTPTransport(),
        timeout=TIMEOUT,
        follow_redirects=False,
        trust_env=False,
        headers={"User-Agent": "ByteLessReader/1.0 (+https://github.com/sheshatvamsreenesh/ByteLess)"},
    ) as client:
        for _ in range(MAX_REDIRECTS + 1):
            current = await validate_public_url(current)
            try:
                async with client.stream("GET", current, headers={"Accept": "text/html,application/xhtml+xml"}) as response:
                    if response.status_code in (301, 302, 303, 307, 308):
                        location = response.headers.get("location")
                        if not location:
                            raise HTTPException(502, "The website returned an invalid redirect.")
                        current = urljoin(current, location)
                        continue
                    if response.status_code >= 400:
                        raise HTTPException(502, f"The website returned HTTP {response.status_code}.")
                    content_type = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
                    if content_type not in ("text/html", "application/xhtml+xml"):
                        raise HTTPException(415, f"Unsupported content type: {content_type or 'unknown'}.")
                    length = response.headers.get("content-length")
                    if length and int(length) > MAX_BYTES:
                        raise HTTPException(413, "The webpage is larger than the 5 MB limit.")
                    chunks = bytearray()
                    async for chunk in response.aiter_bytes():
                        chunks.extend(chunk)
                        if len(chunks) > MAX_BYTES:
                            raise HTTPException(413, "The webpage is larger than the 5 MB limit.")
                    return bytes(chunks), current, response.encoding or "utf-8"
            except httpx.TimeoutException as exc:
                raise HTTPException(504, "The website took too long to respond.") from exc
            except httpx.RequestError as exc:
                raise HTTPException(502, "Could not connect to that website.") from exc
        raise HTTPException(502, "The website redirected too many times.")


def safe_link(value: str, base: str) -> str | None:
    target = urljoin(base, value)
    if urlsplit(target).scheme.lower() in ("http", "https", "mailto"):
        return target
    return None


def detect_trackers(page: bytes) -> int:
    """Count recognizable tracker-like resource references in HTML."""
    soup = BeautifulSoup(page, "html.parser")
    count = 0
    for node in soup.find_all(["script", "iframe", "img", "link"]):
        reference = " ".join([str(node.get("src", "")), str(node.get("href", ""))]).lower()
        if reference.startswith("data:"):
            reference = ""
        inline = (node.string or "").lower() if node.name == "script" else ""
        if any(hint in reference or hint in inline for hint in TRACKER_HINTS):
            count += 1
    return count


def clean_content(fragment: str, base: str, mode: str) -> tuple[str, int, int, int, int]:
    """
    Cleans HTML content, sanitizes XSS, handles mode-specific image logic,
    and returns (html, removed_count, tracker_count, images_deferred, ads_removed).
    """
    soup = BeautifulSoup(fragment, "html.parser")
    removed = 0
    tracker_count = 0
    images_deferred = 0
    ads_removed = 0

    for comment in soup.find_all(string=lambda s: isinstance(s, Comment)):
        comment.extract()

    for node in list(soup.find_all(True)):
        if node.name in DROP_TAGS:
            haystack = (str(node) + " " + " ".join(node.get("class", []))).lower()
            tracker_count += int(any(hint in haystack for hint in TRACKER_HINTS))
            ads_removed += int(any(hint in haystack for hint in DECORATIVE_HINTS))
            node.decompose()
            removed += 1
            continue

        if node.name not in ALLOWED_TAGS:
            node.unwrap()
            removed += 1
            continue

        image_candidate = str(node.get("src", ""))
        if node.name == "img" and not image_candidate:
            srcset = str(node.get("srcset", ""))
            candidate = re.match(r"\s*(https?://\S+|/\S+|\.\.?/\S+)", srcset, flags=re.I)
            image_candidate = candidate.group(1) if candidate else ""

        if node.name == "img":
            resource = str(node.get("src", "")).lower()
            if any(hint in resource for hint in TRACKER_HINTS):
                node.decompose()
                removed += 1
                tracker_count += 1
                continue

        for attr in list(node.attrs):
            attr_lower = attr.lower()
            if (
                attr_lower.startswith("on")
                or attr_lower in {"style", "srcset"}
                or (attr_lower in {"width", "height"} and not re.fullmatch(r"\d{1,5}", str(node.get(attr, ""))))
            ):
                del node.attrs[attr]

        if node.name == "a":
            href = safe_link(str(node.get("href", "")), base)
            node.attrs = {"href": href} if href else {}
        elif node.name == "img":
            alt = str(node.get("alt", "")).strip()
            preserved_attrs = {"alt": alt}
            if node.get("title"):
                preserved_attrs["title"] = str(node.get("title"))
            for dimension in ("width", "height"):
                if re.fullmatch(r"\d{1,5}", str(node.get(dimension, ""))):
                    preserved_attrs[dimension] = str(node.get(dimension))

            if mode == "ultra":
                img_src = safe_link(image_candidate, base) if image_candidate else ""
                dim_str = f"{node.get('width', '')}x{node.get('height', '')}".strip("x")
                dim_info = f" ({dim_str})" if dim_str else ""
                placeholder = soup.new_tag("div", attrs={
                    "class": "deferred-image-placeholder my-4 p-3 rounded-xl border border-dashed border-neutral-300 bg-neutral-50/70 text-xs font-technical text-neutral-600 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3",
                    "data-src": img_src,
                    "data-alt": alt or "Image",
                    "data-dims": dim_str,
                })
                label_span = soup.new_tag("span")
                label_span.string = f"🖼️ DEFERRED IMAGE: {alt or 'Untitled image'}{dim_info}"
                placeholder.append(label_span)
                if img_src:
                    btn = soup.new_tag("button", attrs={
                        "type": "button",
                        "class": "load-deferred-image-btn px-3 py-1 rounded-full bg-neutral-900 text-neutral-50 text-[11px] font-sans hover:bg-neutral-800 transition-colors cursor-pointer",
                        "data-url": img_src,
                    })
                    btn.string = "Load Image on Demand"
                    placeholder.append(btn)
                node.replace_with(placeholder)
                images_deferred += 1
            elif mode == "terminal":
                node.replace_with(soup.new_string(f"[Image: {alt or 'Image without alternative text'}]"))
                images_deferred += 1
            else:
                src = safe_link(image_candidate, base) if image_candidate else None
                if src:
                    preserved_attrs["src"] = src
                node.attrs = preserved_attrs
        else:
            node.attrs = {k: v for k, v in node.attrs.items() if k in {"colspan", "rowspan", "title", "class", "data-src", "data-url", "data-alt", "data-dims", "type"}}

    if mode == "terminal":
        plain_text = BeautifulSoup(str(soup), "html.parser").get_text("\n", strip=True)
        escaped_text = plain_text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        return f"<pre>{escaped_text}</pre>", removed, tracker_count, images_deferred, ads_removed

    return "".join(str(child) for child in soup.contents), removed, tracker_count, images_deferred, ads_removed


# ── Webpage & Pasted Text Conversion Endpoints ────────────────────────────────

@app.post("/api/convert")
async def convert(request: ConvertRequest):
    mode = request.mode.lower()
    if mode not in {"light", "ultra", "terminal"}:
        raise HTTPException(422, "Mode must be light, ultra, or terminal.")
    raw, final_url, encoding = await fetch_page(request.url)
    tracker_candidates = detect_trackers(raw)
    source_soup = BeautifulSoup(raw, "html.parser")
    source_scripts = len(source_soup.find_all("script"))
    source_images = len(source_soup.find_all("img"))
    page_title = source_soup.title.get_text(" ", strip=True) if source_soup.title else ""
    warnings: list[str] = []
    extraction_failures = 0

    if not page_title:
        warnings.append("The webpage did not provide a title; the source URL is used as the title.")

    try:
        reader = Document(raw, url=final_url)
        title = reader.short_title() or page_title or final_url
        article = reader.summary(html_partial=True)
    except Exception:
        title = page_title or final_url
        article = str(source_soup.body or source_soup)
        warnings.append("Article extraction failed; a cleaned page body was used instead.")
        extraction_failures = 1

    html, removed, _detected_in_article, images_deferred, ads_removed = clean_content(article, final_url, mode)
    if not BeautifulSoup(html, "html.parser").get_text(" ", strip=True):
        raise HTTPException(422, "No readable article content could be extracted from that page.")

    original_size = len(raw)
    converted_size = len(html.encode("utf-8"))
    output_soup = BeautifulSoup(html, "html.parser")

    headings_preserved = len(output_soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6"]))
    paragraphs_preserved = len(output_soup.find_all("p"))
    lists_preserved = len(output_soup.find_all(["ul", "ol"]))
    tables_preserved = len(output_soup.find_all("table"))
    links_preserved = len(output_soup.find_all("a", href=True))

    images_preserved = len(output_soup.select("img[src]"))
    images_omitted = max(0, source_images - images_preserved - images_deferred)
    trackers_in_output = detect_trackers(html.encode("utf-8"))
    trackers_removed = max(0, tracker_candidates - trackers_in_output)

    if images_omitted:
        warnings.append(f"{images_omitted} source image(s) were not present in the extracted article content.")
    scripts_removed = max(0, source_scripts - len(output_soup.find_all("script")))

    # ML adaptive recommendations
    features = ml_adapter.extract_features_from_html(raw.decode(encoding, errors="replace"), urlparse(final_url).netloc)
    ml_recs = ml_adapter.predict_actions(features)

    metrics = {
        "imagesDetected": source_images,
        "imagesPreserved": images_preserved,
        "imagesOptimized": 0,
        "imagesUnchanged": images_preserved,
        "imagesDeferred": images_deferred,
        "imagesOmitted": images_omitted,
        "optimizationFailures": 0,
        "scriptsDetected": source_scripts,
        "scriptsRemoved": scripts_removed,
        "trackersDetected": tracker_candidates,
        "trackersRemoved": trackers_removed,
        "processingDetails": [
            f"Delivery mode: {mode}.",
            "Remote image resources were not fetched or modified during extraction.",
            "Script removal verified against clean document output.",
        ],
        "measurementScope": "Fetched HTML response bytes compared with converted article HTML bytes; excludes subresources and transport compression.",
    }

    categorized_elements = {
        "preserved": {
            "headings": headings_preserved,
            "paragraphs": paragraphs_preserved,
            "lists": lists_preserved,
            "tables": tables_preserved,
            "links": links_preserved,
            "images": images_preserved,
        },
        "removed": {
            "scripts": scripts_removed,
            "trackers": trackers_removed,
            "decorativeAndAds": ads_removed,
            "otherElements": removed,
        },
        "deferred": {
            "images": images_deferred,
        },
        "requiresReview": len(warnings),
    }

    return {
        "title": title,
        "source": final_url,
        "html": html,
        "mode": mode,
        "originalBytes": original_size,
        "convertedBytes": converted_size,
        "bytesSaved": original_size - converted_size,
        "reductionPercent": round((1 - converted_size / original_size) * 100, 2) if original_size else 0,
        "warnings": warnings,
        "integrity": {
            "elementsRemoved": removed,
            "trackersDetected": tracker_candidates,
            "trackersBlocked": 0,
            "trackersRemoved": trackers_removed,
            "imagesDeferred": images_deferred,
            "extractionFailures": extraction_failures,
            "headingsPreserved": headings_preserved,
            "paragraphsPreserved": paragraphs_preserved,
            "listsPreserved": lists_preserved,
            "tablesPreserved": tables_preserved,
            "linksPreserved": links_preserved,
            "categorizedElements": categorized_elements,
            "potentiallyLostImportantContent": [],
        },
        "metrics": metrics,
        "measurement": metrics["measurementScope"],
        "contentEncoding": encoding,
        "ml": ml_recs,
    }


@app.post("/api/text/convert")
async def convert_text(request: PastedTextRequest):
    mode = request.mode.lower()
    if mode not in {"light", "ultra", "terminal"}:
        raise HTTPException(422, "Mode must be light, ultra, or terminal.")

    raw_text = request.text.strip()
    if not raw_text:
        raise HTTPException(422, "Pasted text cannot be empty.")

    original_bytes = len(raw_text.encode("utf-8"))

    # If it's already HTML markup, use it; otherwise construct semantic article HTML
    if bool(re.search(r"<(article|p|h[1-6]|div|table|ul|ol)[^>]*>", raw_text, re.I)):
        fragment = raw_text
        doc_title = request.title or "Pasted Document"
    else:
        escaped = (
            raw_text.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
            .replace("'", "&#39;")
        )
        paragraphs = [p.strip() for p in escaped.split("\n\n") if p.strip()]
        if not paragraphs:
            paragraphs = [escaped]
        first_line = paragraphs[0].split("\n")[0][:100]
        doc_title = request.title or first_line or "Pasted Note"
        article_body = "".join("<p>" + p.replace("\n", "<br>") + "</p>" for p in paragraphs)
        fragment = f"<article><h1>{doc_title}</h1>{article_body}</article>"

    html, removed, tracker_count, images_deferred, ads_removed = clean_content(fragment, "about:blank", mode)
    output_soup = BeautifulSoup(html, "html.parser")
    converted_bytes = len(html.encode("utf-8"))

    headings_preserved = len(output_soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6"]))
    paragraphs_preserved = len(output_soup.find_all("p"))
    lists_preserved = len(output_soup.find_all(["ul", "ol"]))
    tables_preserved = len(output_soup.find_all("table"))
    links_preserved = len(output_soup.find_all("a", href=True))

    metrics = {
        "imagesDetected": 0,
        "imagesPreserved": 0,
        "imagesOptimized": 0,
        "imagesUnchanged": 0,
        "imagesDeferred": 0,
        "imagesOmitted": 0,
        "optimizationFailures": 0,
        "scriptsDetected": 0,
        "scriptsRemoved": 0,
        "trackersDetected": tracker_count,
        "trackersRemoved": tracker_count,
        "processingDetails": [f"Processed pasted text in {mode} mode.", "HTML sanitized and formatted as semantic article."],
        "measurementScope": "Pasted text raw UTF-8 bytes compared with converted HTML bytes.",
    }

    categorized_elements = {
        "preserved": {
            "headings": headings_preserved,
            "paragraphs": paragraphs_preserved,
            "lists": lists_preserved,
            "tables": tables_preserved,
            "links": links_preserved,
            "images": 0,
        },
        "removed": {
            "scripts": 0,
            "trackers": tracker_count,
            "decorativeAndAds": ads_removed,
            "otherElements": removed,
        },
        "deferred": {"images": 0},
        "requiresReview": 0,
    }

    return {
        "title": doc_title,
        "source": "Pasted text",
        "html": html,
        "mode": mode,
        "originalBytes": original_bytes,
        "convertedBytes": converted_bytes,
        "bytesSaved": original_bytes - converted_bytes,
        "reductionPercent": round((1 - converted_bytes / original_bytes) * 100, 2) if original_bytes else 0,
        "warnings": [],
        "integrity": {
            "elementsRemoved": removed,
            "trackersDetected": tracker_count,
            "trackersBlocked": 0,
            "trackersRemoved": tracker_count,
            "imagesDeferred": images_deferred,
            "extractionFailures": 0,
            "headingsPreserved": headings_preserved,
            "paragraphsPreserved": paragraphs_preserved,
            "listsPreserved": lists_preserved,
            "tablesPreserved": tables_preserved,
            "linksPreserved": links_preserved,
            "categorizedElements": categorized_elements,
            "potentiallyLostImportantContent": [],
        },
        "metrics": metrics,
        "measurement": metrics["measurementScope"],
        "contentEncoding": "utf-8",
    }


# ── On-Demand Deferred Image Proxy ───────────────────────────────────────────

@app.get("/api/image/proxy")
async def proxy_deferred_image(url: str = Query(..., min_length=1), quality: int = Query(75, ge=1, le=95)):
    """
    On-demand retrieval for deferred images in Ultra Mode.
    Validates against SSRF, downloads within size limits, compresses, and returns image.
    """
    validated_url = await validate_public_url(url)
    async with httpx.AsyncClient(
        transport=PinnedAsyncHTTPTransport(),
        timeout=httpx.Timeout(8.0, connect=3.0),
        trust_env=False,
    ) as client:
        try:
            resp = await client.get(validated_url, headers={"User-Agent": "ByteLessImageProxy/1.0"})
        except Exception as exc:
            raise HTTPException(502, f"Could not fetch deferred image: {str(exc)[:100]}") from exc

    if resp.status_code != 200:
        raise HTTPException(502, f"Remote image server returned HTTP {resp.status_code}")

    content_type = resp.headers.get("content-type", "").split(";", 1)[0].lower()
    if not content_type.startswith("image/"):
        raise HTTPException(415, "Remote URL did not return an image.")

    raw_bytes = resp.content
    if len(raw_bytes) > MAX_INLINE_IMAGE_BYTES:
        raise HTTPException(413, "Image exceeds 5 MB safety limit.")

    # SVG or unrecognized can be returned directly
    if content_type == "image/svg+xml":
        return Response(content=raw_bytes, media_type="image/svg+xml", headers={"Cache-Control": "public, max-age=86400"})

    try:
        with Image.open(io.BytesIO(raw_bytes)) as img:
            if img.width * img.height > MAX_INLINE_IMAGE_PIXELS:
                raise ValueError("Image exceeds megapixel safety limit.")
            out = io.BytesIO()
            if img.format in ("JPEG", "PNG", "WEBP"):
                if img.mode not in ("RGB", "L") and img.format == "JPEG":
                    img = img.convert("RGB")
                img.save(out, format="WEBP", quality=quality, method=5)
                compressed = out.getvalue()
                if len(compressed) < len(raw_bytes):
                    return Response(
                        content=compressed,
                        media_type="image/webp",
                        headers={
                            "Cache-Control": "public, max-age=86400",
                            "X-Original-Bytes": str(len(raw_bytes)),
                            "X-Converted-Bytes": str(len(compressed)),
                        },
                    )
    except Exception:
        pass

    return Response(content=raw_bytes, media_type=content_type, headers={"Cache-Control": "public, max-age=86400"})


# ── AI Summary & Translation Endpoints ────────────────────────────────────────

@app.post("/api/summarize")
async def summarize_text(req: SummarizeRequest):
    """
    Generates 3-5 concise bullet points.
    Uses Gemini API if GEMINI_API_KEY is configured in backend environment;
    otherwise uses an intelligent extractive local summarizer as a truthful fallback.
    """
    text = req.text.strip()
    if len(text) < 20:
        raise HTTPException(422, "Text is too short to summarize.")

    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()

    if gemini_key:
        try:
            from google import genai
            client = genai.Client(api_key=gemini_key)
            prompt = (
                f"You are the ByteLess Reading Assistant. Provide a concise summary of the following article "
                f"in exactly 3 to 5 clear bullet points. Return only the bullet points starting with '• '.\n\n"
                f"Article Title: {req.title or 'Untitled'}\n\nContent:\n{text[:12000]}"
            )
            response = await run_in_threadpool(
                lambda: client.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=prompt,
                )
            )
            bullet_points = [
                line.strip().lstrip("•*- ").strip()
                for line in (response.text or "").splitlines()
                if line.strip() and not line.strip().lower().startswith("summary")
            ]
            bullet_points = [bp for bp in bullet_points if len(bp) > 5][:5]
            if bullet_points:
                return {
                    "summary": bullet_points,
                    "provider": "Gemini AI (Cloud)",
                    "label": "AI-Generated Summary",
                    "bullets": bullet_points,
                }
        except Exception as exc:
            # Fall through to extractive summarizer on API error
            pass

    # Intelligent Local Extractive Fallback
    paragraphs = [p.strip() for p in text.split("\n") if len(p.strip()) > 30]
    sentences: list[str] = []
    for p in paragraphs:
        for s in re.split(r"(?<=[.!?])\s+", p):
            s_clean = s.strip()
            if 20 <= len(s_clean) <= 250 and not s_clean.startswith(("#", "<", "{")):
                sentences.append(s_clean)

    if not sentences:
        sentences = [text[:200]]

    # Rank sentences by length, position, and information keywords
    ranked = sorted(
        sentences,
        key=lambda s: len(re.findall(r"[A-Za-z0-9]", s)) - (len(s) > 200) * 50,
        reverse=True,
    )
    chosen = ranked[:4] if len(ranked) >= 4 else ranked[:len(ranked)]
    # Preserve original flow
    chosen_in_order = [s for s in sentences if s in chosen]

    return {
        "summary": chosen_in_order or [sentences[0]],
        "provider": "ByteLess Local Extractive Engine",
        "label": "Extractive Summary (Offline / Local Rule-based)",
        "bullets": chosen_in_order or [sentences[0]],
        "notice": "Configure GEMINI_API_KEY in backend/.env to activate generative Gemini AI summaries.",
    }


@app.post("/api/translate")
async def translate_content(req: TranslateRequest):
    """
    Translates HTML content between English and Hindi.
    Preserves all headings, paragraphs, lists, and HTML structure by only translating text nodes.
    """
    source_lang = req.source_lang.lower().strip()
    target_lang = req.target_lang.lower().strip()

    valid_langs = {"en", "hi"}
    if source_lang not in valid_langs or target_lang not in valid_langs or source_lang == target_lang:
        raise HTTPException(422, "Supported translation pairs are English to Hindi (en -> hi) and Hindi to English (hi -> en).")

    soup = BeautifulSoup(req.html, "html.parser")
    # Identify unique text strings
    text_nodes: list[Any] = []
    for element in soup.find_all(True):
        if element.name in DROP_TAGS or element.name in ("pre", "code"):
            continue
        for child in list(element.children):
            if isinstance(child, str) and not isinstance(child, Comment) and child.strip():
                if len(child.strip()) > 1 and not re.fullmatch(r"[\d\s.,/#!$%^&*;:{}=\-_`~()]+", child.strip()):
                    text_nodes.append(child)

    if not text_nodes:
        return {"translatedHtml": str(soup), "sourceLang": source_lang, "targetLang": target_lang}

    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()

    # Tier 1: Gemini Translation if configured
    if gemini_key:
        try:
            from google import genai
            client = genai.Client(api_key=gemini_key)
            distinct_texts = list(dict.fromkeys(node.string.strip() for node in text_nodes if node.string))
            # Batch in chunks of 40
            translations: dict[str, str] = {}
            chunk_size = 30
            for i in range(0, len(distinct_texts), chunk_size):
                chunk = distinct_texts[i:i + chunk_size]
                prompt = (
                    f"Translate the following JSON array of strings from {source_lang} to {target_lang}. "
                    f"Return ONLY valid JSON array containing the exact same number of translated strings in the same order.\n\n"
                    f"{json.dumps(chunk, ensure_ascii=False)}"
                )
                res = await run_in_threadpool(
                    lambda: client.models.generate_content(
                        model="gemini-2.5-flash",
                        contents=prompt,
                    )
                )
                match = re.search(r"\[.*\]", res.text or "", re.DOTALL)
                if match:
                    translated_list = json.loads(match.group(0))
                    for orig, trans in zip(chunk, translated_list):
                        translations[orig] = trans

            for node in text_nodes:
                orig = node.string.strip()
                if orig in translations:
                    node.replace_with(translations[orig])

            return {
                "translatedHtml": str(soup),
                "sourceLang": source_lang,
                "targetLang": target_lang,
                "provider": "Gemini AI",
            }
        except Exception:
            pass

    # Tier 2: Free web translation API via httpx
    try:
        distinct_texts = list(dict.fromkeys(node.string.strip() for node in text_nodes if node.string))
        translations: dict[str, str] = {}
        async with httpx.AsyncClient(timeout=10.0) as client:
            for text_chunk in distinct_texts[:40]:  # Cap for speed
                api_url = (
                    f"https://translate.googleapis.com/translate_a/single"
                    f"?client=gtx&sl={source_lang}&tl={target_lang}&dt=t&q={httpx.URL('', params={'q': text_chunk}).params['q']}"
                )
                r = await client.get(api_url)
                if r.status_code == 200:
                    data = r.json()
                    translated_str = "".join(seg[0] for seg in data[0] if seg and seg[0])
                    if translated_str:
                        translations[text_chunk] = translated_str

        for node in text_nodes:
            orig = node.string.strip()
            if orig in translations:
                node.replace_with(translations[orig])

        return {
            "translatedHtml": str(soup),
            "sourceLang": source_lang,
            "targetLang": target_lang,
            "provider": "Web Translation Engine",
        }
    except Exception as exc:
        raise HTTPException(
            503,
            "Translation service is currently unreachable. Check network connectivity or set GEMINI_API_KEY in backend/.env.",
        ) from exc


# ── ML Adaptive Intelligence Recommendations ─────────────────────────────────

@app.post("/api/ml/recommend")
async def ml_recommend(req: MLRecommendRequest):
    html_content = req.html or ""
    if not html_content and req.text:
        html_content = f"<article><p>{req.text}</p></article>"
    if not html_content:
        raise HTTPException(422, "Provide HTML or text content to analyze.")

    features = ml_adapter.extract_features_from_html(html_content)
    recommendations = ml_adapter.predict_actions(features)
    return recommendations


# ── PDF Processing Suite ──────────────────────────────────────────────────────

async def read_pdf_upload(file: UploadFile) -> tuple[bytes, str]:
    filename = Path(file.filename or "document.pdf").name
    content_type = (file.content_type or "").split(";", 1)[0].lower()
    if not filename.lower().endswith(".pdf") or content_type not in ("application/pdf", "application/octet-stream", ""):
        raise HTTPException(415, "Choose a PDF file.")
    data = await file.read(MAX_PDF_BYTES + 1)
    if len(data) > MAX_PDF_BYTES:
        raise HTTPException(413, "PDF files must be 20 MB or smaller.")
    if b"%PDF-" not in data[:1024]:
        raise HTTPException(415, "The uploaded file is not a valid PDF document.")
    return data, filename


def open_pdf(data: bytes):
    try:
        document = pymupdf.open(stream=data, filetype="pdf")
    except Exception as exc:
        raise HTTPException(422, "The PDF is malformed or could not be opened.") from exc
    if document.needs_pass:
        document.close()
        raise HTTPException(422, "Password-protected PDFs are not supported.")
    if document.page_count < 1:
        document.close()
        raise HTTPException(422, "The PDF contains no pages.")
    if document.page_count > MAX_PDF_PAGES:
        document.close()
        raise HTTPException(413, f"PDFs may contain up to {MAX_PDF_PAGES} pages.")
    return document


def extract_pdf_text(data: bytes, filename: str, start_page: int = 1, end_page: Optional[int] = None) -> dict:
    document = open_pdf(data)
    try:
        total_pages = document.page_count
        start_idx = max(0, start_page - 1)
        end_idx = min(total_pages, end_page) if end_page is not None else total_pages

        extracted_pages = []
        for pno in range(start_idx, end_idx):
            page_text = document[pno].get_text("text", sort=True).strip()
            if page_text:
                extracted_pages.append(f"--- Page {pno + 1} ---\n{page_text}")

        text = "\n\n".join(extracted_pages).strip()

        # Check for scanned PDF
        is_scanned = False
        if not text:
            # Check if document has images
            image_xrefs = {image[0] for page in document for image in page.get_images(full=True) if image and image[0]}
            if image_xrefs and pytesseract:
                is_scanned = True
                try:
                    ocr_texts = []
                    for pno in range(min(5, total_pages)):
                        pix = document[pno].get_pixmap(dpi=150)
                        img = Image.open(io.BytesIO(pix.tobytes("png")))
                        page_ocr = pytesseract.image_to_string(img)
                        if page_ocr.strip():
                            ocr_texts.append(f"--- Page {pno + 1} (OCR) ---\n{page_ocr.strip()}")
                    if ocr_texts:
                        text = "\n\n".join(ocr_texts)
                except Exception:
                    pass

            if not text:
                raise HTTPException(422, "No selectable text was found. This may be a scanned PDF; OCR is not available on this system.")

        text_bytes = text.encode("utf-8")
        title = (document.metadata or {}).get("title", "").strip() or Path(filename).stem
        image_xrefs = {image[0] for page in document for image in page.get_images(full=True) if image and image[0]}
        image_count = len(image_xrefs)
        warnings = ["Embedded PDF images are omitted from the plain-text export."] if image_count else []
        if is_scanned and pytesseract:
            warnings.append("Text was extracted via local OCR engine; accuracy depends on image clarity.")

        return {
            "title": title,
            "filename": filename,
            "text": text,
            "originalBytes": len(data),
            "convertedBytes": len(text_bytes),
            "bytesSaved": len(data) - len(text_bytes),
            "reductionPercent": round((1 - len(text_bytes) / len(data)) * 100, 2) if data else 0,
            "measurementScope": "Source PDF bytes compared with UTF-8 plain-text export bytes; this is a format conversion, not PDF compression.",
            "imageMetrics": {
                "imagesDetected": image_count,
                "imagesPreserved": 0,
                "imagesOptimized": 0,
                "imagesUnchanged": 0,
                "imagesDeferred": 0,
                "imagesOmitted": image_count,
                "optimizationFailures": 0,
            },
            "scriptMetrics": {"scriptsDetected": 0, "scriptsRemoved": 0, "trackersDetected": 0, "trackersRemoved": 0},
            "warnings": warnings,
            "processingDetails": [
                f"Extracted selectable text from pages {start_idx + 1} to {end_idx} of {total_pages}.",
                "Image-object counts include referenced PDF raster images; vector art is not counted.",
            ],
            "pages": total_pages,
            "extractedPagesCount": len(extracted_pages),
            "isScanned": is_scanned,
        }
    finally:
        document.close()


def compress_pdf(data: bytes, quality: int) -> bytes:
    document = open_pdf(data)
    try:
        document.rewrite_images(quality=quality, lossy=True, lossless=True, bitonal=True, color=True, gray=True)
        output = io.BytesIO()
        document.save(output, garbage=4, deflate=True, deflate_images=True, deflate_fonts=True, use_objstms=1)
        return output.getvalue()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(422, "This PDF could not be compressed. The original file is unchanged.") from exc
    finally:
        document.close()


def render_pdf_images(data: bytes, filename: str) -> tuple[bytes, int]:
    document = open_pdf(data)
    try:
        if document.page_count > 30:
            raise HTTPException(413, "PDF-to-image export supports up to 30 pages per file.")
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for index, page in enumerate(document, start=1):
                pixmap = page.get_pixmap(dpi=120, alpha=False)
                archive.writestr(f"page-{index:03}.png", pixmap.tobytes("png"))
                if output.tell() > 50 * 1024 * 1024:
                    raise HTTPException(413, "Rendered images exceed the 50 MB download limit.")
        return output.getvalue(), document.page_count
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(422, "The PDF pages could not be rendered as images.") from exc
    finally:
        document.close()


def get_pdf_info(data: bytes, filename: str) -> dict:
    """Returns page count, metadata, and thumbnail previews for the first N pages."""
    document = open_pdf(data)
    try:
        page_count = document.page_count
        metadata = document.metadata or {}
        thumbnails: list[dict[str, Any]] = []

        # Generate small thumbnail images for the first 30 pages
        for pno in range(min(30, page_count)):
            page = document[pno]
            rect = page.rect
            pix = page.get_pixmap(dpi=50, alpha=False)
            b64_img = base64.b64encode(pix.tobytes("png")).decode("ascii")
            thumbnails.append({
                "page": pno + 1,
                "width": int(rect.width),
                "height": int(rect.height),
                "thumbnail": f"data:image/png;base64,{b64_img}",
            })

        return {
            "filename": filename,
            "title": metadata.get("title", "") or Path(filename).stem,
            "author": metadata.get("author", ""),
            "pageCount": page_count,
            "fileSize": len(data),
            "thumbnails": thumbnails,
        }
    finally:
        document.close()


def edit_pdf_pages(data: bytes, page_order_str: str, delete_pages_str: Optional[str] = None) -> bytes:
    """
    Reorders, deletes, and extracts pages based on user specifications.
    page_order_str: e.g. "1,2,3" or "1-5" or JSON list of 1-based page numbers.
    delete_pages_str: e.g. "2,4".
    """
    document = open_pdf(data)
    try:
        total = document.page_count
        # Parse page order
        order: list[int] = []
        if page_order_str:
            for part in re.split(r"[\s,]+", page_order_str.strip()):
                if not part:
                    continue
                if "-" in part:
                    s, e = part.split("-", 1)
                    order.extend(range(int(s), int(e) + 1))
                else:
                    order.append(int(part))
        else:
            order = list(range(1, total + 1))

        # Parse delete pages
        to_delete = set()
        if delete_pages_str:
            for part in re.split(r"[\s,]+", delete_pages_str.strip()):
                if part and part.isdigit():
                    to_delete.add(int(part))

        final_pages = [p for p in order if p not in to_delete and 1 <= p <= total]
        if not final_pages:
            raise HTTPException(422, "No valid pages remain after applying specified page edits.")

        # Convert to 0-based indices for PyMuPDF
        zero_indices = [p - 1 for p in final_pages]
        document.select(zero_indices)

        out = io.BytesIO()
        document.save(out, garbage=3, deflate=True)
        return out.getvalue()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(422, f"Failed to edit PDF pages: {str(exc)[:100]}") from exc
    finally:
        document.close()


def pdf_to_markdown_content(data: bytes, filename: str) -> str:
    """Converts PDF document into structured Markdown."""
    document = open_pdf(data)
    try:
        title = (document.metadata or {}).get("title", "") or Path(filename).stem
        md_lines = [f"# {title}\n", f"*Source: {filename}*\n"]

        for idx, page in enumerate(document, start=1):
            text = page.get_text("text", sort=True).strip()
            md_lines.append(f"\n## Page {idx}\n")
            if text:
                md_lines.append(text + "\n")
            else:
                md_lines.append("*(No text content on this page)*\n")

        return "\n".join(md_lines)
    finally:
        document.close()


def pdf_to_docx_bytes(data: bytes, filename: str) -> bytes:
    """Converts PDF pages into a formatted Word (.docx) document."""
    if docx is None:
        raise HTTPException(501, "DOCX conversion library (python-docx) is not installed.")

    document = open_pdf(data)
    try:
        doc = docx.Document()
        title = (document.metadata or {}).get("title", "") or Path(filename).stem
        doc.add_heading(title, level=0)

        for idx, page in enumerate(document, start=1):
            text = page.get_text("text", sort=True).strip()
            if idx > 1:
                doc.add_page_break()
            doc.add_heading(f"Page {idx}", level=2)
            if text:
                for para in text.split("\n\n"):
                    if para.strip():
                        doc.add_paragraph(para.strip())

        out = io.BytesIO()
        doc.save(out)
        return out.getvalue()
    finally:
        document.close()


@app.post("/api/pdf/info")
async def pdf_info(file: UploadFile = File(...)):
    data, filename = await read_pdf_upload(file)
    return await run_in_threadpool(get_pdf_info, data, filename)


@app.post("/api/pdf/extract")
async def pdf_extract(
    file: UploadFile = File(...),
    start_page: int = Form(1, ge=1),
    end_page: Optional[int] = Form(None),
):
    data, filename = await read_pdf_upload(file)
    return await run_in_threadpool(extract_pdf_text, data, filename, start_page, end_page)


@app.post("/api/pdf/compress")
async def pdf_compress(file: UploadFile = File(...), quality: int = Form(75, ge=1, le=100)):
    data, filename = await read_pdf_upload(file)
    result = await run_in_threadpool(compress_pdf, data, quality)
    saved = len(data) - len(result)
    reduction = round(saved / len(data) * 100, 2) if data else 0
    output_name = re.sub(r"[^A-Za-z0-9._-]+", "-", Path(filename).stem).strip(".-") or "document"
    return Response(
        content=result,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{output_name}-compressed.pdf"',
            "X-Original-Bytes": str(len(data)),
            "X-Converted-Bytes": str(len(result)),
            "X-Bytes-Saved": str(saved),
            "X-Reduction-Percent": str(reduction),
        },
    )


@app.post("/api/pdf/images")
async def pdf_images(file: UploadFile = File(...)):
    data, filename = await read_pdf_upload(file)
    archive, pages = await run_in_threadpool(render_pdf_images, data, filename)
    return Response(
        content=archive,
        media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="pdf-pages.zip"',
            "X-Original-Bytes": str(len(data)),
            "X-Converted-Bytes": str(len(archive)),
            "X-Page-Count": str(pages),
        },
    )


@app.post("/api/pdf/edit")
async def pdf_edit(
    file: UploadFile = File(...),
    page_order: str = Form("", description="Comma-separated page order or ranges e.g. 1,3,2 or 1-4"),
    delete_pages: Optional[str] = Form(None, description="Comma-separated page numbers to delete"),
):
    data, filename = await read_pdf_upload(file)
    edited_pdf = await run_in_threadpool(edit_pdf_pages, data, page_order, delete_pages)
    output_name = re.sub(r"[^A-Za-z0-9._-]+", "-", Path(filename).stem).strip(".-") or "document"
    return Response(
        content=edited_pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{output_name}-edited.pdf"',
            "X-Original-Bytes": str(len(data)),
            "X-Converted-Bytes": str(len(edited_pdf)),
        },
    )


@app.post("/api/pdf/to-markdown")
async def pdf_to_markdown(file: UploadFile = File(...)):
    data, filename = await read_pdf_upload(file)
    md_content = await run_in_threadpool(pdf_to_markdown_content, data, filename)
    output_name = re.sub(r"[^A-Za-z0-9._-]+", "-", Path(filename).stem).strip(".-") or "document"
    return Response(
        content=md_content.encode("utf-8"),
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{output_name}.md"'},
    )


@app.post("/api/pdf/to-docx")
async def pdf_to_docx(file: UploadFile = File(...)):
    data, filename = await read_pdf_upload(file)
    docx_bytes = await run_in_threadpool(pdf_to_docx_bytes, data, filename)
    output_name = re.sub(r"[^A-Za-z0-9._-]+", "-", Path(filename).stem).strip(".-") or "document"
    return Response(
        content=docx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{output_name}.docx"'},
    )


# ── Inline HTML Image Optimization ───────────────────────────────────────────

@app.post("/api/html/optimize")
async def optimize_html_images(
    file: UploadFile = File(...),
    mode: str = Form("light"),
    quality: int = Form(75, ge=1, le=95),
):
    filename = Path(file.filename or "document.html").name
    content_type = (file.content_type or "").split(";", 1)[0].lower()
    if not filename.lower().endswith((".html", ".htm")) or content_type not in ("text/html", "application/octet-stream", ""):
        raise HTTPException(415, "Choose an HTML or HTM file for inline image optimization.")
    data = await file.read(MAX_HTML_BYTES + 1)
    if len(data) > MAX_HTML_BYTES:
        raise HTTPException(413, "HTML files must be 10 MB or smaller.")
    try:
        result = await run_in_threadpool(optimize_embedded_images, data, mode, quality)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(422, "The HTML document could not be processed; the original remains unchanged.") from exc
    return result


def optimize_embedded_images(data: bytes, mode: str, quality: int) -> dict:
    if mode not in {"light", "ultra", "terminal"}:
        raise HTTPException(422, "Mode must be light, ultra, or terminal.")
    soup = BeautifulSoup(data, "html.parser")
    source_scripts = len(soup.find_all("script"))
    images = soup.find_all("img")
    optimized = 0
    unchanged = 0
    failures = 0
    warnings: list[str] = []
    failure_reasons: set[str] = set()

    if mode == "light":
        for node in images:
            source = str(node.get("src", ""))
            match = re.fullmatch(r"data:image/(png|jpe?g|webp);base64,(.*)", source, flags=re.I | re.S)
            if not match:
                unchanged += 1
                if source.lower().startswith("data:image/"):
                    failure_reasons.add("Some embedded image formats are unsupported and were preserved.")
                continue
            if any(hint in source.lower() for hint in TRACKER_HINTS):
                unchanged += 1
                continue
            try:
                encoded = re.sub(r"\s+", "", match.group(2))
                raw = base64.b64decode(encoded, validate=True)
                if len(raw) > MAX_INLINE_IMAGE_BYTES:
                    raise ValueError("image exceeds the 5 MB inline-image limit")
                with Image.open(io.BytesIO(raw)) as image:
                    if image.width * image.height > MAX_INLINE_IMAGE_PIXELS:
                        raise ValueError("image exceeds the 40 megapixel safety limit")
                    image.load()
                    if getattr(image, "n_frames", 1) != 1:
                        unchanged += 1
                        failure_reasons.add("Animated images were preserved unchanged.")
                        continue
                    image_format = image.format
                    output = io.BytesIO()
                    save_options: dict = {}
                    if image_format == "JPEG":
                        save_options = {"quality": quality, "optimize": True, "progressive": True}
                        for metadata in ("exif", "icc_profile"):
                            if image.info.get(metadata):
                                save_options[metadata] = image.info[metadata]
                        if image.mode not in ("RGB", "L", "CMYK"):
                            image = image.convert("RGB")
                    elif image_format == "PNG":
                        save_options = {"optimize": True}
                    elif image_format == "WEBP":
                        save_options = {"quality": quality, "method": 6}
                    else:
                        unchanged += 1
                        failure_reasons.add(f"{image_format or 'Unknown'} images are not supported and were preserved.")
                        continue
                    image.save(output, format=image_format, **save_options)
                    converted = output.getvalue()
                if len(converted) < len(raw):
                    mime = "image/jpeg" if image_format == "JPEG" else f"image/{image_format.lower()}"
                    node["src"] = f"data:{mime};base64,{base64.b64encode(converted).decode('ascii')}"
                    optimized += 1
                else:
                    unchanged += 1
            except (binascii.Error, UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
                unchanged += 1
                failures += 1
                failure_reasons.add(f"Some embedded images were preserved because optimization failed: {str(exc)[:120]}.")
    else:
        unchanged = len(images)
        warnings.append(f"Inline image optimization was skipped in {mode.title()} mode; images are handled by that delivery mode.")

    if failure_reasons:
        warnings.extend(sorted(failure_reasons)[:10])

    html = str(soup)
    output_bytes = len(html.encode("utf-8"))
    return {
        "html": html,
        "originalBytes": len(data),
        "convertedBytes": output_bytes,
        "bytesSaved": len(data) - output_bytes,
        "percentageSaved": round((1 - output_bytes / len(data)) * 100, 2) if data else 0,
        "mode": mode,
        "imageMetrics": {
            "imagesDetected": len(images),
            "imagesPreserved": len(images),
            "imagesOptimized": optimized,
            "imagesUnchanged": unchanged,
            "imagesDeferred": 0,
            "imagesOmitted": 0,
            "optimizationFailures": failures,
        },
        "scriptMetrics": {
            "scriptsDetected": source_scripts,
            "scriptsRemoved": 0,
            "trackersDetected": detect_trackers(data),
            "trackersRemoved": 0,
        },
        "warnings": warnings,
        "processingDetails": [
            f"Optimized embedded static PNG, JPEG, and WebP data images; quality is {quality}.",
            "Remote and relative image URLs were not fetched or modified.",
        ],
        "measurementScope": "Uploaded HTML bytes compared with optimized HTML bytes; excludes linked image resources and other network traffic.",
    }
