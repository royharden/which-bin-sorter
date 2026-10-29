import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { prepareImage } from "../src/intake/reencode.ts";
import type { ImageEncoder, PreparedImage } from "../src/intake/reencode.ts";
import { sniffImage } from "../src/intake/sniff.ts";
import { groupSplit } from "../src/evalkit/split.ts";
import type { GoldRow } from "../src/evalkit/types.ts";
import type { RulesFile } from "../src/core/rules.ts";
import { parseManifest } from "./eval/manifest.ts";
import { preparedJpegDimensions } from "./eval/jpeg.ts";

/** Activation supplies an audited pure-JS MIT decoder/encoder. No package was selected or installed. */
export interface PhotoAdapter extends ImageEncoder { package_name: string; licence: "MIT"; licence_source: string; implementation: "pure-js" }
export async function normalizeGoldPhoto(bytes: Uint8Array, adapter: PhotoAdapter): Promise<PreparedImage> {
  if (adapter.licence !== "MIT" || adapter.implementation !== "pure-js" || !adapter.package_name || !/^https:\/\//.test(adapter.licence_source)) throw new Error("audited pure-JS MIT adapter required");
  const mime = sniffImage(bytes);
  if (mime === null) throw new Error("JPEG/PNG/WebP source required");
  const result = await prepareImage(new Blob([new Uint8Array(bytes)], { type: mime }), adapter);
  const size = preparedJpegDimensions(result.bytes);
  if (size.width !== result.width || size.height !== result.height) throw new Error("encoder dimensions differ from JPEG header");
  return result;
}
export async function main(args: readonly string[]): Promise<number> {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!key || !["--input", "--adapter", "--out", "--manifest", "--seed", "--rules"].includes(key) || !value || values.has(key)) throw new Error("prep-photos requires named option/value pairs");
    values.set(key, value);
  }
  const source = values.get("--input"), adapterPath = values.get("--adapter"), seed = values.get("--seed");
  if (!source || !adapterPath || !seed) throw new Error("usage: prep-photos --input gold-input.jsonl --adapter audited-adapter.ts --seed fixed-seed [--out eval/photos --manifest eval/manifest.jsonl --rules rules/fixture-city.json]");
  const manifest = values.get("--manifest") ?? "eval/manifest.jsonl", output = values.get("--out") ?? "eval/photos";
  const photoRoot = path.resolve("eval/photos"), outputRoot = path.resolve(output);
  if (outputRoot !== photoRoot && !outputRoot.startsWith(photoRoot + path.sep)) throw new Error("--out must remain inside eval/photos (the evaluation photo root)");
  if (existsSync(manifest) || existsSync("results/heldout.lock")) throw new Error("refuse overwrite or preparation after heldout lock");
  const input = readFileSync(source, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l) as GoldRow & { source_file: string });
  if (input.some((r) => r.licence === "fixture" || !r.source_file || !r.item_group || !/^[a-zA-Z0-9_-]+$/.test(r.photo_id))) throw new Error("real licensed source photos, safe ids and item groups required");
  if (new Set(input.map((r) => r.photo_id)).size !== input.length) throw new Error("duplicate photo id");
  for (const r of input) if (existsSync(path.join(output, `${r.photo_id}.jpg`))) throw new Error("refuse photo overwrite");
  const loaded: unknown = await import(pathToFileURL(path.resolve(adapterPath)).href);
  const adapter = (loaded as { adapter?: PhotoAdapter }).adapter;
  if (!adapter) throw new Error("adapter module must export adapter: PhotoAdapter");
  const split = groupSplit(input, (r) => r.item_group, seed);
  const devIds = new Set(split.dev.map((r) => r.photo_id));
  const rules = JSON.parse(readFileSync(values.get("--rules") ?? "rules/fixture-city.json", "utf8")) as RulesFile;
  // Validate all gold annotations before decoding or writing any image.
  const relativeFile = (id: string): string => path.relative(photoRoot, path.join(outputRoot, `${id}.jpg`)).split(path.sep).join("/");
  const preview = input.map(({ source_file, ...r }) => { void source_file; return { ...r, file: relativeFile(r.photo_id), sha256: "0".repeat(64), split: devIds.has(r.photo_id) ? "dev" : "heldout" }; });
  parseManifest(preview.map((r) => JSON.stringify(r)).join("\n"), rules);
  mkdirSync(output, { recursive: true });
  const rows: GoldRow[] = [];
  for (const original of input) {
    const normalized = await normalizeGoldPhoto(readFileSync(original.source_file), adapter);
    const { source_file, ...gold } = original;
    void source_file;
    const row: GoldRow = { ...gold, file: relativeFile(gold.photo_id), sha256: normalized.upload_sha256, split: devIds.has(gold.photo_id) ? "dev" : "heldout" };
    writeFileSync(path.join(outputRoot, `${gold.photo_id}.jpg`), normalized.bytes, { flag: "wx" });
    rows.push(row);
  }
  const content = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  parseManifest(content, rules);
  mkdirSync(path.dirname(manifest), { recursive: true });
  writeFileSync(manifest, content, { flag: "wx" });
  writeFileSync(`${manifest}.prep.json`, JSON.stringify({ seed, counts: split.counts, package: adapter.package_name, licence: adapter.licence, licence_source: adapter.licence_source, preprocessing: "jpeg-1024-v1" }, null, 2) + "\n", { flag: "wx" });
  return 0;
}
const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(path.resolve(invoked)).href) main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e: unknown) => { console.error(e instanceof Error ? e.message : "prep failed"); process.exitCode = 2; });
