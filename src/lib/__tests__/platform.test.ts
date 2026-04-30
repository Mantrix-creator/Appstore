import { describe, expect, it } from "vitest";
import type { GitHubReleaseAsset } from "../types";
import { heuristicMatch, kindFromFilename, selectAsset } from "../platform";

function asset(name: string, size = 1024): GitHubReleaseAsset {
  return {
    id: name.length,
    name,
    browser_download_url: `https://example.com/${name}`,
    size,
    content_type: "application/octet-stream",
    download_count: 0,
  };
}

describe("kindFromFilename", () => {
  it("detects common install kinds", () => {
    expect(kindFromFilename("foo.AppImage")).toBe("appimage");
    expect(kindFromFilename("foo.deb")).toBe("deb");
    expect(kindFromFilename("foo.dmg")).toBe("dmg");
    expect(kindFromFilename("foo.msi")).toBe("msi");
    expect(kindFromFilename("foo.exe")).toBe("exe");
    expect(kindFromFilename("foo.tar.gz")).toBe("tar.gz");
    expect(kindFromFilename("foo.tgz")).toBe("tar.gz");
    expect(kindFromFilename("foo.zip")).toBe("zip");
    expect(kindFromFilename("foo.pkg")).toBe("pkg");
    expect(kindFromFilename("LICENSE")).toBeNull();
  });
});

describe("heuristicMatch", () => {
  const assets = [
    asset("app-1.0.0-linux-x86_64.AppImage"),
    asset("app-1.0.0-linux-x86_64.tar.gz"),
    asset("app-1.0.0-linux-arm64.AppImage"),
    asset("app-1.0.0-darwin-x86_64.dmg"),
    asset("app-1.0.0-darwin-arm64.dmg"),
    asset("app-1.0.0-windows-x86_64.msi"),
    asset("app-1.0.0-windows-x86_64.exe"),
    asset("checksums.txt"),
  ];

  it("picks the AppImage for linux x86_64", () => {
    const pick = heuristicMatch(assets, { platform: "linux", arch: "x86_64" });
    expect(pick?.name).toBe("app-1.0.0-linux-x86_64.AppImage");
  });

  it("picks the arm64 dmg for macos aarch64", () => {
    const pick = heuristicMatch(assets, { platform: "macos", arch: "aarch64" });
    expect(pick?.name).toBe("app-1.0.0-darwin-arm64.dmg");
  });

  it("prefers msi over exe on windows", () => {
    const pick = heuristicMatch(assets, { platform: "windows", arch: "x86_64" });
    expect(pick?.name).toBe("app-1.0.0-windows-x86_64.msi");
  });

  it("returns null when nothing matches the host platform", () => {
    const pick = heuristicMatch([asset("README.md")], { platform: "linux", arch: "x86_64" });
    expect(pick).toBeNull();
  });
});

describe("selectAsset", () => {
  const release = [asset("my-tool-v1-linux-amd64.tar.gz"), asset("my-tool-v1-macos.tar.gz")];

  it("uses explicit patterns when provided", () => {
    const result = selectAsset(
      release,
      [
        {
          platform: "linux",
          arch: "x86_64",
          kind: "tar.gz",
          match: "linux-amd64\\.tar\\.gz$",
        },
      ],
      { platform: "linux", arch: "x86_64" },
    );
    expect(result?.asset.name).toBe("my-tool-v1-linux-amd64.tar.gz");
    expect(result?.kind).toBe("tar.gz");
  });

  it("falls back to heuristics when no patterns match", () => {
    const result = selectAsset(release, [], { platform: "macos", arch: "x86_64" });
    expect(result?.asset.name).toBe("my-tool-v1-macos.tar.gz");
  });
});
