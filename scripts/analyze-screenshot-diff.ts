// TEMPORARY diagnostic tool for the CI screenshot flake investigation.
// Decodes playwright's -expected/-actual pairs and prints a compact textual
// description of the difference (over-threshold count, bounding box, an ASCII
// heat map, and sample pixel values) so a failure can be understood from CI
// logs alone.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

function decodePng(path: string): {
  width: number;
  height: number;
  data: Uint8Array;
} {
  const buf = readFileSync(path);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    if (type === "IHDR") {
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      bitDepth = buf[dataStart + 8];
      colorType = buf[dataStart + 9];
    } else if (type === "IDAT") {
      idat.push(buf.subarray(dataStart, dataStart + length));
    } else if (type === "IEND") {
      break;
    }
    offset = dataStart + length + 4;
  }
  if (bitDepth !== 8) {
    throw new Error(`unsupported bit depth ${bitDepth}`);
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (channels === 0) {
    throw new Error(`unsupported color type ${colorType}`);
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const line = new Uint8Array(stride);
  const previous = new Uint8Array(stride);
  let position = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[position++];
    for (let i = 0; i < stride; i++) {
      const rawByte = raw[position + i];
      const left = i >= channels ? line[i - channels] : 0;
      const up = previous[i];
      const upLeft = i >= channels ? previous[i - channels] : 0;
      let value: number;
      switch (filter) {
        case 0:
          value = rawByte;
          break;
        case 1:
          value = rawByte + left;
          break;
        case 2:
          value = rawByte + up;
          break;
        case 3:
          value = rawByte + ((left + up) >> 1);
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          value =
            rawByte + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
          break;
        }
        default:
          throw new Error(`unsupported filter ${filter}`);
      }
      line[i] = value & 0xff;
    }
    position += stride;
    for (let x = 0; x < width; x++) {
      const source = x * channels;
      const target = (y * width + x) * 4;
      out[target] = line[source];
      out[target + 1] = line[source + 1];
      out[target + 2] = line[source + 2];
      out[target + 3] = channels === 4 ? line[source + 3] : 255;
    }
    previous.set(line);
  }
  return { width, height, data: out };
}

function delta(a: Uint8Array, b: Uint8Array, i: number): number {
  const dr = a[i] - b[i];
  const dg = a[i + 1] - b[i + 1];
  const db = a[i + 2] - b[i + 2];
  const y = 0.29889531 * dr + 0.58662247 * dg + 0.11448223 * db;
  const iq = 0.59597799 * dr - 0.2741761 * dg - 0.32180189 * db;
  const q = 0.21147017 * dr - 0.52261711 * dg + 0.31114694 * db;
  return 0.5053 * y * y + 0.299 * iq * iq + 0.1957 * q * q;
}

function walk(directory: string, out: string[]): void {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      walk(path, out);
    } else if (entry.endsWith("-expected.png")) {
      out.push(path);
    }
  }
}

const root = process.argv[2];
const expectedFiles: string[] = [];
walk(root, expectedFiles);
const summary: string[] = [];

for (const expectedPath of expectedFiles) {
  const actualPath = expectedPath.replace(/-expected\.png$/, "-actual.png");
  console.log(`\n########## ${expectedPath} ##########`);
  let expected: ReturnType<typeof decodePng>;
  let actual: ReturnType<typeof decodePng>;
  try {
    expected = decodePng(expectedPath);
    actual = decodePng(actualPath);
  } catch (error) {
    console.log(`could not decode: ${error}`);
    continue;
  }
  if (expected.width !== actual.width || expected.height !== actual.height) {
    console.log("size mismatch");
    continue;
  }
  const threshold = 35215 * 0.2 * 0.2;
  const cell = 8;
  const cols = Math.ceil(expected.width / cell);
  const rows = Math.ceil(expected.height / cell);
  const heat = new Int32Array(cols * rows);
  let over = 0;
  let any = 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = -1;
  let maxY = -1;
  const samples: string[] = [];
  for (let y = 0; y < expected.height; y++) {
    for (let x = 0; x < expected.width; x++) {
      const i = (y * expected.width + x) * 4;
      if (
        expected.data[i] !== actual.data[i] ||
        expected.data[i + 1] !== actual.data[i + 1] ||
        expected.data[i + 2] !== actual.data[i + 2]
      ) {
        any++;
      }
      if (delta(expected.data, actual.data, i) > threshold) {
        over++;
        heat[Math.floor(y / cell) * cols + Math.floor(x / cell)]++;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        if (samples.length < 25 && over % 13 === 1) {
          samples.push(
            `(${x},${y}) expected rgb(${expected.data[i]},${expected.data[i + 1]},${expected.data[i + 2]}) actual rgb(${actual.data[i]},${actual.data[i + 1]},${actual.data[i + 2]})`,
          );
        }
      }
    }
  }
  console.log(
    `size ${expected.width}x${expected.height}; ${any} pixels differ at all; ${over} exceed threshold`,
  );
  summary.push(
    `${expectedPath.split("/").pop()}: ${over} over threshold, box x ${minX}..${maxX} y ${minY}..${maxY}`,
  );
  if (over === 0) {
    continue;
  }
  console.log(`bounding box: x ${minX}..${maxX}, y ${minY}..${maxY}`);
  console.log(`samples:\n  ${samples.join("\n  ")}`);
  console.log(`heat map (each cell ${cell}x${cell}px, . = 0):`);
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < cols; c++) {
      const n = heat[r * cols + c];
      line += n === 0 ? "." : n < 10 ? String(n) : n < 36 ? "#" : "@";
    }
    if (line.replace(/\./g, "").length > 0) {
      console.log(`y=${String(r * cell).padStart(3)} ${line}`);
    }
  }
}

console.log("\n########## SUMMARY ##########");
for (const line of summary) {
  console.log(line);
}
