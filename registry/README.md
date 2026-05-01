# AppStore Registry

This directory is the "database" of the AppStore client.

Every JSON file under `apps/` is a manifest describing one application that the
store knows about. The client reads these files directly from
`raw.githubusercontent.com` — there is no backend server.

## Adding an app

1. Fork this repository.
2. Create `apps/<slug>.json` following [`schema.json`](./schema.json).
3. Add the slug to [`index.json`](./index.json).
4. Open a pull request.

CI will validate the manifest against the schema before merge. Once merged,
the app appears in the store for all users on their next refresh.

## Required fields

- `slug` — URL-safe identifier (lowercase, digits, hyphens).
- `repo` — `owner/name` of the GitHub repo that publishes releases.

## Optional fields

Everything else (name, description, icon, license, category, etc.) is
inferred from the GitHub repo metadata at runtime. Override any field in
the manifest when you want the store listing to differ from the repo
itself.

## Asset patterns

By default the client picks a release asset using a heuristic matcher
(platform + architecture keywords + extension). Projects with unusual
naming can specify explicit patterns:

```json
{
  "assets": [
    {
      "platform": "linux",
      "arch": "x86_64",
      "kind": "appimage",
      "match": "-linux-x86_64\\.AppImage$",
      "checksum_match": "SHA256SUMS$",
      "binary_name": "my-tool"
    }
  ]
}
```

`match` and `checksum_match` are JavaScript regular expressions (case
insensitive) applied to asset filenames.

## Categories

Use one of these category slugs for consistent grouping:

- `developer-tools`
- `productivity`
- `media`
- `communication`
- `games`
- `utilities`
- `security`
- `education`
- `graphics`
- `uncategorized`
