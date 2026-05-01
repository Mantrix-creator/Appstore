import { useEffect, useMemo, useState } from "react";
import { AppCard } from "../components/AppCard";
import { listRegistryManifests, resolveAll } from "../lib/registry";
import type { ResolvedApp } from "../lib/types";
import styles from "./Pages.module.css";

export function BrowsePage() {
  const [apps, setApps] = useState<ResolvedApp[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string>("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const manifests = await listRegistryManifests();
        const resolved = await resolveAll(manifests);
        if (!cancelled) setApps(resolved);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const categories = useMemo(() => {
    if (!apps) return [];
    const set = new Set<string>();
    apps.forEach((a) => set.add(a.category));
    return ["all", ...Array.from(set).sort()];
  }, [apps]);

  const filtered = useMemo(() => {
    if (!apps) return [];
    const list = category === "all" ? apps : apps.filter((a) => a.category === category);
    return list.sort((a, b) => {
      if (a.featured !== b.featured) return a.featured ? -1 : 1;
      return b.stars - a.stars;
    });
  }, [apps, category]);

  const featured = useMemo(() => (apps ?? []).filter((a) => a.featured), [apps]);

  return (
    <div>
      <header className={styles.header}>
        <h1 className={styles.title}>Browse</h1>
        <p className={styles.subtitle}>
          Curated open-source apps — installed directly from GitHub Releases.
        </p>
      </header>

      {error ? (
        <div className={styles.error}>
          Failed to load registry: {error}
          <div className={styles.errorHint}>
            If you're hitting GitHub's anonymous rate limit (60/hour), add a PAT in Settings.
          </div>
        </div>
      ) : null}

      {apps === null && !error ? <SkeletonGrid /> : null}

      {featured.length > 0 && category === "all" ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Featured</h2>
          <div className={styles.grid}>
            {featured.slice(0, 4).map((app) => (
              <AppCard key={app.slug} app={app} />
            ))}
          </div>
        </section>
      ) : null}

      {apps !== null ? (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>All apps</h2>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={styles.select}
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c === "all" ? "All categories" : prettyCategory(c)}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.grid}>
            {filtered.map((app) => (
              <AppCard key={app.slug} app={app} />
            ))}
          </div>
          {filtered.length === 0 ? (
            <div className={styles.empty}>No apps in this category yet.</div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className={styles.grid}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className={styles.skeleton} />
      ))}
    </div>
  );
}

function prettyCategory(slug: string): string {
  return slug
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}
