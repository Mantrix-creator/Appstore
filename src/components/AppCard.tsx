import { Link } from "react-router-dom";
import type { ResolvedApp } from "../lib/types";
import styles from "./AppCard.module.css";

export function AppCard({ app }: { app: ResolvedApp }) {
  const [owner, name] = app.repo.split("/");
  return (
    <Link to={`/app/${owner}/${name}`} className={styles.card}>
      <div className={styles.header}>
        <img className={styles.icon} src={app.icon} alt="" loading="lazy" />
        <div className={styles.heading}>
          <div className={styles.name}>
            {app.name}
            {app.verified ? <span className={styles.verified} title="Verified">✓</span> : null}
          </div>
          <div className={styles.repo}>{app.repo}</div>
        </div>
      </div>
      <div className={styles.tagline}>{app.tagline || "No description provided."}</div>
      <div className={styles.footer}>
        <span className={styles.stars}>★ {formatCount(app.stars)}</span>
        {app.license ? <span className={styles.license}>{app.license}</span> : null}
        {app.latest_release ? (
          <span className={styles.version}>{app.latest_release.tag_name}</span>
        ) : null}
      </div>
    </Link>
  );
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}
