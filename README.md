# AppStore

A **decentralized, GitHub-native application store**.

AppStore is a cross-platform desktop client (Tauri + React) that browses,
searches, and installs open-source apps directly from **GitHub Releases**.
There is no backend server: the curated app registry lives in this
repository under [`registry/apps/`](./registry/apps), served via
`raw.githubusercontent.com`, and every install is a verified download
straight from the upstream project's own release assets.

## Highlights

- **No backend.** The "database" is a folder of JSON manifests in this
  repo. Every change is a Git commit; history and attribution come for
  free.
- **Native installs.** Release assets are downloaded, SHA-256 verified,
  extracted, and wired into `PATH` via a shared `bin/` directory managed
  by the client.
- **Cross-platform.** Built on [Tauri 2](https://tauri.app/) — ships on
  Linux, macOS, and Windows with a <10 MB installer.
- **Quota-aware.** Anonymous GitHub API access is limited to 60 req/hr.
  Add a personal access token under Settings to raise that to 5,000/hr.
- **Transparent.** The UI links every asset and release to its upstream
  GitHub page so there is no question about what's being downloaded.

## Architecture

```
┌──────────────────────┐                  ┌──────────────────────────┐
│  AppStore Desktop    │  HTTPS (direct)  │   api.github.com         │
│  (Tauri + React)     ├─────────────────►│   raw.githubusercontent  │
│  ─ browse/search UI  │                  │   github.com/releases    │
│  ─ install engine    │                  └──────────────────────────┘
│  ─ installed index   │
└──────────┬───────────┘
           │ reads
           ▼
┌──────────────────────────┐
│ registry/apps/*.json     │  ←  curated, PR-reviewed manifests
│ registry/index.json      │
└──────────────────────────┘
```

### Data flow (`install <slug>`)

1. UI resolves the manifest (bundled copy + live overlay from GitHub).
2. Rust backend calls `GET /repos/{owner}/{repo}/releases/latest`.
3. Asset matcher picks a release asset for the current OS + arch — using
   explicit patterns from the manifest or a keyword-based heuristic
   fallback.
4. Backend streams the download, computing SHA-256 on-the-fly and
   emitting progress events to the UI.
5. Download is extracted (`.tar.gz`, `.zip`), moved into
   `{data_dir}/AppStore/apps/<slug>/<version>/`, and the primary binary
   is symlinked into `{data_dir}/AppStore/bin/`.
6. An `InstalledAppRecord` is persisted to `installed.json`.

### Repository layout

```
.
├── src/                 React + TS renderer
│   ├── lib/             GitHub client, registry loader, platform picker
│   ├── components/      UI building blocks (AppCard, InstallButton, Layout)
│   ├── pages/           Browse / Search / AppDetail / Installed / Settings
│   └── state/           React context — installed apps, progress, token
├── src-tauri/           Rust backend
│   ├── src/installer.rs Download → verify → extract → link
│   ├── src/storage.rs   Filesystem layout (apps/, bin/, cache/)
│   └── tauri.conf.json  Window, CSP, bundle config
├── registry/            The "database" — curated app manifests
│   ├── apps/*.json
│   ├── index.json
│   └── schema.json
├── scripts/             Maintenance scripts (registry validation)
└── .github/workflows/   CI and release pipelines
```

## Development

### Prerequisites

- Node.js 20+
- Rust (latest stable — 1.85+ recommended)
- On Linux: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`,
  `libayatana-appindicator3-dev`, `librsvg2-dev`, `patchelf`, `libxdo-dev`
- On macOS: Xcode command-line tools
- On Windows: Microsoft Visual C++ Build Tools + WebView2 runtime

See [Tauri's prerequisites guide](https://tauri.app/start/prerequisites/)
for the full per-platform setup.

### Setup

```bash
npm install
```

### Running the desktop app

```bash
npm run tauri:dev
```

### Running just the frontend (browser preview)

```bash
npm run dev
# open http://localhost:1420
```

Installation/uninstallation is disabled in browser preview — the app
falls back to opening the upstream release page in a new tab.

### Building a production bundle

```bash
npm run tauri:build
```

Artifacts are written to
`src-tauri/target/release/bundle/{appimage,deb,dmg,msi,nsis}/`.

### Testing & linting

```bash
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm test             # Vitest (asset matcher tests)

cd src-tauri
cargo fmt -- --check
cargo clippy --release -- -D warnings
cargo test --release --lib
```

## Adding an app to the registry

1. Fork this repo.
2. Add a manifest at `registry/apps/<slug>.json`. See
   [`registry/README.md`](./registry/README.md) and
   [`registry/schema.json`](./registry/schema.json).
3. Add the slug to `registry/index.json`.
4. Open a pull request — CI validates the manifest against the schema.

Minimal example:

```json
{
  "slug": "my-tool",
  "repo": "owner/my-tool",
  "category": "developer-tools"
}
```

Extensive example with explicit asset matching:

```json
{
  "slug": "my-tool",
  "repo": "owner/my-tool",
  "name": "My Tool",
  "tagline": "Does one thing, does it well.",
  "category": "developer-tools",
  "tags": ["cli", "rust"],
  "verified": true,
  "assets": [
    {
      "platform": "linux",
      "arch": "x86_64",
      "kind": "tar.gz",
      "match": "my-tool-.*-linux-x86_64\\.tar\\.gz$",
      "binary_name": "my-tool"
    }
  ]
}
```

## Security model

- **Transport:** all traffic uses HTTPS to `api.github.com`,
  `github.com`, and `*.githubusercontent.com`. The Tauri CSP is pinned
  to these origins.
- **Integrity:** every download is SHA-256 hashed. If the manifest
  supplies `expected_sha256`, a mismatch aborts the install and deletes
  the partial download.
- **Privilege:** the desktop client never asks for root. Installs go
  under the per-user data directory (`$XDG_DATA_HOME/AppStore` on
  Linux, `~/Library/Application Support/AppStore` on macOS,
  `%APPDATA%\AppStore` on Windows). Adding the managed `bin/` directory
  to `PATH` is a one-time user action.
- **Provenance:** every app listing links to the upstream release and
  raw asset URL so users can audit exactly what will be downloaded.

## Roadmap

- [ ] Cosign / Sigstore signature verification for signed releases.
- [ ] Auto-update (detect new releases in the background).
- [ ] Manifest-provided `preinstall` / `postinstall` hooks (sandboxed).
- [ ] Fork-as-database pattern for user-submitted reviews/stars.
- [ ] Web companion (static site serving the same registry).

## License

MIT — see [LICENSE](./LICENSE).
