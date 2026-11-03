import unittest
import asyncio
import base64
import io
from contextlib import asynccontextmanager
from unittest.mock import patch
from PIL import Image

import httpx
import pymupdf
from fastapi import HTTPException
from fastapi.testclient import TestClient

import main


class FakeResponse:
    def __init__(self, status=200, headers=None, body=b""):
        self.status_code = status
        self.headers = headers or {"content-type": "text/html; charset=utf-8"}
        self.encoding = "utf-8"
        self.body = body

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def aiter_bytes(self):
        yield self.body


class FakeClient:
    def __init__(self, response=None, error=None):
        self.response = response
        self.error = error
        self.calls = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    def stream(self, *_args, **_kwargs):
        self.calls += 1

        @asynccontextmanager
        async def result():
            if self.error:
                raise self.error
            yield self.response
        return result()


class ConversionEndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)

    @staticmethod
    def sample_pdf(with_text=True, num_pages=1):
        doc = pymupdf.open()
        for i in range(num_pages):
            page = doc.new_page()
            if with_text:
                page.insert_text((72, 72), f"ByteLess PDF extraction sample page {i + 1}")
        result = doc.tobytes()
        doc.close()
        return result

    @staticmethod
    def sample_image_pdf():
        pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 128, 128), 0)
        for y in range(128):
            for x in range(128):
                pixmap.set_pixel(x, y, (x * 2 % 256, y * 2 % 256, (x * y) % 256))
        doc = pymupdf.open()
        page = doc.new_page()
        page.insert_image(pymupdf.Rect(50, 50, 500, 500), stream=pixmap.tobytes("png"))
        result = doc.tobytes()
        doc.close()
        return result

    def test_pdf_extract_returns_text_and_real_size_metrics(self):
        payload = self.sample_pdf()
        response = self.client.post("/api/pdf/extract", files={"file": ("article.pdf", payload, "application/pdf")})
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertIn("ByteLess PDF extraction sample", result["text"])
        self.assertEqual(result["originalBytes"], len(payload))
        self.assertEqual(result["convertedBytes"], len(result["text"].encode("utf-8")))

    def test_pdf_compression_returns_valid_pdf_and_actual_size_headers(self):
        payload = self.sample_pdf()
        response = self.client.post("/api/pdf/compress", files={"file": ("article.pdf", payload, "application/pdf")}, data={"quality": "70"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.content.startswith(b"%PDF-"))
        self.assertEqual(int(response.headers["X-Original-Bytes"]), len(payload))
        self.assertEqual(int(response.headers["X-Converted-Bytes"]), len(response.content))
        self.assertEqual(int(response.headers["X-Bytes-Saved"]), len(payload) - len(response.content))

    def test_pdf_compression_validates_quality(self):
        response = self.client.post("/api/pdf/compress", files={"file": ("article.pdf", self.sample_pdf(), "application/pdf")}, data={"quality": "101"})
        self.assertEqual(response.status_code, 422)

    def test_pdf_compression_rewrites_embedded_images_at_selected_quality(self):
        payload = self.sample_image_pdf()
        response = self.client.post("/api/pdf/compress", files={"file": ("image.pdf", payload, "application/pdf")}, data={"quality": "35"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.content.startswith(b"%PDF-"))
        self.assertNotEqual(response.content, payload)
        self.assertEqual(int(response.headers["X-Converted-Bytes"]), len(response.content))

    def test_pdf_images_are_downloadable_zip_with_page_png(self):
        response = self.client.post("/api/pdf/images", files={"file": ("article.pdf", self.sample_pdf(), "application/pdf")})
        self.assertEqual(response.status_code, 200, response.text)
        import zipfile
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            self.assertEqual(archive.namelist(), ["page-001.png"])
            self.assertTrue(archive.read("page-001.png").startswith(b"\x89PNG"))

    def test_pdf_endpoints_reject_malformed_and_non_pdf_uploads(self):
        malformed = self.client.post("/api/pdf/extract", files={"file": ("fake.pdf", b"%PDF-not a valid document", "application/pdf")})
        wrong_type = self.client.post("/api/pdf/extract", files={"file": ("page.html", b"<html>", "text/html")})
        self.assertEqual(malformed.status_code, 422)
        self.assertEqual(wrong_type.status_code, 415)

    def test_pdf_extract_explains_image_only_document_limit(self):
        response = self.client.post("/api/pdf/extract", files={"file": ("scan.pdf", self.sample_pdf(with_text=False), "application/pdf")})
        self.assertEqual(response.status_code, 422)
        self.assertIn("OCR is", response.json()["detail"])

    @staticmethod
    def embedded_png_html():
        image = Image.new("RGB", (420, 320))
        pixels = image.load()
        for y in range(image.height):
            for x in range(image.width):
                pixels[x, y] = (x % 256, y % 256, (x + y) % 256)
        output = io.BytesIO()
        image.save(output, format="PNG")
        data_uri = "data:image/png;base64," + base64.b64encode(output.getvalue()).decode()
        return (f'<html><body><figure><img src="{data_uri}" alt="A noisy landscape" '
                'title="Landscape" width="420" height="320"><figcaption>Summer scene</figcaption>'
                '</figure></body></html>').encode(), output.getvalue()

    def test_uploaded_html_optimizes_supported_inline_image_and_preserves_context(self):
        payload, original_image = self.embedded_png_html()
        response = self.client.post("/api/html/optimize", files={"file": ("article.html", payload, "text/html")}, data={"mode": "light", "quality": "72"})
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result["imageMetrics"]["imagesOptimized"], 1)
        self.assertEqual(result["originalBytes"], len(payload))
        self.assertEqual(result["convertedBytes"], len(result["html"].encode()))
        soup = main.BeautifulSoup(result["html"], "html.parser")
        image = soup.find("img")
        self.assertEqual(image["alt"], "A noisy landscape")
        self.assertEqual(image["title"], "Landscape")
        self.assertEqual((image["width"], image["height"]), ("420", "320"))
        self.assertEqual(soup.find("figcaption").get_text(), "Summer scene")
        optimized_data = base64.b64decode(image["src"].split(",", 1)[1])
        with Image.open(io.BytesIO(optimized_data)) as optimized:
            self.assertEqual(optimized.size, (420, 320))
        self.assertLess(len(optimized_data), len(original_image))
        self.assertEqual(result["bytesSaved"], result["originalBytes"] - result["convertedBytes"])

    def test_html_optimizer_preserves_remote_unsupported_and_non_light_images(self):
        payload = b'<html><body><img src="https://cdn.example.org/photo.png" alt="Remote"><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" alt="Animated"></body></html>'
        response = self.client.post("/api/html/optimize", files={"file": ("article.html", payload, "text/html")}, data={"mode": "light", "quality": "70"})
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertIn('https://cdn.example.org/photo.png', result["html"])
        self.assertEqual(result["imageMetrics"]["imagesOptimized"], 0)
        self.assertIn("preserved", " ".join(result["warnings"]).lower())
        ultra = self.client.post("/api/html/optimize", files={"file": ("article.html", payload, "text/html")}, data={"mode": "ultra", "quality": "70"})
        self.assertEqual(ultra.status_code, 200, ultra.text)
        self.assertEqual(ultra.json()["imageMetrics"]["imagesOptimized"], 0)
        self.assertEqual(ultra.json()["imageMetrics"]["imagesUnchanged"], 2)

    def test_html_optimizer_rejects_invalid_file_and_quality(self):
        wrong_file = self.client.post("/api/html/optimize", files={"file": ("article.txt", b"hello", "text/plain")})
        bad_quality = self.client.post("/api/html/optimize", files={"file": ("article.html", b"<p>text</p>", "text/html")}, data={"quality": "99"})
        self.assertEqual(wrong_file.status_code, 415)
        self.assertEqual(bad_quality.status_code, 422)

    def test_valid_article_is_sanitized_and_measured(self):
        body = b"<!doctype html><html><head><title>Example Article</title></head><body><article><h1>Public article</h1><p>Readable text.</p><script>alert(1)</script></article></body></html>"
        with patch.object(main, "fetch_page", return_value=(body, "https://example.com/story", "utf-8")):
            response = self.client.post("/api/convert", json={"url": "https://example.com/story", "mode": "light"})
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertIn("Readable text", result["html"])
        self.assertNotIn("<script", result["html"])
        self.assertEqual(result["originalBytes"], len(body))
        self.assertEqual(result["mode"], "light")

    def test_conversion_scorecard_separates_detected_from_output_removed_counts(self):
        body = b'<!doctype html><html><head><title>Metrics</title></head><body><article><h1>Metrics story</h1><p>' + (b'Readable article content. ' * 40) + b'</p><img src="https://track.example/pixel" alt="Tracking pixel"><script src="https://analytics.example/a.js"></script></article></body></html>'
        with patch.object(main, "fetch_page", return_value=(body, "https://example.com/story", "utf-8")):
            response = self.client.post("/api/convert", json={"url": "https://example.com/story", "mode": "light"})
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        metrics = result["metrics"]
        self.assertEqual(metrics["scriptsDetected"], 1)
        self.assertEqual(metrics["scriptsRemoved"], 1)
        self.assertGreaterEqual(metrics["trackersDetected"], 1)
        self.assertGreaterEqual(metrics["trackersRemoved"], 1)
        self.assertEqual(result["integrity"]["trackersBlocked"], 0)

    def test_invalid_and_private_urls_are_rejected(self):
        for url in ("file:///etc/passwd", "http://127.0.0.1/", "http://localhost/"):
            response = self.client.post("/api/convert", json={"url": url, "mode": "light"})
            self.assertEqual(response.status_code, 400, url)

    def test_inaccessible_site_error(self):
        with patch.object(main, "fetch_page", side_effect=HTTPException(502, "Could not connect to that website.")):
            response = self.client.post("/api/convert", json={"url": "https://example.com/", "mode": "light"})
        self.assertEqual(response.status_code, 502)

    def test_unsupported_content_type_error(self):
        with patch.object(main, "fetch_page", side_effect=HTTPException(415, "Unsupported content type: application/pdf.")):
            response = self.client.post("/api/convert", json={"url": "https://example.com/file.pdf", "mode": "light"})
        self.assertEqual(response.status_code, 415)

    def test_timeout_error(self):
        with patch.object(main, "fetch_page", side_effect=HTTPException(504, "The website took too long to respond.")):
            response = self.client.post("/api/convert", json={"url": "https://example.com/slow", "mode": "light"})
        self.assertEqual(response.status_code, 504)

    def test_fetcher_timeout_is_reported_as_gateway_timeout(self):
        client = FakeClient(error=httpx.ReadTimeout("timed out"))
        with patch.object(main.httpx, "AsyncClient", return_value=client):
            with self.assertRaises(HTTPException) as caught:
                asyncio.run(main.fetch_page("https://8.8.8.8/"))
        self.assertEqual(caught.exception.status_code, 504)

    def test_fetcher_rejects_non_html_response(self):
        client = FakeClient(response=FakeResponse(headers={"content-type": "application/pdf"}))
        with patch.object(main.httpx, "AsyncClient", return_value=client):
            with self.assertRaises(HTTPException) as caught:
                asyncio.run(main.fetch_page("https://8.8.8.8/file"))
        self.assertEqual(caught.exception.status_code, 415)

    def test_fetcher_validates_private_redirect_before_requesting_it(self):
        client = FakeClient(response=FakeResponse(status=302, headers={"location": "http://127.0.0.1/private"}))
        with patch.object(main.httpx, "AsyncClient", return_value=client):
            with self.assertRaises(HTTPException) as caught:
                asyncio.run(main.fetch_page("https://8.8.8.8/"))
        self.assertEqual(caught.exception.status_code, 400)
        self.assertEqual(client.calls, 1)

    # ── New Feature Tests ─────────────────────────────────────────────────────

    def test_pasted_text_conversion_endpoint(self):
        text = "Deep Sea Exploration\n\nThe deep ocean remains one of the most enigmatic ecosystems on Earth.\nScientists use remotely operated vehicles to sample geothermal vents."
        response = self.client.post("/api/text/convert", json={"text": text, "title": "Marine Essay", "mode": "light"})
        self.assertEqual(response.status_code, 200, response.text)
        res = response.json()
        self.assertEqual(res["title"], "Marine Essay")
        self.assertIn("<p>", res["html"])
        self.assertIn("enigmatic ecosystems", res["html"])
        self.assertGreater(res["originalBytes"], 0)
        self.assertIn("categorizedElements", res["integrity"])
        self.assertGreaterEqual(res["integrity"]["paragraphsPreserved"], 1)

    def test_pasted_text_conversion_validates_empty_input(self):
        response = self.client.post("/api/text/convert", json={"text": "   ", "mode": "light"})
        self.assertEqual(response.status_code, 422)

    def test_image_proxy_rejects_private_and_localhost_urls(self):
        for bad_url in ("http://localhost/img.png", "http://127.0.0.1/pic.jpg", "file:///test.png"):
            response = self.client.get(f"/api/image/proxy?url={bad_url}")
            self.assertEqual(response.status_code, 400)

    def test_summarize_endpoint_generates_bullets(self):
        text = (
            "Modern web development relies heavily on client-side frameworks and build tools. "
            "ByteLess provides a lightweight conversion pipeline to reduce data transmission. "
            "By removing tracking scripts and compressing images, users on slow connections can browse faster. "
            "Offline caching with IndexedDB ensures saved articles remain readable anytime."
        )
        response = self.client.post("/api/summarize", json={"text": text, "title": "Web Optimization"})
        self.assertEqual(response.status_code, 200, response.text)
        res = response.json()
        self.assertTrue(len(res["summary"]) >= 1)
        self.assertIn("provider", res)

    def test_summarize_rejects_too_short_text(self):
        response = self.client.post("/api/summarize", json={"text": "Too short"})
        self.assertEqual(response.status_code, 422)

    def test_translate_validates_language_pair(self):
        response = self.client.post("/api/translate", json={"html": "<p>Hello</p>", "source_lang": "en", "target_lang": "fr"})
        self.assertEqual(response.status_code, 422)

    def test_translate_preserves_html_tags(self):
        html = "<h1>Knowledge</h1><p>Reading content is essential.</p>"
        response = self.client.post("/api/translate", json={"html": html, "source_lang": "en", "target_lang": "hi"})
        self.assertEqual(response.status_code, 200, response.text)
        res = response.json()
        self.assertIn("<h1>", res["translatedHtml"])
        self.assertIn("<p>", res["translatedHtml"])

    def test_ml_recommend_endpoint(self):
        html = "<html><body><h1>Title</h1><p>Paragraph 1</p><p>Paragraph 2</p><img src='pic.jpg'></body></html>"
        response = self.client.post("/api/ml/recommend", json={"html": html})
        self.assertEqual(response.status_code, 200, response.text)
        res = response.json()
        self.assertIn("recommended_mode", res)
        self.assertIn("recommended_actions", res)
        self.assertIn("reasons", res)

    def test_pdf_info_endpoint(self):
        payload = self.sample_pdf(num_pages=2)
        response = self.client.post("/api/pdf/info", files={"file": ("sample.pdf", payload, "application/pdf")})
        self.assertEqual(response.status_code, 200, response.text)
        res = response.json()
        self.assertEqual(res["pageCount"], 2)
        self.assertEqual(len(res["thumbnails"]), 2)
        self.assertTrue(res["thumbnails"][0]["thumbnail"].startswith("data:image/png;base64,"))

    def test_pdf_edit_reorders_and_deletes_pages(self):
        payload = self.sample_pdf(num_pages=3)
        # Keep pages 3 and 1, delete page 2
        response = self.client.post(
            "/api/pdf/edit",
            files={"file": ("doc.pdf", payload, "application/pdf")},
            data={"page_order": "3,1", "delete_pages": "2"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.content.startswith(b"%PDF-"))
        edited_doc = pymupdf.open(stream=response.content, filetype="pdf")
        self.assertEqual(edited_doc.page_count, 2)
        self.assertIn("page 3", edited_doc[0].get_text())
        self.assertIn("page 1", edited_doc[1].get_text())
        edited_doc.close()

    def test_pdf_to_markdown_endpoint(self):
        payload = self.sample_pdf(num_pages=2)
        response = self.client.post("/api/pdf/to-markdown", files={"file": ("doc.pdf", payload, "application/pdf")})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn("## Page 1", response.text)
        self.assertIn("## Page 2", response.text)

    def test_pdf_to_docx_endpoint(self):
        payload = self.sample_pdf(num_pages=1)
        response = self.client.post("/api/pdf/to-docx", files={"file": ("doc.pdf", payload, "application/pdf")})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(len(response.content) > 100)


if __name__ == "__main__":
    unittest.main()
