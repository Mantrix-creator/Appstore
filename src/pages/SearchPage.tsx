import { useEffect, useMemo, useState } from "react";
import { searchRepos } from "../lib/github";
import { resolveApp, virtualManifest } from "../lib/registry";
import type { ResolvedApp } from "../lib/types";
import { AppCard } from "../components/AppCard";
import styles from "./Pages.module.css";

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<ResolvedApp[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 400);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!debounced) {
      setResults(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        // Bias the query toward repos that have releases.
        const q = `${debounced} in:name,description,readme sort:stars`;
        const res = await searchRepos(q, { per_page: 20 });
        const manifests = res.items.map((r) => virtualManifest(r.full_name));
        const resolvedList = await Promise.allSettled(manifests.map((m) => resolveApp(m)));
        const resolved: ResolvedApp[] = resolvedList
          .filter((r): r is PromiseFulfilledResult<ResolvedApp> => r.status === "fulfilled")
          .map((r) => r.value)
          // Hide repos that never published a GitHub Release.
          .filter((a) => a.latest_release !== null);
        if (!cancelled) setResults(resolved);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  const hasResults = useMemo(() => (results?.length ?? 0) > 0, [results]);

  return (
    <div>
      <header className={styles.header}>
        <h1 className={styles.title}>Search</h1>
        <p className={styles.subtitle}>Find any GitHub project that publishes releases.</p>
      </header>

      <div className={styles.searchBar}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. neovim, zed, obsidian, ollama…"
          autoFocus
          className={styles.searchInput}
        />
      </div>

      {error ? <div className={styles.error}>Search failed: {error}</div> : null}
      {loading && !results ? <div className={styles.empty}>Searching…</div> : null}

      {results !== null && !hasResults && !loading ? (
        <div className={styles.empty}>No releases matched "{debounced}".</div>
      ) : null}

      {hasResults ? (
        <div className={styles.grid}>
          {results!.map((app) => (
            <AppCard key={app.slug} app={app} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
