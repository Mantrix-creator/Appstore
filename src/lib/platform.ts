/**
 * Platform + architecture detection and release-asset selection.
 *
 * In a Tauri context this queries the Rust side via @tauri-apps/plugin-os.
 * In a plain browser context (for unit tests, dev server), it falls back to
 * navigator.userAgentData / navigator.platform.
 */

import type { AssetPattern, GitHubReleaseAsset, InstallKind, Platform } from "./types";

export interface HostInfo {
  platform: Platform;
  arch: "x86_64" | "aarch64" | "i686" | "armv7";
}

export async function detectHost(): Promise<HostInfo> {
  // Prefer Tauri OS plugin when available.
  try {
    const osPlugin = await import("@tauri-apps/plugin-os");
    const platformName = await osPlugin.platform();
    const archName = await osPlugin.arch();
    return {
      platform: normalizePlatform(platformName),
      arch: normalizeArch(archName),
    };
  } catch {
    return detectHostFromNavigator();
  }
}

function normalizePlatform(name: string): Platform {
  const n = name.toLowerCase();
  if (n.includes("linux")) return "linux";
  if (n.includes("mac") || n.includes("darwin")) return "macos";
  if (n.includes("win")) return "windows";
  return "linux";
}

function normalizeArch(name: string): HostInfo["arch"] {
  const n = name.toLowerCase();
  if (n.includes("aarch64") || n.includes("arm64")) return "aarch64";
  if (n.includes("x86_64") || n.includes("x64") || n.includes("amd64")) return "x86_64";
  if (n.includes("armv7") || n.includes("armhf")) return "armv7";
  if (n.includes("i686") || n.includes("x86") || n.includes("i386")) return "i686";
  return "x86_64";
}

export function detectHostFromNavigator(): HostInfo {
  const ua = navigator.userAgent.toLowerCase();
  let platform: Platform = "linux";
  if (ua.includes("mac")) platform = "macos";
  else if (ua.includes("win")) platform = "windows";
  else if (ua.includes("linux")) platform = "linux";

  let arch: HostInfo["arch"] = "x86_64";
  if (ua.includes("arm64") || ua.includes("aarch64")) arch = "aarch64";

  return { platform, arch };
}

/**
 * Infer the InstallKind from a filename extension.
 */
export function kindFromFilename(name: string): InstallKind | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".appimage")) return "appimage";
  if (lower.endsWith(".deb")) return "deb";
  if (lower.endsWith(".rpm")) return "rpm";
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) return "tar.gz";
  if (lower.endsWith(".zip")) return "zip";
  if (lower.endsWith(".dmg")) return "dmg";
  if (lower.endsWith(".pkg")) return "pkg";
  if (lower.endsWith(".msi")) return "msi";
  if (lower.endsWith(".exe")) return "exe";
  return null;
}

/**
 * Heuristic asset matcher used when no explicit `assets` patterns are
 * provided in the manifest. We look for common naming conventions used by
 * tools like goreleaser and cargo-dist.
 */
export function heuristicMatch(
  assets: GitHubReleaseAsset[],
  host: HostInfo,
): GitHubReleaseAsset | null {
  const { platform, arch } = host;

  const platformKeywords: Record<Platform, string[]> = {
    linux: ["linux", "ubuntu", "debian"],
    macos: ["darwin", "macos", "mac", "apple", "osx"],
    windows: ["windows", "win", "win64", "win32"],
  };

  const archKeywords: Record<HostInfo["arch"], string[]> = {
    x86_64: ["x86_64", "x64", "amd64", "x86-64"],
    aarch64: ["aarch64", "arm64"],
    i686: ["i686", "x86", "i386"],
    armv7: ["armv7", "armhf"],
  };

  const preferred: InstallKind[] =
    platform === "linux"
      ? ["appimage", "deb", "tar.gz", "zip"]
      : platform === "macos"
        ? ["dmg", "pkg", "tar.gz", "zip"]
        : ["msi", "exe", "zip"];

  const scored = assets
    .map((asset) => {
      const lower = asset.name.toLowerCase();
      const kind = kindFromFilename(asset.name);
      const platformHit = platformKeywords[platform].some((k) => lower.includes(k));
      const archHit = archKeywords[arch].some((k) => lower.includes(k));
      const kindRank = kind ? preferred.indexOf(kind) : -1;
      return { asset, platformHit, archHit, kind, kindRank };
    })
    .filter((x) => x.platformHit && x.kindRank >= 0)
    // Prefer matching arch + lowest (best) kindRank.
    .sort((a, b) => {
      if (a.archHit !== b.archHit) return a.archHit ? -1 : 1;
      return a.kindRank - b.kindRank;
    });

  return scored[0]?.asset ?? null;
}

/**
 * Select an asset from a release using explicit AssetPatterns first, then
 * falling back to heuristics.
 */
export function selectAsset(
  assets: GitHubReleaseAsset[],
  patterns: AssetPattern[] | undefined,
  host: HostInfo,
): { asset: GitHubReleaseAsset; kind: InstallKind; pattern?: AssetPattern } | null {
  if (patterns && patterns.length > 0) {
    const matching = patterns.filter((p) => p.platform === host.platform && p.arch === host.arch);
    for (const pattern of matching) {
      const re = new RegExp(pattern.match, "i");
      const asset = assets.find((a) => re.test(a.name));
      if (asset) return { asset, kind: pattern.kind, pattern };
    }
  }

  const heuristic = heuristicMatch(assets, host);
  if (heuristic) {
    const kind = kindFromFilename(heuristic.name);
    if (kind) return { asset: heuristic, kind };
  }
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}
