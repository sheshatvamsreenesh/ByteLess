from __future__ import annotations

import asyncio
import base64
import binascii
import io
import ipaddress
import os
import re
import socket
import ssl
import zipfile
from pathlib import Path
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpcore
import httpx
from bs4 import BeautifulSoup, Comment
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field
from readability import Document
import pymupdf
from PIL import Image, UnidentifiedImageError
from starlette.concurrency import run_in_threadpool

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
    "br", "hr", "figure", "figcaption",
}
DROP_TAGS = {"script", "style", "noscript", "iframe", "form", "button", "nav", "footer", "header", "aside", "svg", "canvas", "object", "embed", "link", "meta"}
TRACKER_HINTS = ("analytics", "track", "pixel", "beacon", "doubleclick", "googletagmanager", "facebook.net")

app = FastAPI(title="ByteLess conversion service", version="1.0.0")
origins = [x.strip() for x in os.getenv("BYTELESS_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",") if x.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["POST", "OPTIONS"], allow_headers=["Content-Type"], expose_headers=["X-Original-Bytes", "X-Converted-Bytes", "X-Bytes-Saved", "X-Reduction-Percent", "X-Page-Count", "Content-Disposition"])


class ConvertRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2048)
    mode: str = "light"


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


def extract_pdf_text(data: bytes, filename: str) -> dict:
    document = open_pdf(data)
    try:
        text = "\n\n".join(page.get_text("text", sort=True).strip() for page in document).strip()
        if not text:
            raise HTTPException(422, "No selectable text was found. This may be a scanned PDF; OCR is not available.")
        text_bytes = text.encode("utf-8")
        title = (document.metadata or {}).get("title", "").strip() or Path(filename).stem
        image_xrefs = {image[0] for page in document for image in page.get_images(full=True) if image and image[0]}
        image_count = len(image_xrefs)
        warnings = ["Embedded PDF images are not included in the plain-text export."] if image_count else []
        return {"title": title, "filename": filename, "text": text,
                "originalBytes": len(data), "convertedBytes": len(text_bytes),
                "bytesSaved": len(data) - len(text_bytes),
                "reductionPercent": round((1 - len(text_bytes) / len(data)) * 100, 2) if data else 0,
                "measurementScope": "Source PDF bytes compared with UTF-8 plain-text export bytes; this is a format conversion, not PDF compression.",
                "imageMetrics": {"imagesDetected": image_count, "imagesPreserved": 0, "imagesOptimized": 0, "imagesUnchanged": 0, "imagesDeferred": 0, "imagesOmitted": image_count, "optimizationFailures": 0},
                "scriptMetrics": {"scriptsDetected": 0, "scriptsRemoved": 0, "trackersDetected": 0, "trackersRemoved": 0},
                "warnings": warnings,
                "processingDetails": ["Selectable text extracted with PyMuPDF; no OCR was run.", "Image-object counts include referenced PDF raster images; vector art is not counted."],
                "pages": document.page_count}
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


@app.post("/api/pdf/extract")
async def pdf_extract(file: UploadFile = File(...)):
    data, filename = await read_pdf_upload(file)
    return await run_in_threadpool(extract_pdf_text, data, filename)


@app.post("/api/pdf/compress")
async def pdf_compress(file: UploadFile = File(...), quality: int = Form(75, ge=1, le=100)):
    data, filename = await read_pdf_upload(file)
    result = await run_in_threadpool(compress_pdf, data, quality)
    saved = len(data) - len(result)
    reduction = round(saved / len(data) * 100, 2) if data else 0
    output_name = re.sub(r"[^A-Za-z0-9._-]+", "-", Path(filename).stem).strip(".-") or "document"
    return Response(content=result, media_type="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="{output_name}-compressed.pdf"',
        "X-Original-Bytes": str(len(data)), "X-Converted-Bytes": str(len(result)),
        "X-Bytes-Saved": str(saved), "X-Reduction-Percent": str(reduction),
    })


@app.post("/api/pdf/images")
async def pdf_images(file: UploadFile = File(...)):
    data, filename = await read_pdf_upload(file)
    archive, pages = await run_in_threadpool(render_pdf_images, data, filename)
    return Response(content=archive, media_type="application/zip", headers={
        "Content-Disposition": 'attachment; filename="pdf-pages.zip"',
        "X-Original-Bytes": str(len(data)), "X-Converted-Bytes": str(len(archive)), "X-Page-Count": str(pages),
    })


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
        "imageMetrics": {"imagesDetected": len(images), "imagesPreserved": len(images),
                         "imagesOptimized": optimized, "imagesUnchanged": unchanged,
                         "imagesDeferred": 0, "imagesOmitted": 0,
                         "optimizationFailures": failures},
        "scriptMetrics": {"scriptsDetected": source_scripts, "scriptsRemoved": 0,
                          "trackersDetected": detect_trackers(data), "trackersRemoved": 0},
        "warnings": warnings,
        "processingDetails": [f"Optimized only embedded static PNG, JPEG, and WebP data images; JPEG/WebP quality is {quality}, image dimensions and elements are preserved.",
                              "Remote and relative image URLs were not fetched or modified.",
                              "PNG optimization is lossless; JPEG and WebP use the configured quality when a smaller result is produced."],
        "measurementScope": "Uploaded HTML bytes compared with optimized HTML bytes; excludes linked image resources and other network traffic.",
    }


async def validate_public_url(value: str) -> str:
    try:
        parts = urlsplit(value.strip())
        if parts.scheme.lower() not in ("http", "https") or not parts.hostname:
            raise ValueError("Only http and https URLs are supported.")
        if parts.username or parts.password:
            raise ValueError("URLs containing credentials are not supported.")
        host = parts.hostname.rstrip(".").encode("idna").decode("ascii")
        if host.lower() in {"localhost", "localhost.localdomain"} or host.lower().endswith((".localhost", ".local", ".internal", ".test")):
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
    """Resolve and validate immediately before connecting, then pin to that IP."""
    def __init__(self):
        self.backend = httpcore._backends.auto.AutoBackend()

    async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        addresses = await public_addresses(host, port)
        return await self.backend.connect_tcp(addresses[0], port, timeout=timeout,
                                              local_address=local_address, socket_options=socket_options)

    async def connect_unix_socket(self, path, timeout=None, socket_options=None):
        raise OSError("Unix domain sockets are disabled for webpage fetching.")

    async def sleep(self, seconds):
        await self.backend.sleep(seconds)


class PinnedAsyncHTTPTransport(httpx.AsyncHTTPTransport):
    def __init__(self):
        super().__init__(trust_env=False, limits=httpx.Limits(max_connections=4, max_keepalive_connections=0))
        # HTTPX does not expose its httpcore network backend argument; replace its
        # pool with the same HTTPX-supported core pool configured with DNS pinning.
        self._pool = httpcore.AsyncConnectionPool(
            ssl_context=ssl.create_default_context(), max_connections=4,
            max_keepalive_connections=0, retries=0,
            network_backend=ValidatingNetworkBackend(),
        )


async def fetch_page(value: str) -> tuple[bytes, str, str]:
    current = await validate_public_url(value)
    async with httpx.AsyncClient(transport=PinnedAsyncHTTPTransport(), timeout=TIMEOUT, follow_redirects=False, trust_env=False, headers={"User-Agent": "ByteLessReader/1.0 (+https://github.com/sheshatvamsreenesh/ByteLess)"}) as client:
        for _ in range(MAX_REDIRECTS + 1):
            # Validate every host resolution and every redirect before issuing a request.
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


def clean_content(fragment: str, base: str, mode: str) -> tuple[str, int, int, int]:
    soup = BeautifulSoup(fragment, "html.parser")
    removed = 0
    tracker_count = 0
    images_deferred = 0
    for comment in soup.find_all(string=lambda s: isinstance(s, Comment)):
        comment.extract()
    for node in list(soup.find_all(True)):
        if node.name in DROP_TAGS:
            haystack = str(node).lower()
            tracker_count += int(any(hint in haystack for hint in TRACKER_HINTS))
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
                continue
        for attr in list(node.attrs):
            if attr.lower().startswith("on") or attr.lower() in {"style", "srcset", "class", "id"} or (attr.lower() in {"width", "height"} and not re.fullmatch(r"\d{1,5}", str(node.get(attr, "")))):
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
            if mode in ("ultra", "terminal"):
                node.replace_with(soup.new_string(f"[Image: {alt or 'Image without alternative text'}]"))
                images_deferred += 1
            else:
                src = safe_link(image_candidate, base) if image_candidate else None
                if src:
                    preserved_attrs["src"] = src
                node.attrs = preserved_attrs
        else:
            node.attrs = {k: v for k, v in node.attrs.items() if k in {"colspan", "rowspan", "title"}}
    if mode == "terminal":
        return "<pre>" + BeautifulSoup(str(soup), "html.parser").get_text("\n", strip=True).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;") + "</pre>", removed, tracker_count, images_deferred
    return "".join(str(child) for child in soup.contents), removed, tracker_count, images_deferred


def detect_trackers(page: bytes) -> int:
    """Count only recognizable tracker-like resource references in fetched HTML."""
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
    warnings = []
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
    html, removed, _detected_in_article, images_deferred = clean_content(article, final_url, mode)
    if not BeautifulSoup(html, "html.parser").get_text(" ", strip=True):
        raise HTTPException(422, "No readable article content could be extracted from that page.")
    original_size = len(raw)
    converted_size = len(html.encode("utf-8"))
    output_soup = BeautifulSoup(html, "html.parser")
    images_preserved = len(output_soup.select("img[src]"))
    images_omitted = max(0, source_images - images_preserved - images_deferred)
    trackers_in_output = detect_trackers(html.encode("utf-8"))
    trackers_removed = max(0, tracker_candidates - trackers_in_output)
    if images_omitted:
        warnings.append(f"{images_omitted} source image(s) were not present in the extracted article content.")
    scripts_removed = max(0, source_scripts - len(output_soup.find_all("script")))
    metrics = {
        "imagesDetected": source_images, "imagesPreserved": images_preserved,
        "imagesOptimized": 0, "imagesUnchanged": images_preserved,
        "imagesDeferred": images_deferred, "imagesOmitted": images_omitted,
        "optimizationFailures": 0, "scriptsDetected": source_scripts,
        "scriptsRemoved": scripts_removed,
        "trackersDetected": tracker_candidates, "trackersRemoved": trackers_removed,
        "processingDetails": [f"Delivery mode: {mode}.", "Remote image resources were not fetched or modified.", "Script removal is verified by checking the converted document output."],
        "measurementScope": "Fetched HTML response bytes compared with converted article HTML bytes; excludes subresources and transport compression.",
    }
    return {
        "title": title, "source": final_url, "html": html, "mode": mode,
        "originalBytes": original_size, "convertedBytes": converted_size,
        "bytesSaved": original_size - converted_size,
        "reductionPercent": round((1 - converted_size / original_size) * 100, 2) if original_size else 0,
        "warnings": warnings,
        "integrity": {"elementsRemoved": removed, "trackersDetected": tracker_candidates,
                      "trackersBlocked": 0, "trackersRemoved": trackers_removed, "imagesDeferred": images_deferred,
                      "extractionFailures": extraction_failures, "potentiallyLostImportantContent": []},
        "metrics": metrics,
        "measurement": metrics["measurementScope"],
        "contentEncoding": encoding,
    }
