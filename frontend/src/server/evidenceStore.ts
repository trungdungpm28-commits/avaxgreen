import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {inflateSync} from 'node:zlib';

export interface ExifGpsCoords {
  latitude: number;
  longitude: number;
}

export interface EvidenceRecord {
  proofHash: string;
  imageHash: string;
  perceptualHash: string;
  imageCid: string;
  evidenceCid: string;
  mimeType: string;
  imageFileName: string | null;
  sourceMode: 'rooftop-pv' | 'electricity-bill' | 'iot-telemetry';
  projectId: string;
  billingPeriod: string;
  meterSerial: string;
  userAddress: string | null;
  latitude: number;
  longitude: number;
  exifGps: ExifGpsCoords | null;
  exifDistanceKm: number | null;
  exifGpsMatch: 'matched' | 'mismatch' | 'unavailable';
  aiMode: string;
  solarMode: string;
  detected: boolean;
  confidence: number | null;
  fraudScore: number | null;
  trustScore: number | null;
  fraudFlags: string[];
  summary: string;
  capacityKw: number;
  irradiance: number;
  kwh: number;
  actualKwh: number | null;
  co2Kg: number;
  amountWei: string;
  deadline: number;
  signed: boolean;
  isSample: boolean;
  createdAt: number;
}

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

function encodeBase32Lower(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

/** Compute an IPFS CIDv1 (raw codec 0x55, sha2-256 multihash 0x12 0x20) formatted as bafkrei... */
export function computeIpfsCidV1(data: Buffer | Uint8Array | string): string {
  const digest = createHash('sha256').update(data).digest();
  const cidBytes = Buffer.concat([Buffer.from([0x01, 0x55, 0x12, 0x20]), digest]);
  return `b${encodeBase32Lower(cidBytes)}`;
}

/**
 * Compute a metadata-invariant 64-bit perceptual difference hash (dHash).
 * For PNG, decompresses IDAT scanlines via zlib and samples 9x8 brightness buckets.
 * For JPEG/WEBP, strips header/EXIF segments and samples 65 normalized entropy buckets.
 */
export function computePerceptualHash(bytes: Buffer, mimeType: string): string {
  const samples = new Float64Array(65);

  if (mimeType === 'image/png' && bytes.length > 32) {
    try {
      const idatChunks: Buffer[] = [];
      let pos = 8;
      while (pos + 8 <= bytes.length) {
        const len = bytes.readUInt32BE(pos);
        const type = bytes.toString('ascii', pos + 4, pos + 8);
        const dataStart = pos + 8;
        if (dataStart + len > bytes.length) break;
        if (type === 'IDAT') {
          idatChunks.push(bytes.subarray(dataStart, dataStart + len));
        } else if (type === 'IEND') {
          break;
        }
        pos = dataStart + len + 4;
      }
      if (idatChunks.length > 0) {
        const raw = inflateSync(Buffer.concat(idatChunks));
        const step = Math.max(1, Math.floor(raw.length / 65));
        for (let i = 0; i < 65; i++) {
          const start = Math.min(raw.length - 1, i * step);
          const end = Math.min(raw.length, start + step);
          let sum = 0;
          for (let j = start; j < end; j++) sum += raw[j];
          samples[i] = sum / Math.max(1, end - start);
        }
        return hashBucketsToHex(samples);
      }
    } catch {
      // Fallback to raw stream sampling below
    }
  }

  let payloadStart = 0;
  let payloadEnd = bytes.length;

  if (mimeType === 'image/jpeg' && bytes.length > 16) {
    // Skip JPEG metadata/EXIF markers up to Start Of Scan (0xFFDA)
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = bytes[offset + 1];
      if (marker === 0xda) {
        const segLen = bytes.readUInt16BE(offset + 2);
        payloadStart = Math.min(bytes.length - 1, offset + 2 + segLen);
        break;
      }
      if (marker === 0xd9) break;
      if (marker >= 0xd0 && marker <= 0xd8) {
        offset += 2;
        continue;
      }
      const segLen = bytes.readUInt16BE(offset + 2);
      offset += 2 + segLen;
    }
    if (bytes.length > 2 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9) {
      payloadEnd = bytes.length - 2;
    }
  } else if (mimeType === 'image/webp' && bytes.length > 20) {
    payloadStart = 12;
  }

  const slice = bytes.subarray(payloadStart, Math.max(payloadStart + 1, payloadEnd));
  const step = Math.max(1, Math.floor(slice.length / 65));
  for (let i = 0; i < 65; i++) {
    const start = Math.min(slice.length - 1, i * step);
    const end = Math.min(slice.length, start + step);
    let sum = 0;
    for (let j = start; j < end; j++) sum += slice[j];
    samples[i] = sum / Math.max(1, end - start);
  }
  return hashBucketsToHex(samples);
}

function hashBucketsToHex(samples: Float64Array): string {
  let big = 0n;
  for (let i = 0; i < 64; i++) {
    if (samples[i] > samples[i + 1]) {
      big |= 1n << BigInt(i);
    }
  }
  return big.toString(16).padStart(16, '0');
}

export function hammingDistanceHex(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 64;
  let diff = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (diff > 0n) {
    count += Number(diff & 1n);
    diff >>= 1n;
  }
  return count;
}

/** Extract GPS coordinates from JPEG EXIF APP1 block when present. */
export function extractExifGps(bytes: Buffer, mimeType: string): ExifGpsCoords | null {
  if (mimeType !== 'image/jpeg' || bytes.length < 24) return null;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let pos = 2;
  while (pos + 4 < bytes.length) {
    if (bytes[pos] !== 0xff) break;
    const marker = bytes[pos + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const segLen = bytes.readUInt16BE(pos + 2);
    if (segLen < 2 || pos + 2 + segLen > bytes.length) break;

    if (marker === 0xe1 && bytes.toString('ascii', pos + 4, pos + 10) === 'Exif\0\0') {
      const tiffStart = pos + 10;
      const gps = parseTiffGps(bytes.subarray(tiffStart, pos + 2 + segLen));
      if (gps) return gps;
    }
    pos += 2 + segLen;
  }
  return null;
}

function parseTiffGps(tiff: Buffer): ExifGpsCoords | null {
  if (tiff.length < 8) return null;
  const endian = tiff.toString('ascii', 0, 2);
  if (endian !== 'II' && endian !== 'MM') return null;
  const le = endian === 'II';
  const u16 = (off: number) => (le ? tiff.readUInt16LE(off) : tiff.readUInt16BE(off));
  const u32 = (off: number) => (le ? tiff.readUInt32LE(off) : tiff.readUInt32BE(off));

  if (u16(2) !== 42) return null;
  const ifd0Offset = u32(4);
  if (ifd0Offset + 2 > tiff.length) return null;

  const ifd0Count = u16(ifd0Offset);
  let gpsIfdOffset = 0;
  for (let i = 0; i < ifd0Count; i++) {
    const entry = ifd0Offset + 2 + i * 12;
    if (entry + 12 > tiff.length) break;
    if (u16(entry) === 0x8825) {
      gpsIfdOffset = u32(entry + 8);
      break;
    }
  }
  if (!gpsIfdOffset || gpsIfdOffset + 2 > tiff.length) return null;

  const gpsCount = u16(gpsIfdOffset);
  let latRef = 'N';
  let lngRef = 'E';
  let latVals: number[] | null = null;
  let lngVals: number[] | null = null;

  const readRationals = (offset: number, count: number): number[] | null => {
    if (offset + count * 8 > tiff.length) return null;
    const out: number[] = [];
    for (let j = 0; j < count; j++) {
      const num = u32(offset + j * 8);
      const den = u32(offset + j * 8 + 4);
      if (den === 0) return null;
      out.push(num / den);
    }
    return out;
  };

  for (let i = 0; i < gpsCount; i++) {
    const entry = gpsIfdOffset + 2 + i * 12;
    if (entry + 12 > tiff.length) break;
    const tag = u16(entry);
    const type = u16(entry + 2);
    const count = u32(entry + 4);
    const valOffset = u32(entry + 8);

    if (tag === 1 && type === 2) {
      latRef = String.fromCharCode(tiff[entry + 8]).toUpperCase();
    } else if (tag === 3 && type === 2) {
      lngRef = String.fromCharCode(tiff[entry + 8]).toUpperCase();
    } else if (tag === 2 && type === 5 && count >= 3) {
      latVals = readRationals(valOffset, 3);
    } else if (tag === 4 && type === 5 && count >= 3) {
      lngVals = readRationals(valOffset, 3);
    }
  }

  if (!latVals || !lngVals) return null;
  let latitude = latVals[0] + latVals[1] / 60 + latVals[2] / 3600;
  let longitude = lngVals[0] + lngVals[1] / 60 + lngVals[2] / 3600;
  if (latRef === 'S') latitude = -latitude;
  if (lngRef === 'W') longitude = -longitude;

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return {latitude, longitude};
}

export function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function resolveDataDir(): string {
  const cwd = process.cwd();
  const base = existsSync(path.join(cwd, 'frontend', 'package.json'))
    ? path.join(cwd, 'frontend', '.data')
    : path.join(cwd, '.data');
  mkdirSync(path.join(base, 'images'), {recursive: true});
  return base;
}

function vaultFilePath(): string {
  return path.join(resolveDataDir(), 'evidence-vault.json');
}

function readVault(): Record<string, EvidenceRecord> {
  try {
    const fp = vaultFilePath();
    if (!existsSync(fp)) return {};
    const parsed = JSON.parse(readFileSync(fp, 'utf-8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, EvidenceRecord>) : {};
  } catch {
    return {};
  }
}

function writeVault(records: Record<string, EvidenceRecord>): void {
  writeFileSync(vaultFilePath(), JSON.stringify(records, null, 2));
}

export function findDuplicateEvidence(params: {
  imageHash: string;
  perceptualHash: string;
  currentProofHash: string;
  isSample: boolean;
}): EvidenceRecord | null {
  if (params.isSample) return null;
  const records = Object.values(readVault());
  for (const rec of records) {
    if (rec.isSample || !rec.signed) continue;
    if (rec.proofHash.toLowerCase() === params.currentProofHash.toLowerCase()) continue;
    if (rec.imageHash === params.imageHash) return rec;
    if (hammingDistanceHex(rec.perceptualHash, params.perceptualHash) <= 4) return rec;
  }
  return null;
}

export function saveEvidenceRecord(record: EvidenceRecord, imageBytes?: Buffer): void {
  const dataDir = resolveDataDir();
  if (imageBytes && imageBytes.length > 0 && record.imageFileName) {
    const imgPath = path.join(dataDir, 'images', record.imageFileName);
    if (!existsSync(imgPath)) {
      writeFileSync(imgPath, imageBytes);
    }
  }
  const vault = readVault();
  vault[record.proofHash.toLowerCase()] = record;
  writeVault(vault);
}

export function getEvidenceByProofHash(
  proofHash: string
): {record: EvidenceRecord; imageDataUrl: string | null} | null {
  const vault = readVault();
  const record = vault[proofHash.toLowerCase()];
  if (!record) return null;

  let imageDataUrl: string | null = null;
  if (record.imageFileName) {
    const imgPath = path.join(resolveDataDir(), 'images', record.imageFileName);
    if (existsSync(imgPath)) {
      const buf = readFileSync(imgPath);
      imageDataUrl = `data:${record.mimeType};base64,${buf.toString('base64')}`;
    }
  }
  return {record, imageDataUrl};
}

export function listRecentEvidence(limit = 30): EvidenceRecord[] {
  return Object.values(readVault())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}
