import { Link } from "react-router-dom";
import { useAppContext } from "../state/AppContext";
import { uninstallApp } from "../lib/installer";
import { useState } from "react";
import styles from "./Pages.module.css";

export function InstalledPage() {
  const { installed, desktop, refreshInstalled } = useAppContext();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
              <th>Installed</th>
              <th>Kind</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {installed.map((app) => {
              const [owner, repo] = app.repo.split("/");
              return (
                <tr key={app.slug}>
                  <td>
                    <Link to={`/app/${owner}/${repo}`}>{app.slug}</Link>
                  </td>
                  <td>{app.repo}</td>
                  <td>
                    <code>{app.version}</code>
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
