/**
 * Core type definitions for the AppStore client.
 *
 * The "App" is the unit of distribution. It is sourced from one of:
 *   - A curated registry entry (registry/apps/<slug>.json in this repo)
 *   - A live GitHub repository discovered via search/topic
 *
 * Metadata is resolved by merging the registry manifest with live data from
 * the GitHub REST API (release assets, stars, description, etc.).
 */

export type Platform = "linux" | "macos" | "windows";
export type Architecture = "x86_64" | "aarch64" | "i686" | "armv7";

export type InstallKind =
  | "appimage"
  | "deb"
  | "rpm"
  | "tar.gz"
  | "zip"
  | "dmg"
  | "pkg"
  | "exe"
  | "msi"
  | "raw-binary";

export type SignatureSpec = {
  /** Only keyed cosign blob signatures today; keyless coming later. */
  method: "cosign-blob";
  /** PEM-encoded ECDSA P-256 public key served over HTTPS. */
  public_key_url: string;
  /** Either a regex matched against release asset names ... */
  signature_match?: string;
  /** ... or an explicit HTTPS URL to the base64 signature blob. */
  signature_url?: string;
};

export interface AssetPattern {
  platform: Platform;
  arch: Architecture;
  kind: InstallKind;
  /** RegExp matched (case-insensitive) against a release asset filename. */
  match: string;
  /** If the release contains a checksum file, match it here. */
  checksum_match?: string;
  /** Name of the installed binary to add to PATH. Optional. */
  binary_name?: string;
  /** Optional cosign-style signature verification. */
  signature?: SignatureSpec;
}

/**
 * Manifest as written in `registry/apps/<slug>.json`.
 * Only `slug` and `repo` are required; everything else can be derived from
 * the repository's GitHub metadata.
 */
export interface AppManifest {
  /** Lowercase, URL-safe identifier. */
  slug: string;
  /** "owner/name" pointing at the GitHub repo. */
  repo: string;
  /** Display name. Falls back to the repo name. */
  name?: string;
  /** Short one-line description. Falls back to the repo description. */
  tagline?: string;
  /** Long description in markdown. Falls back to the README. */
  description?: string;
  /** URL to an icon. Falls back to the org/user avatar. */
  icon?: string;
  /** Homepage URL. */
  homepage?: string;
  /** Category slug (e.g., "developer-tools", "productivity", "games"). */
  category?: string;
  /** Free-form tags. */
  tags?: string[];
  /** SPDX license identifier. Falls back to repo license. */
  license?: string;
  /** Platform → asset-selection rules. */
  assets?: AssetPattern[];
  /** Verified by a maintainer (curated registry). */
  verified?: boolean;
  /** Featured on the browse page. */
  featured?: boolean;
}

export interface GitHubRepo {
  full_name: string;
  name: string;
  owner: { login: string; avatar_url: string };
  description: string | null;
  html_url: string;
  homepage: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  topics: string[];
  license: { spdx_id: string; name: string } | null;
  default_branch: string;
  updated_at: string;
  pushed_at: string;
  archived: boolean;
}

export interface GitHubReleaseAsset {
  id: number;
  name: string;
  browser_download_url: string;
  size: number;
  content_type: string;
  download_count: number;
}

export interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string;
  html_url: string;
  assets: GitHubReleaseAsset[];
}

/**
 * Resolved App — manifest merged with live GitHub data.
 * This is what the UI layer consumes.
 */
export interface ResolvedApp {
  slug: string;
  repo: string;
  name: string;
  tagline: string;
  icon: string;
  homepage: string | null;
  category: string;
  tags: string[];
  stars: number;
  license: string | null;
  latest_release: GitHubRelease | null;
  verified: boolean;
  featured: boolean;
  assets: AssetPattern[];
  github: GitHubRepo;
}

export interface InstalledAppRecord {
  slug: string;
  repo: string;
  version: string;
  installed_at: string;
  binary_path: string | null;
  install_dir: string;
  kind: InstallKind;
  sha256: string | null;
}

export interface InstallProgress {
  slug: string;
  stage: "resolving" | "downloading" | "verifying" | "extracting" | "installing" | "done" | "error";
  bytes_downloaded?: number;
  bytes_total?: number;
  message?: string;
}
