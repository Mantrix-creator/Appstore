#!/usr/bin/env node
/**
 * Registry crawler.
 *
 * Discovers candidate apps for the AppStore registry by querying the GitHub
 * search API for popular repos that ship release binaries. Emits manifest
 * stubs into `registry/candidates/<slug>.json` — a maintainer reviews and
 * promotes them into `registry/apps/` via PR.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_... node scripts/crawl-registry.mjs
 *   node scripts/crawl-registry.mjs --query "topic:cli language:Rust" --min-stars 1000
 *
 * Designed to be invoked from `.github/workflows/crawl-registry.yml`.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const args = parseArgs(process.argv.slice(2));
const QUERIES = args.query
  ? [args.query]
  : [
      "topic:cli stars:>=2000 archived:false",
      "topic:developer-tools stars:>=2000 archived:false",
      "topic:productivity stars:>=5000 archived:false",
    ];
const MIN_STARS = Number(args["min-stars"] ?? 2000);
const MAX_CANDIDATES = Number(args["max-candidates"] ?? 25);
const DRY_RUN = args["dry-run"] === "true" || args["dry-run"] === true;

const HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "appstore-crawler",
};
if (process.env.GITHUB_TOKEN) HEADERS.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function gh(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  return res.json();
}

function toSlug(repo) {
  return repo.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function guessCategory(repo) {
  const topics = new Set((repo.topics ?? []).map((t) => t.toLowerCase()));
  if (topics.has("cli") || topics.has("developer-tools") || topics.has("terminal")) {
    return "developer-tools";
  }
  if (topics.has("productivity") || topics.has("note-taking") || topics.has("todo")) {
    return "productivity";
  }
  if (topics.has("game") || topics.has("games")) return "games";
  if (topics.has("media") || topics.has("video") || topics.has("audio")) return "media";
  if (topics.has("security") || topics.has("encryption")) return "security";
  return "uncategorized";
}

async function hasReleaseBinaries(fullName) {
  try {
    const rel = await gh(`https://api.github.com/repos/${fullName}/releases/latest`);
    return Array.isArray(rel.assets) && rel.assets.length > 0;
  } catch {
    return false;
  }
}

async function loadExistingSlugs() {
  const dir = path.join(ROOT, "registry", "apps");
  const existing = new Set();
  try {
    const files = await fs.readdir(dir);
    for (const f of files) {
      if (f.endsWith(".json")) existing.add(f.replace(/\.json$/, ""));
    }
  } catch {
    /* noop */
  }
  return existing;
}

async function loadExistingCandidates() {
  const dir = path.join(ROOT, "registry", "candidates");
  const existing = new Set();
  try {
    const files = await fs.readdir(dir);
    for (const f of files) {
      if (f.endsWith(".json")) existing.add(f.replace(/\.json$/, ""));
    }
  } catch {
    /* noop */
  }
  return existing;
}

async function writeCandidate(manifest) {
  const dir = path.join(ROOT, "registry", "candidates");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${manifest.slug}.json`);
  await fs.writeFile(file, JSON.stringify(manifest, null, 2) + "\n");
  return file;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[(i += 1)] : "true";
    out[k] = v;
  }
  return out;
}

async function main() {
  console.log(`Crawler running: queries=${QUERIES.length}, min_stars=${MIN_STARS}`);
  const existingApps = await loadExistingSlugs();
  const existingCandidates = await loadExistingCandidates();
  const seen = new Set();
  const candidates = [];

  for (const q of QUERIES) {
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=50`;
    console.log(`\n→ ${q}`);
    const data = await gh(url);
    for (const item of data.items ?? []) {
      if (candidates.length >= MAX_CANDIDATES) break;
      if (item.archived) continue;
      if (item.stargazers_count < MIN_STARS) continue;
      const slug = toSlug(item.name);
      if (!slug || slug.length > 40) continue;
      if (seen.has(item.full_name)) continue;
      if (existingApps.has(slug) || existingCandidates.has(slug)) continue;
      seen.add(item.full_name);

      const ok = await hasReleaseBinaries(item.full_name);
      if (!ok) {
        console.log(`  skip ${item.full_name}: no release binaries`);
        continue;
      }

      const manifest = {
        slug,
        repo: item.full_name,
        name: item.name,
        tagline: item.description ?? "",
        category: guessCategory(item),
        tags: (item.topics ?? []).slice(0, 8),
        verified: false,
        featured: false,
      };
      candidates.push(manifest);
      console.log(`  +  ${item.full_name} (★${item.stargazers_count}) → ${slug}`);
    }
    if (candidates.length >= MAX_CANDIDATES) break;
  }

  if (candidates.length === 0) {
    console.log("\nNo new candidates discovered.");
    return;
  }

  console.log(`\nWriting ${candidates.length} candidate manifest(s)…`);
  for (const m of candidates) {
    if (DRY_RUN) {
      console.log(`[dry-run] would write registry/candidates/${m.slug}.json`);
    } else {
      const file = await writeCandidate(m);
      console.log(`  wrote ${path.relative(ROOT, file)}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
