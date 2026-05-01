/**
 * Thin GitHub REST client.
 *
 * Honours these conventions:
 *   - All requests include an Accept header pinned to the 2022-11-28 API.
 *   - If a PAT is stored in localStorage under `gh_token`, it is sent as
 *     Authorization. Anonymous requests work but are rate-limited to 60/hr.
 *   - Rate-limit metadata is exposed via `lastRateLimit` so the UI can warn
 *     the user when they're close to the quota.
 */

import type { GitHubRelease, GitHubRepo } from "./types";

const GITHUB_API = "https://api.github.com";
const TOKEN_KEY = "gh_token";
const USER_AGENT = "appstore-client";

export interface RateLimit {
  limit: number;
  remaining: number;
  reset: number;
}

let lastRateLimit: RateLimit | null = null;

export function getLastRateLimit(): RateLimit | null {
  return lastRateLimit;
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token === null || token === "") {
      localStorage.removeItem(TOKEN_KEY);
    } else {
      localStorage.setItem(TOKEN_KEY, token);
    }
  } catch {
    /* ignore */
  }
}

export class GitHubApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function fetchGitHub<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/vnd.github+json");
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  headers.set("User-Agent", USER_AGENT);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const url = path.startsWith("http") ? path : `${GITHUB_API}${path}`;
  const res = await fetch(url, { ...init, headers });

  const limit = Number(res.headers.get("x-ratelimit-limit") ?? 0);
  const remaining = Number(res.headers.get("x-ratelimit-remaining") ?? 0);
  const reset = Number(res.headers.get("x-ratelimit-reset") ?? 0);
  if (limit > 0) {
    lastRateLimit = { limit, remaining, reset };
  }

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* swallow */
    }
    const msg =
      typeof body === "object" && body !== null && "message" in body
        ? String((body as { message: unknown }).message)
        : res.statusText;
    throw new GitHubApiError(res.status, msg, body);
  }

  if (res.status === 204) {
    return undefined as unknown as T;
  }
  return (await res.json()) as T;
}

export async function getRepo(owner: string, name: string): Promise<GitHubRepo> {
  return fetchGitHub<GitHubRepo>(`/repos/${owner}/${name}`);
}

export async function getLatestRelease(
  owner: string,
  name: string,
): Promise<GitHubRelease | null> {
  try {
    return await fetchGitHub<GitHubRelease>(`/repos/${owner}/${name}/releases/latest`);
  } catch (err) {
    if (err instanceof GitHubApiError && err.status === 404) return null;
    throw err;
  }
}

export async function listReleases(owner: string, name: string): Promise<GitHubRelease[]> {
  return fetchGitHub<GitHubRelease[]>(`/repos/${owner}/${name}/releases?per_page=20`);
}

export interface SearchReposResult {
  total_count: number;
  incomplete_results: boolean;
  items: GitHubRepo[];
}

export async function searchRepos(
  query: string,
  opts: { sort?: "stars" | "updated"; per_page?: number; page?: number } = {},
): Promise<SearchReposResult> {
  const params = new URLSearchParams();
  params.set("q", query);
  if (opts.sort) params.set("sort", opts.sort);
  params.set("per_page", String(opts.per_page ?? 30));
  params.set("page", String(opts.page ?? 1));
  return fetchGitHub<SearchReposResult>(`/search/repositories?${params.toString()}`);
}

export async function getReadme(
  owner: string,
  name: string,
  branch?: string,
): Promise<string | null> {
  try {
    const data = await fetchGitHub<{ content: string; encoding: string }>(
      `/repos/${owner}/${name}/readme${branch ? `?ref=${branch}` : ""}`,
    );
    if (data.encoding === "base64") {
      return atob(data.content.replace(/\n/g, ""));
    }
    return data.content;
  } catch (err) {
    if (err instanceof GitHubApiError && err.status === 404) return null;
    throw err;
  }
}
