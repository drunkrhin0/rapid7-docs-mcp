#!/usr/bin/env tsx
/**
 * Rapid7 Website Scraper
 * Scrapes rapid7.com marketing pages: products, blog index, resources index.
 * Writes structured data to data/ directory for the MCP server to read.
 *
 * Usage:
 *   npx tsx crawl-site.ts                     # Crawl everything
 *   npx tsx crawl-site.ts --products          # Products only
 *   npx tsx crawl-site.ts --blog              # Blog index only
 *   npx tsx crawl-site.ts --resources         # Resources index only
 *   npx tsx crawl-site.ts --product command   # Single product
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { sleep } from './src/crawl-utils.js';

// ─── Config ──────────────────────────────────────────────────────────────────

const BASE_URL = 'https://www.rapid7.com';
const DATA_DIR = path.join(process.cwd(), 'data');
const PRODUCTS_DIR = path.join(DATA_DIR, 'products');
const DELAY_MS = parseInt(process.env.CRAWL_DELAY_MS || '100');
const USER_AGENT = 'Rapid7-Docs-MCP-Crawler/1.0 (personal homelab indexer)';

// ─── Product catalog ─────────────────────────────────────────────────────────

interface ProductDef {
  slug: string;
  name: string;
  pages: string[]; // URL paths relative to BASE_URL
}

const PRODUCTS: ProductDef[] = [
  {
    slug: 'command',
    name: 'Command Platform',
    pages: [
      '/products/command/',
      '/products/command/attack-surface-management-asm/',
      '/products/command/exposure-management/',
      '/products/command/pricing/',
    ],
  },
  {
    slug: 'insightappsec',
    name: 'InsightAppSec',
    pages: ['/products/insightappsec/', '/products/insightappsec/pricing/'],
  },
  {
    slug: 'insightcloudsec',
    name: 'InsightCloudSec',
    pages: ['/products/insightcloudsec/', '/products/insightcloudsec/pricing/'],
  },
  {
    slug: 'insightvm',
    name: 'InsightVM',
    pages: ['/products/insightvm/', '/products/insightvm/pricing/'],
  },
  {
    slug: 'metasploit',
    name: 'Metasploit',
    pages: ['/products/metasploit/'],
  },
  {
    slug: 'nexpose',
    name: 'Nexpose',
    pages: ['/products/nexpose/'],
  },
  {
    slug: 'siem',
    name: 'Incident Command (SIEM)',
    pages: ['/products/siem/', '/products/siem/packages/'],
  },
  {
    slug: 'threat-command',
    name: 'Threat Command',
    pages: ['/products/threat-command/'],
  },
  {
    slug: 'velociraptor',
    name: 'Velociraptor',
    pages: ['/products/velociraptor/'],
  },
];

// ─── Turndown setup ──────────────────────────────────────────────────────────

const td = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

// Remove images, scripts, styles — we want clean text
td.addRule('removeImages', {
  filter: ['img', 'picture', 'video', 'svg'] as TurndownService.Filter,
  replacement: () => '',
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fetchPage(urlPath: string): Promise<string | null> {
  try {
    const url = urlPath.startsWith('http') ? urlPath : `${BASE_URL}${urlPath}`;
    const resp = await axios.get<string>(url, {
      timeout: 30000,
      headers: { 'User-Agent': USER_AGENT },
      responseType: 'text',
    });
    return resp.data;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ Failed: ${urlPath} — ${msg}`);
    return null;
  }
}

interface FAQItem {
  question: string;
  answer: string;
}

function extractJsonLdFaqs(html: string): FAQItem[] {
  const faqs: FAQItem[] = [];

  // Next.js RSC embeds JSON-LD inside self.__next_s streaming scripts as escaped JSON strings.
  // Extract all FAQPage blocks from the raw HTML using regex.
  const faqRe = /\\"@type\\":\\"FAQPage\\".*?\\"mainEntity\\":\[(.*?)\]/g;
  let match;
  while ((match = faqRe.exec(html)) !== null) {
    try {
      // The match is JSON embedded in a JS string — unescape \" → "
      const entitiesStr = `[${match[1]}]`.replace(/\\"/g, '"');
      const entities = JSON.parse(entitiesStr);
      for (const item of entities) {
        if (item['@type'] === 'Question' && item.name) {
          faqs.push({
            question: item.name,
            answer: cheerio
              .load(item.acceptedAnswer?.text || '')('body')
              .text(),
          });
        }
      }
    } catch {
      /* partial match or malformed JSON — try next */
    }
  }

  // Also try standard <script type="application/ld+json"> tags (non-RSC pages)
  if (faqs.length === 0) {
    const $ = cheerio.load(html);
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).html() || '');
        const faqPage =
          data['@type'] === 'FAQPage'
            ? data
            : data['@graph']?.find((g: { '@type': string }) => g['@type'] === 'FAQPage');
        if (faqPage?.mainEntity) {
          for (const item of faqPage.mainEntity) {
            if (item['@type'] === 'Question') {
              faqs.push({
                question: item.name || '',
                answer: cheerio
                  .load(item.acceptedAnswer?.text || '')('body')
                  .text(),
              });
            }
          }
        }
      } catch {
        /* not valid JSON-LD */
      }
    });
  }

  return faqs;
}

function extractMainContent(html: string): string {
  const $ = cheerio.load(html);

  // Remove nav, footer, scripts, styles, cookie banners
  $('nav, footer, script, style, noscript, [role="banner"], [role="navigation"]').remove();
  $('[class*="cookie"], [class*="banner"], [class*="modal"]').remove();

  const main = $('main').first();
  if (!main.length) return '';

  // Remove CTA buttons and form sections
  main.find('form, [class*="request-demo"], [class*="trial"]').remove();

  const rawHtml = main.html() || '';
  return td
    .turndown(rawHtml)
    .replace(/^### \s*$/gm, '') // Remove empty headings (accordion toggles)
    .replace(/\n{3,}/g, '\n\n') // Collapse excessive newlines
    .trim();
}

function extractMetaDescription(html: string): string {
  const $ = cheerio.load(html);
  return $('meta[name="description"]').attr('content') || '';
}

function sectionNameFromPath(urlPath: string, productSlug: string): string {
  // /products/command/pricing/ → "Pricing"
  // /products/command/ → "Overview"
  const cleaned = urlPath.replace(`/products/${productSlug}/`, '').replace(/\/$/, '');

  if (!cleaned) return 'Overview';

  return cleaned
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ─── Product scraper ─────────────────────────────────────────────────────────

async function scrapeProduct(product: ProductDef): Promise<void> {
  process.stdout.write(`  ${product.name} `);

  const parts: string[] = [];
  parts.push(`# ${product.name}`);
  parts.push('');

  let metaDesc = '';
  const allFaqs: FAQItem[] = [];

  for (const pagePath of product.pages) {
    await sleep(DELAY_MS);
    const html = await fetchPage(pagePath);
    if (!html) continue;

    const sectionName = sectionNameFromPath(pagePath, product.slug);
    const content = extractMainContent(html);

    if (!metaDesc) metaDesc = extractMetaDescription(html);

    // Extract FAQs from JSON-LD
    const faqs = extractJsonLdFaqs(html);
    allFaqs.push(...faqs);

    if (content) {
      parts.push(`## ${sectionName}`);
      parts.push('');
      parts.push(content);
      parts.push('');
    }

    process.stdout.write('.');
  }

  // Append FAQ section if any were found
  if (allFaqs.length) {
    parts.push('## Frequently Asked Questions');
    parts.push('');
    for (const faq of allFaqs) {
      parts.push(`### ${faq.question}`);
      parts.push('');
      parts.push(faq.answer);
      parts.push('');
    }
  }

  const markdown = parts.join('\n');
  const filePath = path.join(PRODUCTS_DIR, `${product.slug}.md`);

  // Content hash check
  const newHash = createHash('md5').update(markdown).digest('hex');
  const existingHash = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, 'utf-8').match(/^hash: "([a-f0-9]+)"$/m)?.[1]
    : undefined;

  if (existingHash === newHash) {
    console.log(' ↩');
    return;
  }

  fs.mkdirSync(PRODUCTS_DIR, { recursive: true });
  const content = [
    '---',
    `title: "${product.name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
    `url: "${BASE_URL}/products/${product.slug}/"`,
    `description: "${metaDesc.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
    `crawled: "${new Date().toISOString()}"`,
    `hash: "${newHash}"`,
    '---',
    '',
    markdown,
  ].join('\n');

  fs.writeFileSync(filePath, content, 'utf-8');
  console.log(' ✓');
}

async function crawlProducts(singleSlug?: string): Promise<void> {
  console.log('\n📦 Scraping Rapid7 products...');
  const targets = singleSlug ? PRODUCTS.filter((p) => p.slug === singleSlug) : PRODUCTS;

  if (singleSlug && targets.length === 0) {
    console.error(`  ✗ Unknown product: ${singleSlug}`);
    console.error(`  Available: ${PRODUCTS.map((p) => p.slug).join(', ')}`);
    process.exit(1);
  }

  for (const product of targets) {
    await scrapeProduct(product);
  }
  console.log(`✅ Scraped ${targets.length} products`);
}

// ─── Blog scraper ────────────────────────────────────────────────────────────

interface BlogPost {
  title: string;
  url: string;
  date: string;
  category: string;
}

async function scrapeBlogPage(pageNum: number): Promise<{ posts: BlogPost[]; hasNext: boolean }> {
  const urlPath = pageNum === 1 ? '/blog/' : `/blog/page/${pageNum}/`;
  const html = await fetchPage(urlPath);
  if (!html) return { posts: [], hasNext: false };

  const $ = cheerio.load(html);
  const posts: BlogPost[] = [];
  const seen = new Set<string>();

  // Build slug→date map from Next.js RSC payload (dates live in dehydrated state, not DOM)
  const dateMap = new Map<string, string>();
  const dateUrlRe = /\\"date\\":\\"(\d{4}-\d{2}-\d{2})T[^"]*\\".*?\\"url\\":\\"(\/blog\/post\/[^"\\]+)\\"/g;
  let dm;
  while ((dm = dateUrlRe.exec(html)) !== null) {
    dateMap.set(dm[2].replace(/\/$/, ''), dm[1]);
  }

  // Extract posts from HTML card links
  $('a[href^="/blog/post/"]').each((_, el) => {
    const $a = $(el);
    const href = ($a.attr('href') || '').replace(/\/$/, '');
    if (seen.has(href)) return;
    seen.add(href);

    // Title from img alt (most reliable on this site) or heading text
    const title = $a.find('img[alt]').first().attr('alt')?.trim() || $a.find('h2, h3, h4').first().text().trim() || '';

    if (!title || title.length < 5) return;

    const date = dateMap.get(href) || '';

    // Category: first short text span inside the card link
    let category = '';
    const spans = $a.find('span, p').toArray();
    for (const span of spans) {
      const text = $(span).text().trim();
      if (text && text.length > 3 && text.length < 40 && text !== title && !text.includes('Read')) {
        category = text;
        break;
      }
    }

    posts.push({
      title,
      url: `${BASE_URL}${href}`,
      date,
      category,
    });
  });

  // Check for next page
  const hasNext =
    $(`a[href="/blog/page/${pageNum + 1}/"]`).length > 0 || $(`a[href*="/blog/page/${pageNum + 1}"]`).length > 0;

  return { posts, hasNext };
}

async function crawlBlog(): Promise<void> {
  console.log('\n📝 Scraping Rapid7 blog index...');

  const allPosts: BlogPost[] = [];
  const seenUrls = new Set<string>();
  let page = 1;
  let hasNext = true;

  while (hasNext) {
    process.stdout.write(`  Page ${page}...`);
    await sleep(DELAY_MS);
    const { posts, hasNext: more } = await scrapeBlogPage(page);

    // Deduplicate
    for (const post of posts) {
      if (!seenUrls.has(post.url)) {
        seenUrls.add(post.url);
        allPosts.push(post);
      }
    }

    process.stdout.write(` ${posts.length} posts\n`);
    hasNext = more && posts.length > 0;
    page++;
  }

  // Write blog index
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const outputPath = path.join(DATA_DIR, 'blog-index.json');
  fs.writeFileSync(outputPath, JSON.stringify(allPosts, null, 2), 'utf-8');
  console.log(`✅ Blog index: ${allPosts.length} posts → data/blog-index.json`);
}

// ─── Resources scraper ───────────────────────────────────────────────────────

interface Resource {
  title: string;
  url: string;
  type: string;
  description: string;
}

async function scrapeResourcesPage(pageNum: number): Promise<{ resources: Resource[]; hasNext: boolean }> {
  const urlPath = pageNum === 1 ? '/resources/' : `/resources/page/${pageNum}/`;
  const html = await fetchPage(urlPath);
  if (!html) return { resources: [], hasNext: false };

  const $ = cheerio.load(html);
  const resources: Resource[] = [];

  // Resource cards link to /lp/, /research/, /info/ paths
  $('a[href^="/lp/"], a[href^="/research/"], a[href^="/info/"]').each((_, el) => {
    const $a = $(el);
    const href = $a.attr('href') || '';
    const fullUrl = `${BASE_URL}${href}`;

    if (resources.some((r) => r.url === fullUrl)) return;

    const $card = $a.closest('[class]');
    const title = $a.find('h2, h3').first().text().trim() || $a.text().trim();

    if (!title || title.length < 5) return;

    // Type: usually labeled on the card (e.g., "Whitepaper", "Webinar", "Report")
    let type = $card.find('[class*="type"], [class*="label"], [class*="tag"]').first().text().trim() || '';

    // Description: first <p> in the card
    const allP = $card
      .find('p')
      .toArray()
      .map((p) => $(p).text().trim())
      .filter(Boolean);
    let description = '';

    // The first <p> is often a short type label; real descriptions are longer
    const TYPE_LABELS = ['research', 'report', 'whitepaper', 'webinar', 'guide', 'ebook', 'datasheet', 'infographic'];
    if (!type && allP.length > 0 && allP[0].length < 30) {
      const lower = allP[0].toLowerCase();
      if (TYPE_LABELS.some((t) => lower.includes(t))) {
        type = allP[0];
        description = allP.length > 1 ? allP[1] : '';
      } else {
        description = allP[0];
      }
    } else {
      description = allP[0] || '';
    }

    resources.push({ title, url: fullUrl, type, description });
  });

  const hasNext =
    $(`a[href="/resources/page/${pageNum + 1}/"]`).length > 0 ||
    $(`a[href*="/resources/page/${pageNum + 1}"]`).length > 0;

  return { resources, hasNext };
}

async function crawlResources(): Promise<void> {
  console.log('\n📚 Scraping Rapid7 resources index...');

  const allResources: Resource[] = [];
  const seenUrls = new Set<string>();
  let page = 1;
  let hasNext = true;

  while (hasNext) {
    process.stdout.write(`  Page ${page}...`);
    await sleep(DELAY_MS);
    const { resources, hasNext: more } = await scrapeResourcesPage(page);

    for (const res of resources) {
      if (!seenUrls.has(res.url)) {
        seenUrls.add(res.url);
        allResources.push(res);
      }
    }

    process.stdout.write(` ${resources.length} resources\n`);
    hasNext = more && resources.length > 0;
    page++;
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const outputPath = path.join(DATA_DIR, 'resources.json');
  fs.writeFileSync(outputPath, JSON.stringify(allResources, null, 2), 'utf-8');
  console.log(`✅ Resources index: ${allResources.length} resources → data/resources.json`);
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const doAll = args.length === 0;
  const doProducts = doAll || args.includes('--products');
  const doBlog = doAll || args.includes('--blog');
  const doResources = doAll || args.includes('--resources');

  const productIdx = args.indexOf('--product');
  const singleProduct = productIdx !== -1 ? args[productIdx + 1] : undefined;

  if (singleProduct) {
    await crawlProducts(singleProduct);
  } else if (doProducts) {
    await crawlProducts();
  }

  if (doBlog) await crawlBlog();
  if (doResources) await crawlResources();
}

main().catch((err) => {
  console.error('Site crawl failed:', err);
  process.exit(1);
});
