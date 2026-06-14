// An .mxl file is a ZIP container holding a MusicXML score plus a
// META-INF/container.xml that names the root score file. We read the ZIP
// central directory to locate entries — it always carries the real compressed
// sizes, which avoids the data-descriptor ambiguity of scanning local headers —
// then inflate the root score.

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;

const COMPRESSION_STORED = 0;
const COMPRESSION_DEFLATE = 8;

interface ZipEntry {
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

// All offsets below are relative to the start of `view` (which begins at the
// start of the ZIP archive), matching the offsets ZIP records store.
function readCentralDirectory(view: DataView): Map<string, ZipEntry> {
  const length = view.byteLength;
  // The end-of-central-directory record is 22 bytes plus an optional comment of
  // up to 65535 bytes, so scan backwards for its signature.
  const earliest = Math.max(0, length - 22 - 0xffff);
  let eocd = -1;
  for (let i = length - 22; i >= earliest; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) {
    throw new Error("Not a valid .mxl file (no ZIP end-of-central-directory)");
  }

  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  const entries = new Map<string, ZipEntry>();
  const decoder = new TextDecoder();
  for (let n = 0; n < entryCount; n++) {
    if (view.getUint32(offset, true) !== CENTRAL_DIRECTORY_SIGNATURE) {
      break;
    }
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameBytes = new Uint8Array(
      view.buffer,
      view.byteOffset + offset + 46,
      nameLength,
    );
    entries.set(decoder.decode(nameBytes), {
      method,
      compressedSize,
      localHeaderOffset,
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflateRaw(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new DecompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  void writer.write(bytes);
  void writer.close();
  const buffer = await new Response(stream.readable).arrayBuffer();
  return new Uint8Array(buffer);
}

async function readEntry(
  bytes: Uint8Array<ArrayBuffer>,
  view: DataView,
  entry: ZipEntry,
): Promise<Uint8Array> {
  const offset = entry.localHeaderOffset;
  if (view.getUint32(offset, true) !== LOCAL_HEADER_SIGNATURE) {
    throw new Error("Corrupt .mxl file (bad local file header)");
  }
  // The local header repeats the name/extra lengths; the data follows them.
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const dataStart = offset + 30 + nameLength + extraLength;
  const data = bytes.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === COMPRESSION_STORED) {
    return data;
  }
  if (entry.method === COMPRESSION_DEFLATE) {
    return inflateRaw(data);
  }
  throw new Error(`Unsupported .mxl compression method ${entry.method}`);
}

export async function extractMusicXmlFromMxl(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = readCentralDirectory(view);
  const decoder = new TextDecoder();

  // Prefer the root score named in META-INF/container.xml.
  let scorePath: string | undefined;
  const container = entries.get("META-INF/container.xml");
  if (container) {
    const containerXml = decoder.decode(
      await readEntry(bytes, view, container),
    );
    scorePath = containerXml.match(/full-path="([^"]+)"/)?.[1];
  }
  // Fall back to the first non-META-INF score entry.
  if (!scorePath || !entries.has(scorePath)) {
    scorePath = [...entries.keys()].find(
      (name) =>
        !name.startsWith("META-INF/") && /\.(musicxml|xml)$/i.test(name),
    );
  }
  if (!scorePath) {
    throw new Error("No MusicXML score found inside .mxl file");
  }
  const entry = entries.get(scorePath);
  if (!entry) {
    throw new Error(
      `.mxl root file "${scorePath}" is missing from the archive`,
    );
  }
  return decoder.decode(await readEntry(bytes, view, entry));
}
