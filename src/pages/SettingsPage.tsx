import { useState } from "react";
import { useAppContext } from "../state/AppContext";
import { getLastRateLimit } from "../lib/github";
import styles from "./Pages.module.css";

export function SettingsPage() {
  const { token, setToken } = useAppContext();
  const [draft, setDraft] = useState(token ?? "");
  const [saved, setSaved] = useState(false);
  const rl = getLastRateLimit();

  function save() {
    setToken(draft.trim() || null);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  function clear() {
    setToken(null);
    setDraft("");
  }

  return (
    <div>
      <header className={styles.header}>
        <h1 className={styles.title}>Settings</h1>
        <p className={styles.subtitle}>Configure GitHub access and app preferences.</p>
      </header>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>GitHub personal access token</h2>
        <p className={styles.paragraph}>
          Anonymous API access is limited to <strong>60 requests per hour</strong>. Adding a
          token (classic or fine-grained, no scopes required for public repos) raises that to{" "}
          <strong>5,000/hour</strong>. The token is stored locally in this browser only.
        </p>
        <div className={styles.formRow}>
          <input
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="ghp_…"
            className={styles.input}
            autoComplete="off"
          />
          <button className="primary" onClick={save}>
            Save
          </button>
          <button onClick={clear} disabled={!token}>
            Clear
          </button>
        </div>
        {saved ? <div className={styles.saved}>Saved.</div> : null}
        <div className={styles.paragraph}>
          <a
            href="https://github.com/settings/tokens/new?description=AppStore&scopes="
            target="_blank"
            rel="noreferrer"
          >
            Create a new token on GitHub ↗
          </a>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>API quota</h2>
        {rl ? (
          <dl className={styles.dl}>
            <dt>Limit</dt>
            <dd>{rl.limit} requests/hour</dd>
            <dt>Remaining</dt>
            <dd>{rl.remaining}</dd>
            <dt>Resets at</dt>
            <dd>{new Date(rl.reset * 1000).toLocaleTimeString()}</dd>
          </dl>
        ) : (
          <p className={styles.paragraph}>
            No API calls have been made yet. Visit Browse or Search to populate this.
          </p>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>About</h2>
        <p className={styles.paragraph}>
          AppStore is a decentralized, GitHub-native application store. It uses no backend
          server: all data flows directly from this client to the GitHub REST and GraphQL APIs
          and to <code>raw.githubusercontent.com</code>. The curated registry lives in{" "}
          <code>registry/apps/*.json</code> in this repository — every change is a Git commit.
        </p>
      </section>
    </div>
  );
}
