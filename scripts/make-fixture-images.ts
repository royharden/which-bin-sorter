// SOURCE ONLY during construction. Later: npx tsx scripts/make-fixture-images.ts
// Produces synthetic labelled PNG cards using only Node built-ins, never photographs or paid calls.
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { DEMO_TILES } from "../src/demo/tiles.ts";
import type { DemoTile } from "../src/demo/tiles.ts";

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(kind: string, payload: Uint8Array): Buffer {
  const name = Buffer.from(kind, "ascii");
  const body = Buffer.concat([name, payload]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

// Tiny bitmap font keeps fixture generation dependency-free. Tile labels use their ASCII fixture ids.
const FONT: Readonly<Record<string, string>> = {
  a:"010101111101101",b:"110101110101110",c:"011100100100011",d:"110101101101110",e:"111100110100111",f:"111100110100100",
  g:"011100101101011",h:"101101111101101",i:"111010010010111",j:"001001001101010",k:"101101110101101",l:"100100100100111",
  m:"101111111101101",n:"101111111111101",o:"010101101101010",p:"110101110100100",q:"010101101111011",r:"110101110101101",
  s:"011100010001110",t:"111010010010010",u:"101101101101111",v:"101101101101010",w:"101101111111101",x:"101101010101101",
  y:"101101010010010",z:"111001010100111",_:"000000000000111",0:"111101101101111",1:"010110010010111",2:"110001010100111",
  3:"110001010001110",4:"101101111001001",5:"111100110001110",6:"011100111101111",7:"111001010010010",8:"111101111101111",9:"111101111001110",
};

export function fixturePng(tile: DemoTile): Buffer {
  const width = 640;
  const height = 480;
  const raw = Buffer.alloc(height * (1 + width * 3));
  const background = [1, 3, 5].map((offset) => Number.parseInt(tile.color.slice(offset, offset + 2), 16));
  function pixel(x: number, y: number, rgb: readonly number[]): void {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const offset = y * (1 + width * 3) + 1 + x * 3;
    raw[offset] = rgb[0] ?? 0; raw[offset + 1] = rgb[1] ?? 0; raw[offset + 2] = rgb[2] ?? 0;
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixel(x, y, background);
  // Decorative item silhouette; deliberately a synthetic card, never offered as vision evidence.
  for (let y = 85; y < 245; y++) for (let x = 225; x < 415; x++) {
    if (x < 235 || x > 405 || y < 95 || y > 235 || (x > 305 && x < 315)) pixel(x, y, [45, 76, 58]);
  }
  function text(label: string, top: number, scale: number): void {
    const left = Math.round((width - label.length * 4 * scale) / 2);
    [...label].forEach((char, index) => {
      const bitmap = FONT[char];
      if (bitmap === undefined) return;
      [...bitmap].forEach((dot, position) => {
        if (dot !== "1") return;
        for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
          pixel(left + index * 4 * scale + (position % 3) * scale + x, top + Math.floor(position / 3) * scale + y, [36, 62, 50]);
        }
      });
    });
  }
  text(tile.fixture_id, 300, Math.min(5, Math.floor(600 / (tile.fixture_id.length * 4))));
  text("authored_demo_not_a_photo", 405, 3);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header),
    chunk("tEXt", Buffer.from(`Description\0Authored synthetic tile: ${tile.label}`, "latin1")),
    chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())]);
}

async function main(): Promise<void> {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const output = path.join(root, "eval", "fixtures", "images");
  await mkdir(output, { recursive: true });
  const manifest = [];
  for (const tile of DEMO_TILES) {
    const png = fixturePng(tile);
    // Exclusive creation preserves existing artifacts; use a fresh output set for regeneration.
    await writeFile(path.join(output, `${tile.fixture_id}.png`), png, { flag: "wx" });
    manifest.push({ fixture_id: tile.fixture_id, file: `images/${tile.fixture_id}.png`, source_sha256: createHash("sha256").update(png).digest("hex") });
  }
  await writeFile(path.join(output, "source-hashes.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  console.log(`Wrote ${manifest.length} authored PNG cards. Review source-hashes.json and fill mock response aliases; no model was called.`);
}
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Fixture generation failed"); process.exitCode = 1; });
}
