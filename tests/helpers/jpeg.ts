// Synthetic JPEG byte streams for header-parser and handler tests. Marker structure only: the entropy-coded data is
// filler, never decodable pixels (the server never decodes pixels; it only walks markers).

export interface JpegSpec {
  width?: number;
  height?: number;
  /** SOF marker code: 0xc0 baseline (default), 0xc2 progressive, 0xc1 / 0xc3 / ... unsupported. */
  frame?: number;
  components?: number;
  precision?: number;
  /** Extra segments inserted after APP0, as [marker, payload]. */
  segments?: Array<[number, number[]]>;
  /** Put a second SOF before the scan. */
  secondFrame?: boolean;
  /** Put the SOS before the SOF. */
  scanBeforeFrame?: boolean;
  /** Omit the SOF entirely. */
  noFrame?: boolean;
  /** Entropy-coded filler; default includes a stuffed 0xFF00 and an RST marker. */
  scanData?: Uint8Array;
  /** Bytes appended after EOI. */
  trailing?: number[];
  omitEoi?: boolean;
}

function segment(marker: number, payload: readonly number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
}

function sofSegment(frame: number, width: number, height: number, components: number, precision: number): number[] {
  const payload = [precision, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, components];
  for (let id = 1; id <= components; id++) payload.push(id, 0x11, 0x00);
  return segment(frame, payload);
}

function sosSegment(components: number): number[] {
  const payload = [components];
  for (let id = 1; id <= components; id++) payload.push(id, 0x00);
  payload.push(0x00, 0x3f, 0x00);
  return segment(0xda, payload);
}

const APP0_JFIF = [0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
const DEFAULT_SCAN = Uint8Array.from([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78, 0x9a]);

export function buildJpeg(spec: JpegSpec = {}): Uint8Array {
  const width = spec.width ?? 640;
  const height = spec.height ?? 480;
  const frame = spec.frame ?? 0xc0;
  const components = spec.components ?? 3;
  const precision = spec.precision ?? 8;
  const head: number[] = [0xff, 0xd8, ...segment(0xe0, APP0_JFIF)];
  for (const [marker, payload] of spec.segments ?? []) head.push(...segment(marker, payload));
  const sof = sofSegment(frame, width, height, components, precision);
  const sos = sosSegment(components);
  if (spec.scanBeforeFrame) head.push(...sos);
  if (!spec.noFrame) head.push(...sof);
  if (spec.secondFrame) head.push(...sof);
  if (!spec.scanBeforeFrame) head.push(...sos);
  const scan = spec.scanData ?? DEFAULT_SCAN;
  const tail: number[] = spec.omitEoi ? [] : [0xff, 0xd9];
  tail.push(...(spec.trailing ?? []));
  const out = new Uint8Array(head.length + scan.length + tail.length);
  out.set(head, 0);
  out.set(scan, head.length);
  out.set(tail, head.length + scan.length);
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/** A valid baseline JPEG whose decoded size is exactly `size` bytes (filler scan data, no 0xFF bytes). */
export function jpegOfSize(size: number, width = 640, height = 480): Uint8Array {
  const base = buildJpeg({ width, height, scanData: new Uint8Array(0) });
  const fillerLength = size - base.length;
  if (fillerLength < 0) throw new Error("size too small for a JPEG skeleton");
  return buildJpeg({ width, height, scanData: new Uint8Array(fillerLength).fill(0x11) });
}

export const PNG_MAGIC = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
