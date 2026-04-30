import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { marked } from "marked";
import { getReadme } from "../lib/github";
import { getRegistryManifest, resolveApp, virtualManifest } from "../lib/registry";
import type { ResolvedApp } from "../lib/types";
import { InstallButton } from "../components/InstallButton";
import styles from "./Pages.module.css";

export function AppDetailPage() {
  const { owner, repo } = useParams();
  const [app, setApp] = useState<ResolvedApp | null>(null);
  const [readme, setReadme] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!owner || !repo) return;
    let cancelled = false;
    (async () => {
      try {
        const slug = `${owner}-${repo}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
        const fromRegistry = await getRegistryManifest(slug);
        const manifest = fromRegistry ?? virtualManifest(`${owner}/${repo}`);
        const resolved = await resolveApp(manifest);
        if (cancelled) return;
        setApp(resolved);
        const r = await getReadme(owner, repo, resolved.github.default_branch);
        if (!cancelled) setReadme(r);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [owner, repo]);

  const html = useMemo(() => {
    if (!readme) return "";
    // marked@14 supports sync-mode via parse.
    return marked.parse(readme, { async: false }) as string;
  }, [readme]);

  if (error) {
    return (
      <div className={styles.error}>
        Failed to load app: {error}
        <div>
          <Link to="/browse">← Back to browse</Link>
        </div>
      </div>
    );
  }
  if (!app) return <div className={styles.empty}>Loading…</div>;

  const release = app.latest_release;

  return (
    <article className={styles.detail}>
      <header className={styles.detailHeader}>
        <img src={app.icon} alt="" className={styles.detailIcon} />
        <div className={styles.detailHeading}>
          <h1 className={styles.detailTitle}>
            {app.name}
            {app.verified ? (
              <span className={styles.detailVerified} title="Verified">
                ✓
              </span>
            ) : null}
          </h1>
          <div className={styles.detailRepo}>
            <a href={app.github.html_url} target="_blank" rel="noreferrer">
              {app.repo} ↗
            </a>
          </div>
          <div className={styles.detailTagline}>{app.tagline}</div>
          <div className={styles.detailMeta}>
            <span>★ {app.stars.toLocaleString()}</span>
            {app.license ? <span>{app.license}</span> : null}
            {release ? <span>Latest: {release.tag_name}</span> : null}
            {app.homepage ? (
              <a href={app.homepage} target="_blank" rel="noreferrer">
                Homepage ↗
              </a>
            ) : null}
          </div>
        </div>
      </header>

      <section className={styles.installSection}>
        <InstallButton app={app} />
      </section>

      {release ? (
        <section>
          <h2 className={styles.sectionTitle}>Release: {release.tag_name}</h2>
          <div className={styles.detailRelease}>
            <div>
              Published {new Date(release.published_at).toLocaleDateString()} ·{" "}
              <a href={release.html_url} target="_blank" rel="noreferrer">
                View on GitHub ↗
              </a>
            </div>
            <details className={styles.assetList}>
              <summary>All release assets ({release.assets.length})</summary>
              <ul>
                {release.assets.map((a) => (
                  <li key={a.id}>
                    <a href={a.browser_download_url} target="_blank" rel="noreferrer">
                      {a.name}
                    </a>
                    <span className={styles.assetSize}>
                      {(a.size / (1024 * 1024)).toFixed(1)} MB
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        </section>
      ) : null}

      <section>
        <h2 className={styles.sectionTitle}>README</h2>
        {html ? (
          <div
            className={styles.readme}
            // README content is fetched from the GitHub API; we render it as HTML
            // for the desktop app. In a browser-only build you'd want a sanitizer
            // like DOMPurify here.
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <div className={styles.empty}>No README available.</div>
        )}
      </section>
    </article>
  );
}
