#!/usr/bin/env node
/**
 * Validates every registry manifest in registry/apps/*.json against
 * registry/schema.json, and cross-checks that every slug listed in
 * registry/index.json has a corresponding manifest.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const schema = JSON.parse(readFileSync(resolve(root, "registry/schema.json"), "utf8"));
const index = JSON.parse(readFileSync(resolve(root, "registry/index.json"), "utf8"));
const appsDir = resolve(root, "registry/apps");

const ajv = new Ajv.default({ allErrors: true, strict: false });
addFormats.default(ajv);
const validate = ajv.compile(schema);

let failed = 0;

const fileSlugs = readdirSync(appsDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));

for (const file of readdirSync(appsDir).filter((f) => f.endsWith(".json"))) {
  const path = resolve(appsDir, file);
  const data = JSON.parse(readFileSync(path, "utf8"));
  const ok = validate(data);
  if (!ok) {
    failed += 1;
    console.error(`✗ ${file}`);
    for (const err of validate.errors ?? []) {
      console.error(`  ${err.instancePath} ${err.message}`);
    }
    continue;
  }
  const expectedSlug = file.replace(/\.json$/, "");
  if (data.slug !== expectedSlug) {
    failed += 1;
    console.error(`✗ ${file}: slug "${data.slug}" does not match filename "${expectedSlug}"`);
    continue;
  }
  console.log(`✓ ${file}`);
}

const missing = index.apps.filter((slug) => !fileSlugs.includes(slug));
if (missing.length > 0) {
  failed += 1;
  console.error(`\nindex.json lists slugs with no matching manifest: ${missing.join(", ")}`);
}

const unlisted = fileSlugs.filter((slug) => !index.apps.includes(slug));
if (unlisted.length > 0) {
  failed += 1;
  console.error(`\nmanifests not present in index.json: ${unlisted.join(", ")}`);
}

if (failed > 0) {
  console.error(`\nValidation failed (${failed} issue(s)).`);
  process.exit(1);
}
console.log(`\nAll ${fileSlugs.length} registry manifests valid.`);
