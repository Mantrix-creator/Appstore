import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAppContext } from "../state/AppContext";
import { uninstallApp } from "../lib/installer";
import { getLatestRelease } from "../lib/github";
import styles from "./Pages.module.css";

type LatestMap = Record<string, { tag: string | null; loading: boolean }>;

export function InstalledPage() {
  const { installed, desktop, refreshInstalled } = useAppContext();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [latest, setLatest] = useState<LatestMap>({});

  useEffect(() => {
    if (installed.length === 0) return;
    let cancelled = false;
    setLatest((prev) => {
      const next: LatestMap = { ...prev };
      for (const a of installed) next[a.slug] = next[a.slug] ?? { tag: null, loading: true };
      return next;
    });
    (async () => {
      for (const app of installed) {
        const [owner, repo] = app.repo.split("/");
        if (!owner || !repo) continue;
        try {
          const rel = await getLatestRelease(owner, repo);
          if (cancelled) return;
          setLatest((prev) => ({
            ...prev,
            [app.slug]: { tag: rel?.tag_name ?? null, loading: false },
          }));
        } catch {
          if (cancelled) return;
          setLatest((prev) => ({ ...prev, [app.slug]: { tag: null, loading: false } }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [installed]);

  async function handleUninstall(slug: string) {
    setBusy(slug);
    setError(null);
    try {
      await uninstallApp(slug);
      await refreshInstalled();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <header className={styles.header}>
        <h1 className={styles.title}>Installed apps</h1>
        <p className={styles.subtitle}>
          Apps managed by AppStore. Each install is a verified download from GitHub Releases.
        </p>
      </header>

      {!desktop ? (
        <div className={styles.empty}>Installations are only tracked in the desktop app.</div>
      ) : null}

      {error ? <div className={styles.error}>{error}</div> : null}

      {installed.length === 0 && desktop ? (
        <div className={styles.empty}>
          Nothing installed yet. <Link to="/browse">Browse the registry →</Link>
        </div>
      ) : null}

      {installed.length > 0 ? (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Slug</th>
              <th>Repo</th>
              <th>Version</th>
              <th>Status</th>
              <th>Installed</th>
              <th>Kind</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {installed.map((app) => {
              const [owner, repo] = app.repo.split("/");
              const state = latest[app.slug];
              const hasUpdate =
                state && !state.loading && state.tag && state.tag !== app.version;
              return (
                <tr key={app.slug}>
                  <td>
                    <Link to={`/app/${owner}/${repo}`}>{app.slug}</Link>
                  </td>
                  <td>{app.repo}</td>
                  <td>
                    <code>{app.version}</code>
                  </td>
                  <td>
                    {!state || state.loading ? (
                      <span className={styles.updateStatus}>Checking…</span>
                    ) : hasUpdate ? (
                      <Link
                        to={`/app/${owner}/${repo}`}
                        className={styles.updateAvailable}
                        title={`Latest: ${state.tag}`}
                      >
                        Update to {state.tag}
                      </Link>
                    ) : state.tag ? (
                      <span className={styles.updateCurrent}>Up to date</span>
                    ) : (
                      <span className={styles.updateStatus}>—</span>
                    )}
                  </td>
                  <td>{new Date(app.installed_at).toLocaleDateString()}</td>
                  <td>{app.kind}</td>
                  <td>
                    <button
                      className="danger"
                      disabled={busy === app.slug}
                      onClick={() => handleUninstall(app.slug)}
                    >
                      {busy === app.slug ? "Uninstalling…" : "Uninstall"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
