import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { InstalledAppRecord, InstallProgress } from "../lib/types";
import { isDesktop, listInstalled, onInstallProgress } from "../lib/installer";
import { getStoredToken, setStoredToken } from "../lib/github";

interface AppContextValue {
  installed: InstalledAppRecord[];
  installedBySlug: Map<string, InstalledAppRecord>;
  refreshInstalled: () => Promise<void>;
  progress: Record<string, InstallProgress>;
  token: string | null;
  setToken: (token: string | null) => void;
  desktop: boolean;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppContextProvider({ children }: { children: ReactNode }) {
  const [installed, setInstalled] = useState<InstalledAppRecord[]>([]);
  const [progress, setProgress] = useState<Record<string, InstallProgress>>({});
  const [token, setTokenState] = useState<string | null>(() => getStoredToken());

  const refreshInstalled = useCallback(async () => {
    try {
      const list = await listInstalled();
      setInstalled(list);
    } catch (err) {
      console.error("Failed to list installed apps", err);
    }
  }, []);

  useEffect(() => {
    refreshInstalled();
  }, [refreshInstalled]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onInstallProgress((p) => {
      setProgress((prev) => ({ ...prev, [p.slug]: p }));
      if (p.stage === "done" || p.stage === "error") {
        refreshInstalled();
      }
    }).then((u) => {
      unlisten = u;
    });
    return () => {
      unlisten?.();
    };
  }, [refreshInstalled]);

  const setToken = useCallback((t: string | null) => {
    setStoredToken(t);
    setTokenState(t);
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      installed,
      installedBySlug: new Map(installed.map((i) => [i.slug, i])),
      refreshInstalled,
      progress,
      token,
      setToken,
      desktop: isDesktop(),
    }),
    [installed, progress, token, setToken, refreshInstalled],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used within AppContextProvider");
  return ctx;
}
