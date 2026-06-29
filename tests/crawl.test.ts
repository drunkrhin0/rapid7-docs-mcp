import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import * as fs from 'fs';

vi.mock('axios');
vi.mock('fs');

// ─── isValidProductUrl ────────────────────────────────────────────────────

import { isValidProductUrl } from '../crawl.ts';

describe('isValidProductUrl', () => {
  it('accepts docs.rapid7.com URLs', () => {
    expect(isValidProductUrl('https://docs.rapid7.com/insightidr/')).toBe(true);
  });

  it('accepts documentation.rapid7.com URLs', () => {
    expect(isValidProductUrl('https://documentation.rapid7.com/incident-command/')).toBe(true);
  });

  it('accepts help.rapid7.com URLs', () => {
    expect(isValidProductUrl('https://help.rapid7.com/insightvm/en-us/api/')).toBe(true);
  });

  it('rejects http (non-https) URLs', () => {
    expect(isValidProductUrl('http://docs.rapid7.com/insightidr/')).toBe(false);
  });

  it('rejects unknown domains', () => {
    expect(isValidProductUrl('https://example.com/foo')).toBe(false);
  });

  it('rejects hash-only hrefs', () => {
    expect(isValidProductUrl('#')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidProductUrl('')).toBe(false);
  });

  it('rejects relative paths', () => {
    expect(isValidProductUrl('/insightidr/')).toBe(false);
  });
});

// ─── fetchSitemapUrls ─────────────────────────────────────────────────────

describe('fetchSitemapUrls', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns htm content URLs from sitemap', async () => {
    const { fetchSitemapUrls } = await import('../crawl.ts');
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://documentation.rapid7.com/incident-command/Default.htm</loc></url>
  <url><loc>https://documentation.rapid7.com/incident-command/overview.htm</loc></url>
  <url><loc>https://documentation.rapid7.com/incident-command/quick-start.htm</loc></url>
  <url><loc>https://documentation.rapid7.com/incident-command/Search.htm</loc></url>
  <url><loc>https://documentation.rapid7.com/incident-command/Resources/Images/logo.png</loc></url>
  <url><loc>https://documentation.rapid7.com/incident-command/Resources/Stylesheets/main.css</loc></url>
</urlset>`,
    });

    const result = await fetchSitemapUrls('https://documentation.rapid7.com/incident-command/');
    expect(result).toEqual([
      'https://documentation.rapid7.com/incident-command/overview.htm',
      'https://documentation.rapid7.com/incident-command/quick-start.htm',
    ]);
  });

  it('returns empty array when sitemap fetch fails', async () => {
    const { fetchSitemapUrls } = await import('../crawl.ts');
    vi.mocked(axios.get).mockRejectedValueOnce(new Error('Network error'));

    const result = await fetchSitemapUrls('https://documentation.rapid7.com/incident-command/');
    expect(result).toEqual([]);
  });

  it('returns empty array for empty sitemap', async () => {
    const { fetchSitemapUrls } = await import('../crawl.ts');
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`,
    });

    const result = await fetchSitemapUrls('https://documentation.rapid7.com/incident-command/');
    expect(result).toEqual([]);
  });
});

// ─── discoverProducts ─────────────────────────────────────────────────────

describe('discoverProducts', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('extracts product URLs from homepage tile grid', async () => {
    const { discoverProducts } = await import('../crawl.ts');
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: `<html><body>
        <div class="home-tile-container">
          <div class="home-tiles">
            <div><a href="https://documentation.rapid7.com/incident-command/"><img class="home-tile-icon"/></a></div>
            <div><a href="https://docs.rapid7.com/insightidr/"><img class="home-tile-icon"/></a></div>
            <div><a href="https://docs.rapid7.com/insightidr/"><img class="home-tile-icon"/></a></div>
          </div>
        </div>
      </body></html>`,
    });
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);

    const products = await discoverProducts();
    expect(products).toHaveLength(2); // deduplicates the insightidr entry
    expect(products[0].url).toBe('https://documentation.rapid7.com/incident-command/');
    expect(products[1].url).toBe('https://docs.rapid7.com/insightidr/');
  });

  it('falls back to PRODUCT_SECTIONS when homepage fetch fails', async () => {
    const { discoverProducts } = await import('../crawl.ts');
    vi.mocked(axios.get).mockRejectedValueOnce(new Error('timeout'));
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);

    const products = await discoverProducts();
    expect(products.length).toBeGreaterThan(0);
    expect(products.some((p) => p.url.includes('insightidr'))).toBe(true);
  });

  it('falls back when homepage returns zero valid product tiles', async () => {
    const { discoverProducts } = await import('../crawl.ts');
    vi.mocked(axios.get).mockResolvedValueOnce({ data: '<html><body><p>empty</p></body></html>' });
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);

    const products = await discoverProducts();
    expect(products.length).toBeGreaterThan(0); // fell back to hardcoded list
  });
});

// ─── crawlByUrl domain routing ────────────────────────────────────────────

describe('crawlByUrl', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('routes documentation.rapid7.com to sitemap-seeded crawl', async () => {
    const { crawlByUrl } = await import('../crawl.ts');
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readdirSync).mockReturnValue([]);

    await crawlByUrl('https://documentation.rapid7.com/incident-command/');

    // Should have fetched the sitemap (via fetchSitemapUrls)
    const sitemapCalls = vi
      .mocked(axios.get)
      .mock.calls.filter((call) => typeof call[0] === 'string' && call[0].includes('Sitemap.xml'));
    expect(sitemapCalls.length).toBeGreaterThan(0);
  });

  it('routes docs.rapid7.com directly without sitemap', async () => {
    const { crawlByUrl } = await import('../crawl.ts');
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readdirSync).mockReturnValue([]);

    await crawlByUrl('https://docs.rapid7.com/insightidr/');

    // Should NOT have fetched any sitemap
    const sitemapCalls = vi
      .mocked(axios.get)
      .mock.calls.filter((call) => typeof call[0] === 'string' && call[0].includes('Sitemap.xml'));
    expect(sitemapCalls.length).toBe(0);
  });

  it('routes help.rapid7.com directly without sitemap', async () => {
    const { crawlByUrl } = await import('../crawl.ts');
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readdirSync).mockReturnValue([]);

    await crawlByUrl('https://help.rapid7.com/insightvm/en-us/api/');

    // Should NOT have fetched any sitemap
    const sitemapCalls = vi
      .mocked(axios.get)
      .mock.calls.filter((call) => typeof call[0] === 'string' && call[0].includes('Sitemap.xml'));
    expect(sitemapCalls.length).toBe(0);
  });

  it('handles invalid URL gracefully', async () => {
    const { crawlByUrl } = await import('../crawl.ts');

    // Should not throw
    await expect(crawlByUrl('not-a-valid-url')).resolves.toBeUndefined();
  });
});

// ─── SSRF guard ───────────────────────────────────────────────────────────

describe('isValidProductUrl — SSRF prevention', () => {
  it('rejects internal IP addresses', () => {
    expect(isValidProductUrl('https://127.0.0.1/')).toBe(false);
    expect(isValidProductUrl('https://10.0.0.1/')).toBe(false);
    expect(isValidProductUrl('https://192.168.1.1/')).toBe(false);
    expect(isValidProductUrl('https://[::1]/')).toBe(false);
  });

  it('rejects cloud metadata endpoints', () => {
    expect(isValidProductUrl('https://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(isValidProductUrl('http://169.254.169.254/')).toBe(false); // also http
  });

  it('rejects arbitrary external domains', () => {
    expect(isValidProductUrl('https://evil.com/')).toBe(false);
    expect(isValidProductUrl('https://rapid7.com.evil.com/')).toBe(false);
    expect(isValidProductUrl('https://rapid7.com@evil.com/')).toBe(false);
  });
});
