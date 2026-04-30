import { useMemo, useState } from "react";
import type { ResolvedApp } from "../lib/types";
import { formatBytes, selectAsset } from "../lib/platform";
import { installApp, uninstallApp } from "../lib/installer";
import { useAppContext } from "../state/AppContext";
import { useHost } from "../hooks/useHost";
import styles from "./InstallButton.module.css";

export function InstallButton({ app }: { app: ResolvedApp }) {
  const { installedBySlug, progress, desktop, refreshInstalled } = useAppContext();
  const host = useHost();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const installed = installedBySlug.get(app.slug);
  const release = app.latest_release;

  const match = useMemo(() => {
    if (!release || !host) return null;
    return selectAsset(release.assets, app.assets, host);
  }, [release, app.assets, host]);

  const p = progress[app.slug];

  async function handleInstall() {
    if (!match || !release) return;
    setBusy(true);
    setError(null);
    try {
      await installApp({
        slug: app.slug,
        repo: app.repo,
        version: release.tag_name,
        download_url: match.asset.browser_download_url,
        kind: match.kind,
        binary_name: match.pattern?.binary_name,
      });
      await refreshInstalled();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleUninstall() {
    setBusy(true);
    setError(null);
    try {
      await uninstallApp(app.slug);
      await refreshInstalled();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!desktop) {
    return (
      <div className={styles.wrap}>
        <button disabled title="Install is only available in the desktop app">
          Install (desktop only)
        </button>
        {release ? (
          <a
            className={styles.downloadFallback}
            href={release.html_url}
            target="_blank"
            rel="noreferrer"
          >
            Open release on GitHub ↗
          </a>
        ) : null}
      </div>
    );
  }

  if (installed) {
    const outdated = release && installed.version !== release.tag_name;
    return (
      <div className={styles.wrap}>
        <div className={styles.installedRow}>
          <span className={styles.installed}>
            Installed <code>{installed.version}</code>
          </span>
          {outdated ? (
            <button className="primary" disabled={busy} onClick={handleInstall}>
              Update to {release.tag_name}
            </button>
          ) : null}
          <button className="danger" disabled={busy} onClick={handleUninstall}>
            Uninstall
          </button>
        </div>
        {error ? <div className={styles.error}>{error}</div> : null}
      </div>
    );
  }

  if (!release) {
    return (
      <div className={styles.wrap}>
        <button disabled>No releases published</button>
      </div>
    );
  }

  if (!match) {
    return (
      <div className={styles.wrap}>
        <button disabled>No compatible asset for {host?.platform ?? "this system"}</button>
        <a
          className={styles.downloadFallback}
          href={release.html_url}
          target="_blank"
          rel="noreferrer"
        >
          Browse all assets on GitHub ↗
        </a>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <button className="primary" disabled={busy} onClick={handleInstall}>
        {busy ? (p ? prettyStage(p.stage) : "Installing…") : `Install ${release.tag_name}`}
      </button>
      <div className={styles.assetInfo}>
        <span>{match.asset.name}</span>
        <span>·</span>
        <span>{formatBytes(match.asset.size)}</span>
        <span>·</span>
        <span>{match.kind}</span>
      </div>
      {p && p.stage !== "done" && p.stage !== "error" ? (
        <progress
          className={styles.progress}
          value={p.bytes_downloaded ?? 0}
          max={p.bytes_total ?? match.asset.size}
        />
      ) : null}
      {error ? <div className={styles.error}>{error}</div> : null}
    </div>
  );
}

function prettyStage(stage: string): string {
  switch (stage) {
    case "resolving":
      return "Resolving…";
    case "downloading":
      return "Downloading…";
    case "verifying":
      return "Verifying…";
    case "extracting":
      return "Extracting…";
    case "installing":
      return "Installing…";
    default:
      return "Working…";
  }
}
