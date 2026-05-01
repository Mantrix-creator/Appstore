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

## Signature verification

Projects that already ship [cosign](https://github.com/sigstore/cosign)
blob signatures can opt into signature verification. The client will
download the signature and public key during install and fail loudly if
they don't match.

```json
{
  "platform": "linux",
  "arch": "x86_64",
  "kind": "tar.gz",
  "match": "mytool-.*-linux-x86_64\\.tar\\.gz$",
  "signature": {
    "method": "cosign-blob",
    "public_key_url": "https://example.com/cosign.pub",
    "signature_match": "mytool-.*-linux-x86_64\\.tar\\.gz\\.sig$"
  }
}
```

Generate the signature and key once with cosign:

```sh
cosign generate-key-pair
cosign sign-blob --key cosign.key mytool-1.0.0-linux-x86_64.tar.gz \
  > mytool-1.0.0-linux-x86_64.tar.gz.sig
```

Upload the `.sig` file alongside your release artifacts and publish
`cosign.pub` anywhere reachable over HTTPS. The client:

1. Downloads the artifact and verifies its SHA-256 (if `checksum_match`
   is set).
2. Downloads the signature and public key.
3. Verifies the ECDSA P-256 signature over the artifact bytes.
4. Aborts the install on any mismatch.

Either `signature_match` (regex against release asset names) or
`signature_url` (explicit HTTPS URL) must be set — use whichever fits
your publishing workflow.

Keyless (Fulcio + Rekor) verification is a planned follow-up and will be
expressed as a distinct `method` value.

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
