import "server-only";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isAllowedByRobots } from "./robots";

export type FetchedPage = {
  url: string;
  finalUrl: string;
  title: string;
  html: string;
  text: string;
  fetchedAt: string;
};

const CACHE_DIR = path.join(process.cwd(), ".cache", "pages");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 h
const MIN_DELAY_PER_HOST_MS = 5_000; // pas de scraping massif : 1 requête / 5 s / site
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 LocCompare/0.1 (usage personnel)";

const lastHit = new Map<string, number>();

export function cacheKey(url: string) {
  return createHash("sha256").update(url).digest("hex").slice(0, 32);
}

async function readCache(url: string): Promise<FetchedPage | null> {
  try {
    const raw = await fs.readFile(path.join(CACHE_DIR, `${cacheKey(url)}.json`), "utf8");
    const page = JSON.parse(raw) as FetchedPage;
    if (Date.now() - new Date(page.fetchedAt).getTime() < CACHE_TTL_MS) return page;
  } catch {
    /* pas en cache */
  }
  return null;
}

async function writeCache(page: FetchedPage) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(path.join(CACHE_DIR, `${cacheKey(page.url)}.json`), JSON.stringify(page));
}

export function normalizeUrl(input: string): string {
  const u = new URL(input.trim());
  if (!/^https?:$/.test(u.protocol)) throw new Error("Seules les URL http(s) sont acceptées.");
  u.hash = "";
  // retire les paramètres de tracking
  for (const k of [...u.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|xtor)/i.test(k)) u.searchParams.delete(k);
  }
  return u.toString();
}

/**
 * Récupère une page avec un navigateur headless (beaucoup de sites rendent leur
 * contenu en JavaScript). Respecte robots.txt, limite le débit par site et met
 * en cache les pages déjà analysées.
 */
export async function fetchPage(rawUrl: string, opts: { force?: boolean } = {}): Promise<{ page: FetchedPage; cached: boolean }> {
  const url = normalizeUrl(rawUrl);
  if (!opts.force) {
    const cached = await readCache(url);
    if (cached) return { page: cached, cached: true };
  }

  const host = new URL(url).host;
  const wait = (lastHit.get(host) ?? 0) + MIN_DELAY_PER_HOST_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(host, Date.now());

  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox"],
  });
  try {
    const context = await browser.newContext({ locale: "fr-FR", userAgent: USER_AGENT, viewport: { width: 1280, height: 900 } });
    // On ne charge ni images, ni polices, ni médias : seulement le texte.
    await context.route("**/*", (route) => {
      const t = route.request().resourceType();
      if (t === "image" || t === "media" || t === "font") return route.abort();
      return route.continue();
    });
    const page = await context.newPage();

    const robots = await isAllowedByRobots(url, USER_AGENT, async (robotsUrl) => {
      try {
        const res = await page.goto(robotsUrl, { timeout: 15_000 });
        if (!res || res.status() >= 400) return null;
        return await res.text();
      } catch {
        return null;
      }
    });
    if (!robots.allowed) {
      throw new Error(`robots.txt de ${host} interdit l'accès à cette page (${robots.rule}). Utilisez l'ajout manuel (copier-coller).`);
    }

    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    if (res && res.status() >= 400) {
      throw new Error(`Le site a répondu ${res.status()}${res.status() === 403 ? " (protection anti-robot probable)" : ""}. Utilisez l'ajout manuel.`);
    }
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    // Déplie les blocs "Voir plus" / "Détails du prix" pour exposer le texte caché.
    await page
      .evaluate(() => {
        document.querySelectorAll("details").forEach((d) => d.setAttribute("open", ""));
      })
      .catch(() => {});

    const html = await page.content();
    const text = await page.evaluate(() => {
      // innerText ignore les éléments masqués : on prend textContent des blocs cachés en plus.
      const visible = document.body?.innerText ?? "";
      return visible;
    });
    const fetched: FetchedPage = {
      url,
      finalUrl: page.url(),
      title: await page.title(),
      html,
      text,
      fetchedAt: new Date().toISOString(),
    };
    if (/captcha|datadome|access denied|vous avez été bloqué/i.test(fetched.title + fetched.text.slice(0, 2000)) && fetched.text.length < 3000) {
      throw new Error("Le site a affiché une protection anti-robot (captcha). Utilisez l'ajout manuel (copier-coller du texte).");
    }
    await writeCache(fetched);
    return { page: fetched, cached: false };
  } finally {
    await browser.close();
  }
}
