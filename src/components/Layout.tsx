import { NavLink } from "react-router-dom";
import type { ReactNode } from "react";
import { useAppContext } from "../state/AppContext";
import styles from "./Layout.module.css";

const NAV = [
  { to: "/browse", label: "Browse", icon: "◇" },
  { to: "/search", label: "Search", icon: "⌕" },
  { to: "/installed", label: "Installed", icon: "▣" },
  { to: "/settings", label: "Settings", icon: "⚙" },
] as const;

export function Layout({ children }: { children: ReactNode }) {
  const { installed, desktop } = useAppContext();
  return (
    <div className={styles.root}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.logo}>◆</span>
          <div className={styles.brandText}>
            <div className={styles.brandName}>AppStore</div>
            <div className={styles.brandSub}>GitHub-native</div>
          </div>
        </div>
        <nav className={styles.nav}>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                isActive ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem
              }
            >
              <span className={styles.navIcon}>{item.icon}</span>
              <span>{item.label}</span>
              {item.to === "/installed" && installed.length > 0 ? (
                <span className={styles.navBadge}>{installed.length}</span>
              ) : null}
            </NavLink>
          ))}
        </nav>
        <div className={styles.sidebarFooter}>
          <div className={styles.modeBadge}>{desktop ? "Desktop" : "Web preview"}</div>
        </div>
      </aside>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
