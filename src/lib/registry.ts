/**
 * The Registry is the curated index of applications the store knows about.
 *
 * Registry manifests live in `registry/apps/*.json` at the root of this
 * repository. In production, the client fetches them from
 *   https://raw.githubusercontent.com/<owner>/<repo>/<branch>/registry/...
 * which takes advantage of GitHub's CDN — fulfilling the "GitHub as a
 * database" contract.
 *
 * During development the client loads bundled copies via Vite's
 * import.meta.glob so the app works without network.
 */

import type { AppManifest, ResolvedApp } from "./types";
import { getLatestRelease, getRepo } from "./github";

const REGISTRY_OWNER = "Mantrix-creator";
const REGISTRY_REPO = "Appstore";
const REGISTRY_BRANCH = "main";

const REMOTE_INDEX_URL = `https://raw.githubusercontent.com/${REGISTRY_OWNER}/${REGISTRY_REPO}/${REGISTRY_BRANCH}/registry/index.json`;

function remoteManifestUrl(slug: string): string {
  return `https://raw.githubusercontent.com/${REGISTRY_OWNER}/${REGISTRY_REPO}/${REGISTRY_BRANCH}/registry/apps/${slug}.json`;
}

// Bundled copies of registry manifests so the client works offline / during dev.
const bundled = import.meta.glob("../../registry/apps/*.json", {
  eager: true,
  import: "default",
}) as Record<string, AppManifest>;

function bundledManifests(): AppManifest[] {
  return Object.values(bundled);
}

function bundledBySlug(slug: string): AppManifest | null {
  const hit = Object.entries(bundled).find(([path]) => path.endsWith(`/${slug}.json`));
  return hit ? hit[1] : null;
}

/**
 * List all manifests in the registry.
 * Tries the remote index first, falls back to bundled copies.
 */
export async function listRegistryManifests(): Promise<AppManifest[]> {
  try {
    const res = await fetch(REMOTE_INDEX_URL, { cache: "no-cache" });
    if (res.ok) {
      const index = (await res.json()) as { apps: string[] };
      const manifests = await Promise.all(
        index.apps.map(async (slug) => {
          const r = await fetch(remoteManifestUrl(slug), { cache: "no-cache" });
          if (!r.ok) return null;
          return (await r.json()) as AppManifest;
        }),
      );
      const ok = manifests.filter((m): m is AppManifest => m !== null);
      if (ok.length > 0) return ok;
    }
  } catch {
    /* fall through to bundled */
  }
  return bundledManifests();
}

export async function getRegistryManifest(slug: string): Promise<AppManifest | null> {
  try {
    const res = await fetch(remoteManifestUrl(slug), { cache: "no-cache" });
    if (res.ok) {
      return (await res.json()) as AppManifest;
    }
  } catch {
    /* fall through */
  }
  return bundledBySlug(slug);
}

/**
 * Merge a manifest with live GitHub data into a ResolvedApp.
 * Fields not present in the manifest are populated from the repo.
 */
export async function resolveApp(manifest: AppManifest): Promise<ResolvedApp> {
  const [owner, name] = manifest.repo.split("/");
  if (!owner || !name) {
    throw new Error(`Invalid manifest.repo: ${manifest.repo}`);
  }
  const [repo, release] = await Promise.all([
    getRepo(owner, name),
    getLatestRelease(owner, name).catch(() => null),
  ]);

  return {
    slug: manifest.slug,
    repo: manifest.repo,
    name: manifest.name ?? repo.name,
    tagline: manifest.tagline ?? repo.description ?? "",
    icon: manifest.icon ?? repo.owner.avatar_url,
    homepage: manifest.homepage ?? repo.homepage,
    category: manifest.category ?? "uncategorized",
    tags: manifest.tags ?? repo.topics ?? [],
    stars: repo.stargazers_count,
    license: manifest.license ?? repo.license?.spdx_id ?? null,
    latest_release: release,
    verified: manifest.verified ?? false,
    featured: manifest.featured ?? false,
    assets: manifest.assets ?? [],
    github: repo,
  };
}

/**
 * Resolve every manifest in the registry. Individual failures are dropped so
 * that one broken entry doesn't break the browse page — but if *every*
 * manifest fails we throw, so the UI can surface the underlying reason (most
 * commonly the 60 req/hr anonymous rate limit on GitHub).
 */
export async function resolveAll(manifests: AppManifest[]): Promise<ResolvedApp[]> {
  if (manifests.length === 0) return [];
  const results = await Promise.allSettled(manifests.map((m) => resolveApp(m)));
  const fulfilled = results
    .filter((r): r is PromiseFulfilledResult<ResolvedApp> => r.status === "fulfilled")
    .map((r) => r.value);
  if (fulfilled.length === 0) {
    const first = results.find((r) => r.status === "rejected") as
      | PromiseRejectedResult
      | undefined;
    const reason =
      first?.reason instanceof Error ? first.reason.message : String(first?.reason ?? "unknown");
    throw new Error(`Failed to resolve any registry apps: ${reason}`);
  }
  return fulfilled;
}

/**
 * Construct a lightweight "virtual" manifest for a repo discovered via the
 * GitHub search endpoint (i.e. not in the curated registry).
 */
export function virtualManifest(fullName: string): AppManifest {
  const [owner, name] = fullName.split("/");
  return {
    slug: `${owner}-${name}`.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
    repo: fullName,
    verified: false,
  };
}
