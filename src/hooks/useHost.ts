import { useEffect, useState } from "react";
import { detectHost, type HostInfo } from "../lib/platform";

export function useHost(): HostInfo | null {
  const [host, setHost] = useState<HostInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    detectHost().then((h) => {
      if (!cancelled) setHost(h);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return host;
}
