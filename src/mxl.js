/**
 * Minimal reader for .mxl — the zipped MusicXML that MuseScore and Finale
 * export by default. Entries are located through the central directory rather
 * than by scanning for local headers, because an entry written with a data
 * descriptor carries zeroed sizes in its local header.
 *
 * Only reading is supported. Transposed scores are handed back as plain
 * .musicxml, which every notation program opens.
 */

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;

function findEndOfCentralDirectory(view) {
  const max = Math.min(view.byteLength, 0xffff + 22);
  for (let i = 22; i <= max; i += 1) {
    const pos = view.byteLength - i;
    if (view.getUint32(pos, true) === EOCD_SIG) return pos;
  }
  return -1;
}

function decodeName(bytes) {
  return new TextDecoder('utf-8').decode(bytes);
}

export function listZipEntries(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  if (eocd === -1) throw new Error('This does not look like a .mxl file (no ZIP directory found).');

  const count = view.getUint16(eocd + 10, true);
  let pos = view.getUint32(eocd + 16, true);
  const entries = [];

  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(pos, true) !== CD_SIG) break;
    const method = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const nameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    const name = decodeName(bytes.subarray(pos + 46, pos + 46 + nameLength));

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;

    entries.push({ name, method, data: bytes.subarray(dataStart, dataStart + compressedSize) });
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflate(entry) {
  if (entry.method === 0) return entry.data;
  if (entry.method !== 8) throw new Error(`Unsupported compression in .mxl (method ${entry.method}).`);
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot unzip .mxl files. Export as uncompressed .musicxml instead.');
  }
  const stream = new Blob([entry.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Pull the score XML out of an .mxl container. */
export async function readMxl(buffer) {
  const entries = listZipEntries(buffer);
  const container = entries.find((e) => e.name === 'META-INF/container.xml');

  let target = null;
  if (container) {
    const xml = new TextDecoder('utf-8').decode(await inflate(container));
    const m = /<rootfile\b[^>]*full-path\s*=\s*"([^"]+)"/.exec(xml);
    if (m) target = entries.find((e) => e.name === m[1]);
  }
  // Fall back to the first score-looking entry if the container is missing.
  if (!target) {
    target = entries.find((e) => !e.name.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(e.name));
  }
  if (!target) throw new Error('No score found inside this .mxl file.');

  return new TextDecoder('utf-8').decode(await inflate(target));
}
