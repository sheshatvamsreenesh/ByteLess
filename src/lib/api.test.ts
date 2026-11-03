import assert from 'node:assert/strict';
import test from 'node:test';
import { proxyDeferredImageUrl } from './api';

test('proxyDeferredImageUrl constructs URL with encoded target and quality', () => {
  const target = 'https://example.com/images/hero photo.png?size=large&v=1';
  const proxied = proxyDeferredImageUrl(target, 80);
  assert.ok(proxied.includes('/api/image/proxy?url='));
  assert.ok(proxied.includes('quality=80'));
  assert.ok(proxied.includes(encodeURIComponent(target)));
});

test('proxyDeferredImageUrl uses default quality 75 if not specified', () => {
  const target = 'https://example.com/pic.jpg';
  const proxied = proxyDeferredImageUrl(target);
  assert.ok(proxied.includes('quality=75'));
});

