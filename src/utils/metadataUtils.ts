import JSZip from 'jszip';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import {
  isNetpbmBytes,
  parsePpmHeader,
  inspectBmpHeader,
  inspectIcoHeader,
} from './imageCodecUtils';

export interface MetadataTagItem {
  id: string;
  group: 'File' | 'EXIF' | 'GPS' | 'XMP' | 'C2PA' | 'PNG' | 'PDF' | 'Office' | 'ISO-BMFF' | 'HTML/SVG';
  key: string;
  value: string;
  rawValue?: string;
  editable?: boolean;
  readOnlyReason?: string;
  deletable?: boolean;
  metaRef?: Record<string, any>;
}

export interface RawParsedExifEntry {
  id: string;
  ifd: 'ifd0' | 'exif' | 'gps';
  tag: number;
  type: number;
  count: number;
  rawBytes: Uint8Array;
}

export interface C2paBoxSummary {
  label: string;
  uuid: string;
  size: number;
  details: string[];
}

export interface InspectedMetadata {
  fileName: string;
  baseName: string;
  nameExtension: string;
  detectedFormat: string;
  detectedMime: string;
  extensionMismatch: boolean;
  size: number;
  mimeType: string;
  lastModified: number;
  lastModifiedInput: string;
  embeddedDates: {
    original?: string;
    digitized?: string;
    created?: string;
    modified?: string;
  };
  gps: {
    found: boolean;
    latitude?: number;
    longitude?: number;
    altitude?: number;
    timestamp?: string;
    source?: string;
  };
  c2pa: {
    found: boolean;
    locations: string[];
    totalBytes: number;
    generator?: string;
    title?: string;
    actions: string[];
    digitalSourceType?: string;
    signer?: string;
    manifestUrn?: string;
    boxes: C2paBoxSummary[];
  };
  documentMeta: {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string;
    software?: string;
    copyright?: string;
    description?: string;
    cameraMake?: string;
    cameraModel?: string;
    company?: string;
  };
  orientation?: number;
  tags: MetadataTagItem[];
  rawExifEntries?: RawParsedExifEntry[];
  rawXmpText?: string;
  capabilities: {
    canEditExif: boolean;
    canEditGps: boolean;
    canEditDocMeta: boolean;
    canEditEmbeddedDates: boolean;
    canStripC2pa: boolean;
    canStripAllMeta: boolean;
  };
}

export interface MetadataEditOptions {
  newBaseName: string;
  newExtension: string;
  lastModifiedAction: 'keep' | 'set' | 'reset';
  newLastModified?: number;
  embeddedDateAction: 'keep' | 'set' | 'delete';
  newEmbeddedDate?: string; // YYYY-MM-DDTHH:mm or ISO
  gpsAction: 'keep' | 'set' | 'delete';
  newLatitude?: number;
  newLongitude?: number;
  newAltitude?: number;
  c2paAction: 'keep' | 'delete';
  docMetaAction: 'keep' | 'set' | 'delete';
  newDocMeta?: {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string;
    software?: string;
    copyright?: string;
    description?: string;
    company?: string;
  };
  scrubAllMetadata: boolean;
  preserveIccAndOrientation: boolean;
  deletedTagIds?: Set<string>;
  editedTags?: Record<string, string>;
}

export interface MetadataEditResult {
  file: File;
  blob: Blob;
  fileName: string;
  lastModified: number;
  changesApplied: string[];
}

// ---------- Helpers ----------

export function splitFileName(fileName: string): { baseName: string; extension: string } {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === fileName.length - 1) {
    return { baseName: fileName, extension: '' };
  }
  return {
    baseName: fileName.slice(0, lastDot),
    extension: fileName.slice(lastDot + 1),
  };
}

export function formatToDateTimeLocalInput(ms: number): string {
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function exifDateToDateTimeLocal(exifStr?: string): string {
  if (!exifStr) return '';
  // Format: "YYYY:MM:DD HH:MM:SS" or ISO
  const m = exifStr.trim().match(/^(\d{4})[:\-](\d{2})[:\-](\d{2})[T\s](\d{2}):(\d{2})/);
  if (!m) return '';
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
}

export function dateTimeLocalToExifDate(input: string): string {
  const d = new Date(input);
  if (isNaN(d.getTime())) {
    const m = input.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (m) return `${m[1]}:${m[2]}:${m[3]} ${m[4]}:${m[5]}:${m[6] || '00'}`;
    return '2000:01:01 00:00:00';
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function dateTimeLocalToIso(input: string): string {
  const d = new Date(input);
  if (isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

function readAscii(bytes: Uint8Array, start: number, len: number): string {
  const end = Math.min(bytes.length, start + len);
  let out = '';
  for (let i = start; i < end; i++) {
    const c = bytes[i];
    if (c === 0) break;
    out += String.fromCharCode(c);
  }
  return out;
}

function readUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return '';
  }
}

function encodeUtf8(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function readUint16(bytes: Uint8Array, offset: number, littleEndian: boolean): number {
  if (offset + 2 > bytes.length) return 0;
  return littleEndian
    ? bytes[offset] | (bytes[offset + 1] << 8)
    : (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32(bytes: Uint8Array, offset: number, littleEndian: boolean): number {
  if (offset + 4 > bytes.length) return 0;
  return littleEndian
    ? (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
    : ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function writeUint16(buf: Uint8Array, offset: number, value: number, littleEndian: boolean) {
  if (littleEndian) {
    buf[offset] = value & 0xff;
    buf[offset + 1] = (value >> 8) & 0xff;
  } else {
    buf[offset] = (value >> 8) & 0xff;
    buf[offset + 1] = value & 0xff;
  }
}

function writeUint32(buf: Uint8Array, offset: number, value: number, littleEndian: boolean) {
  if (littleEndian) {
    buf[offset] = value & 0xff;
    buf[offset + 1] = (value >> 8) & 0xff;
    buf[offset + 2] = (value >> 16) & 0xff;
    buf[offset + 3] = (value >> 24) & 0xff;
  } else {
    buf[offset] = (value >> 24) & 0xff;
    buf[offset + 1] = (value >> 16) & 0xff;
    buf[offset + 2] = (value >> 8) & 0xff;
    buf[offset + 3] = value & 0xff;
  }
}

// CRC32 for PNG chunks
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ---------- Magic Byte Format Detection ----------

export async function detectMagicFormat(bytes: Uint8Array, fileName: string): Promise<{ format: string; mime: string }> {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { format: 'jpg', mime: 'image/jpeg' };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { format: 'png', mime: 'image/png' };
  }
  if (
    bytes.length >= 12 &&
    readAscii(bytes, 0, 4) === 'RIFF' &&
    readAscii(bytes, 8, 4) === 'WEBP'
  ) {
    return { format: 'webp', mime: 'image/webp' };
  }
  if (
    bytes.length >= 12 &&
    readAscii(bytes, 0, 4) === 'RIFF' &&
    readAscii(bytes, 8, 4) === 'WAVE'
  ) {
    return { format: 'wav', mime: 'audio/wav' };
  }
  if (bytes.length >= 6 && (readAscii(bytes, 0, 6) === 'GIF87a' || readAscii(bytes, 0, 6) === 'GIF89a')) {
    return { format: 'gif', mime: 'image/gif' };
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return { format: 'bmp', mime: 'image/bmp' };
  }
  if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) {
    return { format: 'ico', mime: 'image/x-icon' };
  }
  if (
    bytes.length >= 4 &&
    ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
      (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a))
  ) {
    return { format: 'tiff', mime: 'image/tiff' };
  }
  if (bytes.length >= 5 && readAscii(bytes, 0, 5) === '%PDF-') {
    return { format: 'pdf', mime: 'application/pdf' };
  }
  if (bytes.length >= 8 && readAscii(bytes, 4, 4) === 'ftyp') {
    const brand = readAscii(bytes, 8, 4).toLowerCase();
    if (brand.startsWith('qt')) return { format: 'mov', mime: 'video/quicktime' };
    if (brand.startsWith('m4a')) return { format: 'm4a', mime: 'audio/mp4' };
    if (brand === 'avif' || brand === 'heic' || brand === 'mif1') {
      return { format: brand === 'avif' ? 'avif' : 'heic', mime: `image/${brand === 'avif' ? 'avif' : 'heic'}` };
    }
    return { format: 'mp4', mime: 'video/mp4' };
  }
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { format: 'webm', mime: 'video/webm' };
  }
  if (
    bytes.length >= 3 &&
    (readAscii(bytes, 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))
  ) {
    return { format: 'mp3', mime: 'audio/mpeg' };
  }
  if (bytes.length >= 4 && readAscii(bytes, 0, 4) === 'OggS') {
    return { format: 'ogg', mime: 'audio/ogg' };
  }
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    // ZIP container: distinguish docx, xlsx, pptx, epub, zip
    try {
      const zip = await JSZip.loadAsync(bytes);
      if (zip.file('word/document.xml')) {
        return { format: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
      }
      if (zip.file('xl/workbook.xml')) {
        return { format: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
      }
      if (zip.file('ppt/presentation.xml')) {
        return { format: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
      }
      if (zip.file('META-INF/container.xml')) {
        return { format: 'epub', mime: 'application/epub+zip' };
      }
    } catch {
      // Fallback to zip
    }
    return { format: 'zip', mime: 'application/zip' };
  }

  // Text-based inspection
  if (isNetpbmBytes(bytes)) {
    return { format: 'ppm', mime: 'image/x-portable-pixmap' };
  }
  const sample = readUtf8(bytes.subarray(0, Math.min(bytes.length, 4096))).trimStart();
  const extLower = splitFileName(fileName).extension.toLowerCase();
  if (sample.startsWith('<svg') || (sample.startsWith('<?xml') && sample.includes('<svg'))) {
    return { format: 'svg', mime: 'image/svg+xml' };
  }
  if (/^<!doctype\s+html/i.test(sample) || /^<html[\s>]/i.test(sample)) {
    return { format: 'html', mime: 'text/html' };
  }
  if (sample.startsWith('<?xml')) {
    return { format: 'xml', mime: 'application/xml' };
  }
  if ((sample.startsWith('{') || sample.startsWith('[')) && extLower === 'json') {
    return { format: 'json', mime: 'application/json' };
  }
  if (extLower) {
    const map: Record<string, string> = {
      txt: 'text/plain',
      md: 'text/markdown',
      csv: 'text/csv',
      tsv: 'text/tab-separated-values',
      json: 'application/json',
      html: 'text/html',
      htm: 'text/html',
      svg: 'image/svg+xml',
      xml: 'application/xml',
      ppm: 'image/x-portable-pixmap',
      pnm: 'image/x-portable-anymap',
      bmp: 'image/bmp',
      ico: 'image/x-icon',
    };
    return { format: extLower === 'htm' ? 'html' : extLower, mime: map[extLower] || 'application/octet-stream' };
  }

  return { format: 'bin', mime: 'application/octet-stream' };
}

export function isExtensionCompatible(nameExt: string, detectedFormat: string): boolean {
  const n = nameExt.toLowerCase();
  const d = detectedFormat.toLowerCase();
  if (!n) return false;
  if (n === d) return true;
  if ((n === 'jpeg' || n === 'jpg' || n === 'jpe') && d === 'jpg') return true;
  if ((n === 'tif' || n === 'tiff') && d === 'tiff') return true;
  if ((n === 'ppm' || n === 'pnm' || n === 'pgm' || n === 'pbm') && d === 'ppm') return true;
  if ((n === 'bmp' || n === 'dib') && d === 'bmp') return true;
  if ((n === 'ico' || n === 'cur') && d === 'ico') return true;
  if ((n === 'htm' || n === 'html') && d === 'html') return true;
  if ((n === 'md' || n === 'markdown') && (d === 'md' || d === 'txt')) return true;
  if (['csv', 'tsv', 'txt', 'md', 'json', 'log'].includes(n) && ['csv', 'tsv', 'txt', 'md', 'json'].includes(d)) {
    return true;
  }
  return false;
}

// ---------- TIFF / EXIF / GPS Parser ----------

interface ParsedExifData {
  tags: MetadataTagItem[];
  rawEntries: RawParsedExifEntry[];
  make?: string;
  model?: string;
  software?: string;
  artist?: string;
  copyright?: string;
  description?: string;
  orientation?: number;
  dateTime?: string;
  dateTimeOriginal?: string;
  dateTimeDigitized?: string;
  gps?: {
    latitude?: number;
    longitude?: number;
    altitude?: number;
    timestamp?: string;
  };
  rawFields: Record<number, { type: number; value: any }>;
}

const IFD0_TAG_NAMES: Record<number, string> = {
  0x010e: 'ImageDescription',
  0x010f: 'Make',
  0x0110: 'Model',
  0x0112: 'Orientation',
  0x011a: 'XResolution',
  0x011b: 'YResolution',
  0x0128: 'ResolutionUnit',
  0x0131: 'Software',
  0x0132: 'DateTime (ModifyDate)',
  0x013b: 'Artist (Author)',
  0x8298: 'Copyright',
  0xa430: 'CameraOwnerName',
  0xa431: 'BodySerialNumber',
  0xa432: 'LensSpecification',
  0xa433: 'LensMake',
  0xa434: 'LensModel',
  0xa435: 'LensSerialNumber',
  0x9003: 'DateTimeOriginal',
  0x9004: 'DateTimeDigitized',
  0x9010: 'OffsetTime',
  0x9011: 'OffsetTimeOriginal',
  0x9286: 'UserComment',
  0x829a: 'ExposureTime',
  0x829d: 'FNumber',
  0x8827: 'ISOSpeedRatings',
  0x920a: 'FocalLength',
  0xa001: 'ColorSpace',
  0xa002: 'PixelXDimension',
  0xa003: 'PixelYDimension',
};

const GPS_TAG_NAMES: Record<number, string> = {
  0x0000: 'GPSVersionID',
  0x0001: 'GPSLatitudeRef',
  0x0002: 'GPSLatitude',
  0x0003: 'GPSLongitudeRef',
  0x0004: 'GPSLongitude',
  0x0005: 'GPSAltitudeRef',
  0x0006: 'GPSAltitude',
  0x0007: 'GPSTimeStamp',
  0x0012: 'GPSMapDatum',
  0x001b: 'GPSProcessingMethod',
  0x001d: 'GPSDateStamp',
};

const TIFF_TYPE_SIZES: Record<number, number> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  6: 1, // SBYTE
  7: 1, // UNDEFINED
  8: 2, // SSHORT
  9: 4, // SLONG
  10: 8, // SRATIONAL
  11: 4, // FLOAT
  12: 8, // DOUBLE
};

function extractTiffRawBytesAsLe(
  tiff: Uint8Array,
  type: number,
  count: number,
  valueOrOffset: number,
  entryOffset: number,
  le: boolean
): Uint8Array | null {
  const elemSize = TIFF_TYPE_SIZES[type] || 1;
  const totalBytes = elemSize * count;
  if (totalBytes <= 0 || totalBytes > 1024 * 512) return null;
  const dataOffset = totalBytes <= 4 ? entryOffset + 8 : valueOrOffset;
  if (dataOffset < 0 || dataOffset + totalBytes > tiff.length) return null;

  const slice = tiff.slice(dataOffset, dataOffset + totalBytes);
  if (le) return slice;

  // Swap byte order per element when converting Big Endian TIFF -> Little Endian
  if (type === 3 || type === 8) {
    for (let i = 0; i + 1 < slice.length; i += 2) {
      const tmp = slice[i];
      slice[i] = slice[i + 1];
      slice[i + 1] = tmp;
    }
  } else if (type === 4 || type === 9 || type === 5 || type === 10 || type === 11) {
    for (let i = 0; i + 3 < slice.length; i += 4) {
      const a = slice[i], b = slice[i + 1], c = slice[i + 2], d = slice[i + 3];
      slice[i] = d;
      slice[i + 1] = c;
      slice[i + 2] = b;
      slice[i + 3] = a;
    }
  } else if (type === 12) {
    for (let i = 0; i + 7 < slice.length; i += 8) {
      for (let j = 0; j < 4; j++) {
        const tmp = slice[i + j];
        slice[i + j] = slice[i + 7 - j];
        slice[i + 7 - j] = tmp;
      }
    }
  }
  return slice;
}

function readTiffValue(
  tiff: Uint8Array,
  type: number,
  count: number,
  valueOrOffset: number,
  entryOffset: number,
  le: boolean
): any {
  const elemSize = TIFF_TYPE_SIZES[type] || 1;
  const totalBytes = elemSize * count;
  const dataOffset = totalBytes <= 4 ? entryOffset + 8 : valueOrOffset;
  if (dataOffset < 0 || dataOffset + totalBytes > tiff.length) {
    return null;
  }

  if (type === 2) {
    return readUtf8(tiff.subarray(dataOffset, dataOffset + count)).replace(/\0+$/, '').trim();
  }
  if (type === 3 || type === 8) {
    if (count === 1) return readUint16(tiff, dataOffset, le);
    const arr: number[] = [];
    for (let i = 0; i < Math.min(count, 16); i++) {
      arr.push(readUint16(tiff, dataOffset + i * 2, le));
    }
    return arr;
  }
  if (type === 4 || type === 9) {
    if (count === 1) return readUint32(tiff, dataOffset, le);
    const arr: number[] = [];
    for (let i = 0; i < Math.min(count, 16); i++) {
      arr.push(readUint32(tiff, dataOffset + i * 4, le));
    }
    return arr;
  }
  if (type === 5 || type === 10) {
    const arr: number[] = [];
    for (let i = 0; i < Math.min(count, 8); i++) {
      const num = readUint32(tiff, dataOffset + i * 8, le);
      const den = readUint32(tiff, dataOffset + i * 8 + 4, le);
      arr.push(den === 0 ? 0 : num / den);
    }
    return count === 1 ? arr[0] : arr;
  }
  if (type === 1 || type === 6) {
    if (count === 1) return tiff[dataOffset];
    return Array.from(tiff.subarray(dataOffset, dataOffset + Math.min(count, 16)));
  }
  if (type === 7) {
    if (count <= 8) return Array.from(tiff.subarray(dataOffset, dataOffset + count));
    const sub = tiff.subarray(dataOffset, Math.min(tiff.length, dataOffset + Math.min(count, 512)));
    const prefix = readAscii(sub, 0, 8);
    if (prefix.startsWith('ASCII')) {
      return readUtf8(sub.subarray(8)).replace(/\0/g, '').trim();
    }
    if (prefix.startsWith('UNICODE')) {
      return readUtf8(sub.subarray(8)).replace(/\0/g, '').trim();
    }
    const txt = readUtf8(sub);
    return txt.replace(/\0/g, '').trim();
  }
  return null;
}

function parseExifTiffBytes(tiff: Uint8Array): ParsedExifData {
  const result: ParsedExifData = { tags: [], rawEntries: [], rawFields: {} };
  if (tiff.length < 8) return result;

  const endian = readAscii(tiff, 0, 2);
  if (endian !== 'II' && endian !== 'MM') return result;
  const le = endian === 'II';
  const magic = readUint16(tiff, 2, le);
  if (magic !== 42) return result;

  const ifd0Offset = readUint32(tiff, 4, le);
  let exifIfdOffset = 0;
  let gpsIfdOffset = 0;
  const seenIds = new Set<string>();

  const uniqueId = (base: string) => {
    if (!seenIds.has(base)) {
      seenIds.add(base);
      return base;
    }
    let idx = 2;
    while (seenIds.has(`${base}_${idx}`)) idx++;
    const next = `${base}_${idx}`;
    seenIds.add(next);
    return next;
  };

  const readIfd = (offset: number, ifdKind: 'ifd0' | 'exif', nameMap: Record<number, string>) => {
    if (offset <= 0 || offset + 2 > tiff.length) return;
    const count = readUint16(tiff, offset, le);
    const maxEntries = Math.min(count, 120);
    for (let i = 0; i < maxEntries; i++) {
      const entryOffset = offset + 2 + i * 12;
      if (entryOffset + 12 > tiff.length) break;
      const tag = readUint16(tiff, entryOffset, le);
      const type = readUint16(tiff, entryOffset + 2, le);
      const valCount = readUint32(tiff, entryOffset + 4, le);
      const valOrOffset = readUint32(tiff, entryOffset + 8, le);

      if (ifdKind === 'ifd0' && tag === 0x8769) {
        exifIfdOffset = valOrOffset;
        continue;
      }
      if (ifdKind === 'ifd0' && tag === 0x8825) {
        gpsIfdOffset = valOrOffset;
        continue;
      }

      const rawBytes = extractTiffRawBytesAsLe(tiff, type, valCount, valOrOffset, entryOffset, le);
      const val = readTiffValue(tiff, type, valCount, valOrOffset, entryOffset, le);
      if (val === null || val === undefined || val === '') {
        if (rawBytes) {
          const entryId = uniqueId(`exif_${tag.toString(16)}`);
          result.rawEntries.push({ id: entryId, ifd: ifdKind, tag, type, count: valCount, rawBytes });
        }
        continue;
      }

      result.rawFields[tag] = { type, value: val };
      if (tag === 0x010e && typeof val === 'string') result.description = val;
      if (tag === 0x010f && typeof val === 'string') result.make = val;
      if (tag === 0x0110 && typeof val === 'string') result.model = val;
      if (tag === 0x0112 && typeof val === 'number') result.orientation = val;
      if (tag === 0x0131 && typeof val === 'string') result.software = val;
      if (tag === 0x0132 && typeof val === 'string') result.dateTime = val;
      if (tag === 0x013b && typeof val === 'string') result.artist = val;
      if (tag === 0x8298 && typeof val === 'string') result.copyright = val;
      if (tag === 0x9003 && typeof val === 'string') result.dateTimeOriginal = val;
      if (tag === 0x9004 && typeof val === 'string') result.dateTimeDigitized = val;

      const label = nameMap[tag] || `Tag 0x${tag.toString(16).toUpperCase().padStart(4, '0')}`;
      const displayVal = Array.isArray(val) ? val.map((v) => (typeof v === 'number' ? Number(v.toFixed(5)) : v)).join(', ') : String(val);
      const entryId = uniqueId(`exif_${tag.toString(16)}`);
      if (rawBytes) {
        result.rawEntries.push({ id: entryId, ifd: ifdKind, tag, type, count: valCount, rawBytes });
      }
      result.tags.push({
        id: entryId,
        group: 'EXIF',
        key: label,
        value: displayVal,
        rawValue: displayVal,
        editable: true,
        deletable: true,
        metaRef: { ifd: ifdKind, tag, type },
      });
    }
  };

  readIfd(ifd0Offset, 'ifd0', IFD0_TAG_NAMES);
  if (exifIfdOffset > 0) readIfd(exifIfdOffset, 'exif', IFD0_TAG_NAMES);

  if (gpsIfdOffset > 0) {
    const gpsFields: Record<number, any> = {};
    const count = readUint16(tiff, gpsIfdOffset, le);
    const maxEntries = Math.min(count, 64);
    for (let i = 0; i < maxEntries; i++) {
      const entryOffset = gpsIfdOffset + 2 + i * 12;
      if (entryOffset + 12 > tiff.length) break;
      const tag = readUint16(tiff, entryOffset, le);
      const type = readUint16(tiff, entryOffset + 2, le);
      const valCount = readUint32(tiff, entryOffset + 4, le);
      const valOrOffset = readUint32(tiff, entryOffset + 8, le);
      const rawBytes = extractTiffRawBytesAsLe(tiff, type, valCount, valOrOffset, entryOffset, le);
      const val = readTiffValue(tiff, type, valCount, valOrOffset, entryOffset, le);
      if (val === null || val === undefined) continue;
      gpsFields[tag] = val;
      const label = GPS_TAG_NAMES[tag] || `GPS Tag 0x${tag.toString(16).toUpperCase()}`;
      const displayVal = Array.isArray(val) ? val.map((v) => (typeof v === 'number' ? Number(v.toFixed(6)) : v)).join(', ') : String(val);
      const entryId = uniqueId(`gps_${tag.toString(16)}`);
      if (rawBytes) {
        result.rawEntries.push({ id: entryId, ifd: 'gps', tag, type, count: valCount, rawBytes });
      }
      result.tags.push({
        id: entryId,
        group: 'GPS',
        key: label,
        value: displayVal,
        rawValue: displayVal,
        editable: true,
        deletable: true,
        metaRef: { ifd: 'gps', tag, type },
      });
    }

    const dmsToDecimal = (dms: any, ref: any): number | undefined => {
      if (!Array.isArray(dms) || dms.length < 3) return undefined;
      const dec = Number(dms[0]) + Number(dms[1]) / 60 + Number(dms[2]) / 3600;
      if (isNaN(dec)) return undefined;
      const r = String(ref || '').toUpperCase();
      return r === 'S' || r === 'W' ? -dec : dec;
    };

    const lat = dmsToDecimal(gpsFields[0x0002], gpsFields[0x0001]);
    const lng = dmsToDecimal(gpsFields[0x0004], gpsFields[0x0003]);
    let alt: number | undefined;
    if (typeof gpsFields[0x0006] === 'number') {
      alt = gpsFields[0x0005] === 1 ? -gpsFields[0x0006] : gpsFields[0x0006];
    }
    let timestamp: string | undefined;
    if (gpsFields[0x001d]) {
      timestamp = String(gpsFields[0x001d]);
      if (Array.isArray(gpsFields[0x0007]) && gpsFields[0x0007].length >= 3) {
        const t = gpsFields[0x0007].map((n: number) => String(Math.floor(n)).padStart(2, '0')).join(':');
        timestamp = `${timestamp} ${t} UTC`;
      }
    }
    if (lat !== undefined || lng !== undefined || alt !== undefined) {
      result.gps = { latitude: lat, longitude: lng, altitude: alt, timestamp };
    }
  }

  return result;
}

// ---------- TIFF / EXIF Writer ----------

interface ExifBuildInput {
  make?: string;
  model?: string;
  software?: string;
  artist?: string;
  copyright?: string;
  description?: string;
  orientation?: number;
  dateTime?: string;
  dateTimeOriginal?: string;
  dateTimeDigitized?: string;
  gps?: {
    latitude: number;
    longitude: number;
    altitude?: number;
  };
}

interface RawIfdEntry {
  tag: number;
  type: number;
  count: number;
  bytes: Uint8Array;
}

function makeAsciiEntry(tag: number, str: string): RawIfdEntry {
  const raw = encodeUtf8(str);
  const bytes = new Uint8Array(raw.length + 1);
  bytes.set(raw, 0);
  bytes[raw.length] = 0;
  return { tag, type: 2, count: bytes.length, bytes };
}

function makeShortEntry(tag: number, value: number): RawIfdEntry {
  const bytes = new Uint8Array(2);
  writeUint16(bytes, 0, value, true);
  return { tag, type: 3, count: 1, bytes };
}

function makeLongEntry(tag: number, value: number): RawIfdEntry {
  const bytes = new Uint8Array(4);
  writeUint32(bytes, 0, value, true);
  return { tag, type: 4, count: 1, bytes };
}

function makeRationalEntry(tag: number, pairs: Array<[number, number]>): RawIfdEntry {
  const bytes = new Uint8Array(pairs.length * 8);
  for (let i = 0; i < pairs.length; i++) {
    writeUint32(bytes, i * 8, Math.round(pairs[i][0]) >>> 0, true);
    writeUint32(bytes, i * 8 + 4, Math.max(1, Math.round(pairs[i][1])) >>> 0, true);
  }
  return { tag, type: 5, count: pairs.length, bytes };
}

function decimalToDmsRationals(decimal: number): Array<[number, number]> {
  const abs = Math.abs(decimal);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = Math.round((minFloat - min) * 60 * 10000);
  return [
    [deg, 1],
    [min, 1],
    [sec, 10000],
  ];
}

function parseNumberOrFractionToRationalPair(token: string): [number, number] {
  const clean = token.trim();
  if (clean.includes('/')) {
    const [aStr, bStr] = clean.split('/');
    const a = parseFloat(aStr);
    const b = parseFloat(bStr);
    if (!isNaN(a) && !isNaN(b) && b !== 0) {
      return [Math.round(a), Math.max(1, Math.round(b))];
    }
  }
  const num = parseFloat(clean);
  if (isNaN(num)) return [0, 1];
  if (Number.isInteger(num)) return [num, 1];
  return [Math.round(num * 10000), 10000];
}

function encodeRawExifValueFromString(tag: number, origType: number, valStr: string): RawIfdEntry {
  if (origType === 2) {
    return makeAsciiEntry(tag, valStr);
  }
  if (origType === 3 || origType === 8) {
    const nums = valStr.split(/[,\s]+/).map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
    const vals = nums.length > 0 ? nums : [0];
    const bytes = new Uint8Array(vals.length * 2);
    for (let i = 0; i < vals.length; i++) writeUint16(bytes, i * 2, vals[i] & 0xffff, true);
    return { tag, type: origType, count: vals.length, bytes };
  }
  if (origType === 4 || origType === 9) {
    const nums = valStr.split(/[,\s]+/).map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
    const vals = nums.length > 0 ? nums : [0];
    const bytes = new Uint8Array(vals.length * 4);
    for (let i = 0; i < vals.length; i++) writeUint32(bytes, i * 4, vals[i] >>> 0, true);
    return { tag, type: origType, count: vals.length, bytes };
  }
  if (origType === 5 || origType === 10) {
    const tokens = valStr.split(',').map((s) => s.trim()).filter(Boolean);
    const pairs = (tokens.length > 0 ? tokens : ['0']).map(parseNumberOrFractionToRationalPair);
    const entry = makeRationalEntry(tag, pairs);
    entry.type = origType;
    return entry;
  }
  if (origType === 1 || origType === 6) {
    const nums = valStr.split(/[,\s]+/).map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
    if (nums.length > 0) {
      return { tag, type: origType, count: nums.length, bytes: new Uint8Array(nums.map((n) => n & 0xff)) };
    }
    const raw = encodeUtf8(valStr);
    return { tag, type: origType, count: raw.length, bytes: raw };
  }
  if (origType === 7) {
    if (tag === 0x9286) {
      const prefix = encodeUtf8('ASCII\0\0\0');
      const body = encodeUtf8(valStr);
      const combined = new Uint8Array(prefix.length + body.length);
      combined.set(prefix, 0);
      combined.set(body, prefix.length);
      return { tag, type: 7, count: combined.length, bytes: combined };
    }
    const raw = encodeUtf8(valStr);
    return { tag, type: 7, count: raw.length, bytes: raw };
  }
  return makeAsciiEntry(tag, valStr);
}

function serializeIfdEntries(ifd0: RawIfdEntry[], exifIfd: RawIfdEntry[], gpsIfd: RawIfdEntry[]): Uint8Array | null {
  // Deduplicate by tag inside each IFD
  const dedup = (arr: RawIfdEntry[]) => {
    const map = new Map<number, RawIfdEntry>();
    for (const e of arr) {
      if (e.tag === 0x8769 || e.tag === 0x8825) continue;
      map.set(e.tag, e);
    }
    return Array.from(map.values());
  };
  const dIfd0 = dedup(ifd0);
  const dExif = dedup(exifIfd);
  const dGps = dedup(gpsIfd);

  if (dIfd0.length === 0 && dExif.length === 0 && dGps.length === 0) {
    return null;
  }

  const hasExifIfd = dExif.length > 0;
  const hasGpsIfd = dGps.length > 0;
  if (hasExifIfd) dIfd0.push(makeLongEntry(0x8769, 0));
  if (hasGpsIfd) dIfd0.push(makeLongEntry(0x8825, 0));

  dIfd0.sort((a, b) => a.tag - b.tag);
  dExif.sort((a, b) => a.tag - b.tag);
  dGps.sort((a, b) => a.tag - b.tag);

  const calcIfdSize = (entries: RawIfdEntry[]) => {
    const dirSize = 2 + entries.length * 12 + 4;
    let extra = 0;
    for (const e of entries) {
      if (e.bytes.length > 4) extra += e.bytes.length + (e.bytes.length % 2);
    }
    return { dirSize, total: dirSize + extra };
  };

  const ifd0Offset = 8;
  const ifd0Sizes = calcIfdSize(dIfd0);
  const exifIfdOffset = ifd0Offset + ifd0Sizes.total;
  const exifSizes = hasExifIfd ? calcIfdSize(dExif) : { dirSize: 0, total: 0 };
  const gpsIfdOffset = exifIfdOffset + exifSizes.total;
  const gpsSizes = hasGpsIfd ? calcIfdSize(dGps) : { dirSize: 0, total: 0 };
  const totalSize = gpsIfdOffset + gpsSizes.total;

  if (hasExifIfd) {
    const ptr = dIfd0.find((e) => e.tag === 0x8769)!;
    writeUint32(ptr.bytes, 0, exifIfdOffset, true);
  }
  if (hasGpsIfd) {
    const ptr = dIfd0.find((e) => e.tag === 0x8825)!;
    writeUint32(ptr.bytes, 0, gpsIfdOffset, true);
  }

  const out = new Uint8Array(totalSize);
  out[0] = 0x49;
  out[1] = 0x49;
  writeUint16(out, 2, 42, true);
  writeUint32(out, 4, ifd0Offset, true);

  const writeIfd = (startOffset: number, entries: RawIfdEntry[]) => {
    writeUint16(out, startOffset, entries.length, true);
    let dataCursor = startOffset + 2 + entries.length * 12 + 4;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const entryPos = startOffset + 2 + i * 12;
      writeUint16(out, entryPos, e.tag, true);
      writeUint16(out, entryPos + 2, e.type, true);
      writeUint32(out, entryPos + 4, e.count, true);
      if (e.bytes.length <= 4) {
        out.set(e.bytes, entryPos + 8);
      } else {
        writeUint32(out, entryPos + 8, dataCursor, true);
        out.set(e.bytes, dataCursor);
        dataCursor += e.bytes.length + (e.bytes.length % 2);
      }
    }
    writeUint32(out, startOffset + 2 + entries.length * 12, 0, true);
  };

  writeIfd(ifd0Offset, dIfd0);
  if (hasExifIfd) writeIfd(exifIfdOffset, dExif);
  if (hasGpsIfd) writeIfd(gpsIfdOffset, dGps);

  return out;
}

export function buildExifTiffBytes(input: ExifBuildInput): Uint8Array | null {
  const ifd0: RawIfdEntry[] = [];
  const exifIfd: RawIfdEntry[] = [];
  const gpsIfd: RawIfdEntry[] = [];

  if (input.description) ifd0.push(makeAsciiEntry(0x010e, input.description));
  if (input.make) ifd0.push(makeAsciiEntry(0x010f, input.make));
  if (input.model) ifd0.push(makeAsciiEntry(0x0110, input.model));
  if (input.orientation) ifd0.push(makeShortEntry(0x0112, input.orientation));
  if (input.software) ifd0.push(makeAsciiEntry(0x0131, input.software));
  if (input.dateTime) ifd0.push(makeAsciiEntry(0x0132, input.dateTime));
  if (input.artist) ifd0.push(makeAsciiEntry(0x013b, input.artist));
  if (input.copyright) ifd0.push(makeAsciiEntry(0x8298, input.copyright));

  if (input.dateTimeOriginal) exifIfd.push(makeAsciiEntry(0x9003, input.dateTimeOriginal));
  if (input.dateTimeDigitized) exifIfd.push(makeAsciiEntry(0x9004, input.dateTimeDigitized));

  if (input.gps && !isNaN(input.gps.latitude) && !isNaN(input.gps.longitude)) {
    const versionBytes = new Uint8Array([2, 3, 0, 0]);
    gpsIfd.push({ tag: 0x0000, type: 1, count: 4, bytes: versionBytes });
    gpsIfd.push(makeAsciiEntry(0x0001, input.gps.latitude >= 0 ? 'N' : 'S'));
    gpsIfd.push(makeRationalEntry(0x0002, decimalToDmsRationals(input.gps.latitude)));
    gpsIfd.push(makeAsciiEntry(0x0003, input.gps.longitude >= 0 ? 'E' : 'W'));
    gpsIfd.push(makeRationalEntry(0x0004, decimalToDmsRationals(input.gps.longitude)));
    if (typeof input.gps.altitude === 'number' && !isNaN(input.gps.altitude)) {
      gpsIfd.push({ tag: 0x0005, type: 1, count: 1, bytes: new Uint8Array([input.gps.altitude < 0 ? 1 : 0]) });
      gpsIfd.push(makeRationalEntry(0x0006, [[Math.round(Math.abs(input.gps.altitude) * 100), 100]]));
    }
  }

  return serializeIfdEntries(ifd0, exifIfd, gpsIfd);
}

// ---------- JUMBF / C2PA Binary Parser ----------

function extractPrintableAsciiStrings(bytes: Uint8Array): string[] {
  const strings: string[] = [];
  let current = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b >= 32 && b <= 126) {
      current += String.fromCharCode(b);
    } else {
      if (current.length >= 4) {
        strings.push(current);
      }
      current = '';
    }
  }
  if (current.length >= 4) strings.push(current);
  return strings;
}

function parseJumbfC2paPayload(
  payload: Uint8Array,
  locationLabel: string,
  c2paResult: InspectedMetadata['c2pa'],
  tags: MetadataTagItem[]
) {
  if (payload.length < 8) return;
  const asciiAll = extractPrintableAsciiStrings(payload);
  const hasC2paSignature = asciiAll.some(
    (s) =>
      s.includes('c2pa') ||
      s.includes('c2ma') ||
      s.includes('c2cl') ||
      s.includes('c2cs') ||
      s.includes('c2as') ||
      s.includes('Content Credentials') ||
      s.includes('jumbf') ||
      s.includes('jumb')
  );
  if (!hasC2paSignature) return;

  c2paResult.found = true;
  if (!c2paResult.locations.includes(locationLabel)) {
    c2paResult.locations.push(locationLabel);
  }
  c2paResult.totalBytes += payload.length;

  // Walk JUMBF boxes if starting with jumb / superbox
  let offset = 0;
  let boxIndex = 0;
  while (offset + 8 <= payload.length && boxIndex < 40) {
    let boxSize = readUint32(payload, offset, false);
    const boxType = readAscii(payload, offset + 4, 4);
    if (boxSize < 8 || offset + boxSize > payload.length) {
      break;
    }
    if (boxType === 'jumb' || boxType === 'c2pa' || boxType === 'c2ma') {
      // Check inner jumd box
      let label = boxType;
      let uuidHex = '';
      if (offset + 16 <= payload.length) {
        const innerType = readAscii(payload, offset + 12, 4);
        if (innerType === 'jumd' && offset + 33 <= payload.length) {
          const uuidBytes = payload.subarray(offset + 16, offset + 32);
          uuidHex = Array.from(uuidBytes)
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
          const lbl = readAscii(payload, offset + 33, Math.min(128, boxSize - 33));
          if (lbl) label = lbl;
        }
      }
      const boxStrings = extractPrintableAsciiStrings(payload.subarray(offset, offset + Math.min(boxSize, 16384)));
      const interesting = boxStrings.filter(
        (s) =>
          s.includes('c2pa.') ||
          s.includes('urn:uuid:') ||
          s.includes('digitalsourcetype') ||
          s.includes('claim_generator') ||
          s.includes('Adobe') ||
          s.includes('OpenAI') ||
          s.includes('DALL') ||
          s.includes('ChatGPT') ||
          s.includes('Google') ||
          s.includes('Sony') ||
          s.includes('Leica') ||
          s.includes('Truepic') ||
          s.includes('Photoshop') ||
          s.includes('sha256')
      );
      c2paResult.boxes.push({
        label,
        uuid: uuidHex,
        size: boxSize,
        details: interesting.slice(0, 12),
      });
    }
    offset += boxSize;
    boxIndex++;
  }

  // Heuristic extraction from CBOR/UTF-8 strings
  const joined = asciiAll.join('\n');
  const urnMatch = joined.match(/urn:uuid:[0-9a-fA-F-]+|urn:c2pa:[0-9a-fA-F:-]+/);
  if (urnMatch && !c2paResult.manifestUrn) {
    c2paResult.manifestUrn = urnMatch[0];
  }

  const dstMatch = joined.match(/https?:\/\/cv\.iptc\.org\/newscodes\/digitalsourcetype\/[A-Za-z0-9_-]+/);
  if (dstMatch && !c2paResult.digitalSourceType) {
    c2paResult.digitalSourceType = dstMatch[0].split('/').pop();
  }

  const actionMatches = joined.match(/c2pa\.[a-zA-Z0-9_.-]+/g);
  if (actionMatches) {
    for (const act of actionMatches) {
      if (!c2paResult.actions.includes(act) && act.length < 40) {
        c2paResult.actions.push(act);
      }
    }
  }

  const knownGenerators = [
    'ChatGPT',
    'OpenAI',
    'DALL-E',
    'Adobe Photoshop',
    'Adobe Firefly',
    'Adobe Lightroom',
    'Adobe Express',
    'Google Pixel',
    'Google Imagen',
    'Microsoft Designer',
    'Leica',
    'Sony',
    'Nikon',
    'Canon',
    'c2pa-rs',
    'c2pa-node',
    'Truepic',
  ];
  for (const gen of knownGenerators) {
    if (joined.includes(gen) && !c2paResult.generator) {
      c2paResult.generator = gen;
      break;
    }
  }
  if (!c2paResult.generator) {
    const cgIdx = asciiAll.findIndex((s) => s.includes('claim_generator') || s.includes('softwareAgent'));
    if (cgIdx !== -1 && asciiAll[cgIdx + 1]) {
      c2paResult.generator = asciiAll[cgIdx + 1].slice(0, 80);
    }
  }

  // Signer heuristic from X.509 DER CN strings
  const signerCandidates = asciiAll.filter(
    (s) =>
      (s.includes('CN=') ||
        s.includes('DigiCert') ||
        s.includes('GlobalSign') ||
        s.includes('SSL.com') ||
        s.includes('Adobe') ||
        s.includes('Truepic') ||
        s.includes('OpenAI')) &&
      s.length < 100
  );
  if (signerCandidates.length > 0 && !c2paResult.signer) {
    c2paResult.signer = signerCandidates[0];
  }

  const c2paJoinedPreview = asciiAll
    .filter((s) => !/^[^A-Za-z0-9]{4,}$/.test(s))
    .slice(0, 12)
    .join(' | ')
    .slice(0, 320);

  tags.push({
    id: `c2pa_${locationLabel}_${c2paResult.boxes.length}`,
    group: 'C2PA',
    key: `C2PA (${locationLabel})`,
    value: `${payload.length} bytes${c2paResult.generator ? ` · ${c2paResult.generator}` : ''}`,
    rawValue: c2paResult.generator || c2paJoinedPreview || `${payload.length} bytes`,
    editable: true,
    deletable: true,
    metaRef: { locationLabel },
  });
}

// ---------- XMP Helper ----------

function parseXmpXml(
  xmpText: string,
  result: InspectedMetadata
) {
  if (!xmpText) return;
  result.rawXmpText = xmpText;

  const extractTag = (regex: RegExp) => {
    const m = xmpText.match(regex);
    return (m?.[1] || m?.[2])?.trim();
  };

  const xmpCreate = extractTag(/xmp:CreateDate=["']([^"']+)["']|<xmp:CreateDate>([^<]+)<\/xmp:CreateDate>/);
  const xmpModify = extractTag(/xmp:ModifyDate=["']([^"']+)["']|<xmp:ModifyDate>([^<]+)<\/xmp:ModifyDate>/);
  const creatorTool = extractTag(/xmp:CreatorTool=["']([^"']+)["']|<xmp:CreatorTool>([^<]+)<\/xmp:CreatorTool>/);
  const dst = extractTag(/DigitalSourceType=["']([^"']+)["']|<[^:>]+:DigitalSourceType>([^<]+)<\/[^:>]+:DigitalSourceType>/);

  const mCreate = xmpText.match(/xmp:CreateDate[=>]["']?([^<"']+)/);
  const mModify = xmpText.match(/xmp:ModifyDate[=>]["']?([^<"']+)/);
  const mTool = xmpText.match(/xmp:CreatorTool[=>]["']?([^<"']+)/);
  const mAuthor = xmpText.match(/<dc:creator>[\s\S]*?<rdf:li[^>]*>([^<]+)<\/rdf:li>/);
  const mTitle = xmpText.match(/<dc:title>[\s\S]*?<rdf:li[^>]*>([^<]+)<\/rdf:li>/);
  const mRights = xmpText.match(/<dc:rights>[\s\S]*?<rdf:li[^>]*>([^<]+)<\/rdf:li>/);

  if ((xmpCreate || mCreate?.[1]) && !result.embeddedDates.created) {
    result.embeddedDates.created = (xmpCreate || mCreate?.[1])?.trim();
  }
  if ((xmpModify || mModify?.[1]) && !result.embeddedDates.modified) {
    result.embeddedDates.modified = (xmpModify || mModify?.[1])?.trim();
  }
  if ((creatorTool || mTool?.[1]) && !result.documentMeta.software) {
    result.documentMeta.software = (creatorTool || mTool?.[1])?.trim();
  }
  if (mAuthor?.[1] && !result.documentMeta.author) {
    result.documentMeta.author = mAuthor[1].trim();
  }
  if (mTitle?.[1] && !result.documentMeta.title) {
    result.documentMeta.title = mTitle[1].trim();
  }
  if (mRights?.[1] && !result.documentMeta.copyright) {
    result.documentMeta.copyright = mRights[1].trim();
  }

  // Check XMP GPS
  const gpsLatMatch = xmpText.match(/exif:GPSLatitude=["']([^"']+)["']|<exif:GPSLatitude>([^<]+)<\/exif:GPSLatitude>/);
  const gpsLngMatch = xmpText.match(/exif:GPSLongitude=["']([^"']+)["']|<exif:GPSLongitude>([^<]+)<\/exif:GPSLongitude>/);
  if (gpsLatMatch || gpsLngMatch) {
    const gpsCombo = `${gpsLatMatch?.[1] || gpsLatMatch?.[2] || ''} / ${gpsLngMatch?.[1] || gpsLngMatch?.[2] || ''}`;
    result.tags.push({
      id: 'xmp_gps',
      group: 'XMP',
      key: 'XMP GPS Coordinates',
      value: gpsCombo,
      rawValue: gpsCombo,
      editable: true,
      deletable: true,
    });
    result.gps.found = true;
    result.gps.source = result.gps.source || 'XMP';
  }

  // Check C2PA / DigitalSourceType in XMP
  if (dst || xmpText.includes('c2pa') || xmpText.includes('dcterms:provenance')) {
    const dstVal = (dst || '').split('/').pop() || 'XMP Provenance';
    if (!result.c2pa.digitalSourceType && dst) {
      result.c2pa.digitalSourceType = dstVal;
    }
    result.tags.push({
      id: 'xmp_c2pa_provenance',
      group: 'XMP',
      key: 'XMP DigitalSourceType / Provenance',
      value: dst || dstVal,
      rawValue: dst || dstVal,
      editable: true,
      deletable: true,
    });
  }

  const pushXmpTag = (id: string, key: string, val?: string) => {
    if (!val || result.tags.some((t) => t.id === id)) return;
    result.tags.push({ id, group: 'XMP', key, value: val, rawValue: val, editable: true, deletable: true, metaRef: { xmpKey: key } });
  };

  pushXmpTag('xmp_create', 'xmp:CreateDate', xmpCreate || mCreate?.[1]);
  pushXmpTag('xmp_modify', 'xmp:ModifyDate', xmpModify || mModify?.[1]);
  pushXmpTag('xmp_tool', 'xmp:CreatorTool', creatorTool || mTool?.[1]);
  pushXmpTag('xmp_author', 'dc:creator', mAuthor?.[1]);
  pushXmpTag('xmp_title', 'dc:title', mTitle?.[1]);
  pushXmpTag('xmp_rights', 'dc:rights', mRights?.[1]);

  // Discover all remaining simple namespaced XMP tags/attributes
  const seenKeys = new Set(result.tags.filter((t) => t.group === 'XMP').map((t) => t.key));
  const elemRegex = /<([a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+)>([^<\n]{1,300})<\/\1>/g;
  let em: RegExpExecArray | null;
  while ((em = elemRegex.exec(xmpText)) !== null) {
    const tagKey = em[1];
    const tagVal = em[2].trim();
    if (!tagVal || tagKey.startsWith('rdf:') || tagKey.startsWith('xmlns:')) continue;
    if (seenKeys.has(tagKey)) continue;
    seenKeys.add(tagKey);
    pushXmpTag(`xmp_dyn_${tagKey}`, tagKey, tagVal);
  }
  const attrRegex = /\s([a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+)=["']([^"']{1,300})["']/g;
  let am: RegExpExecArray | null;
  while ((am = attrRegex.exec(xmpText)) !== null) {
    const attrKey = am[1];
    const attrVal = am[2].trim();
    if (!attrVal || attrKey.startsWith('xmlns:') || attrKey.startsWith('rdf:') || attrKey.startsWith('x:') || attrKey.includes('GPS') || attrKey.includes('DigitalSourceType')) continue;
    if (seenKeys.has(attrKey)) continue;
    seenKeys.add(attrKey);
    pushXmpTag(`xmp_dyn_${attrKey}`, attrKey, attrVal);
  }
}

// ---------- Main Inspector ----------

export async function inspectFileMetadata(file: File): Promise<InspectedMetadata> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const { baseName, extension } = splitFileName(file.name);
  const { format: detectedFormat, mime: detectedMime } = await detectMagicFormat(bytes, file.name);

  const result: InspectedMetadata = {
    fileName: file.name,
    baseName,
    nameExtension: extension,
    detectedFormat,
    detectedMime,
    extensionMismatch: Boolean(extension) && !isExtensionCompatible(extension, detectedFormat),
    size: file.size,
    mimeType: file.type || detectedMime,
    lastModified: file.lastModified || Date.now(),
    lastModifiedInput: formatToDateTimeLocalInput(file.lastModified || Date.now()),
    embeddedDates: {},
    gps: { found: false },
    c2pa: {
      found: false,
      locations: [],
      totalBytes: 0,
      actions: [],
      boxes: [],
    },
    documentMeta: {},
    tags: [],
    rawExifEntries: [],
    capabilities: {
      canEditExif: ['jpg', 'png', 'webp'].includes(detectedFormat),
      canEditGps: ['jpg', 'png', 'webp'].includes(detectedFormat),
      canEditDocMeta: ['jpg', 'png', 'webp', 'pdf', 'docx', 'xlsx', 'pptx', 'html', 'svg', 'ppm'].includes(detectedFormat),
      canEditEmbeddedDates: ['jpg', 'png', 'webp', 'pdf', 'docx', 'xlsx', 'pptx', 'mp4', 'mov', 'm4a'].includes(detectedFormat),
      canStripC2pa: ['jpg', 'png', 'webp', 'pdf', 'mp4', 'mov', 'm4a', 'svg', 'html'].includes(detectedFormat),
      canStripAllMeta: ['jpg', 'png', 'webp', 'pdf', 'docx', 'xlsx', 'pptx', 'mp4', 'mov', 'm4a', 'svg', 'html', 'ppm'].includes(detectedFormat),
    },
  };

  result.tags.push(
    { id: 'file_name', group: 'File', key: 'File Name', value: file.name, rawValue: baseName, editable: true },
    {
      id: 'file_ext',
      group: 'File',
      key: 'Extension (Name / Detected)',
      value: `${extension || '(none)'} / .${detectedFormat}`,
      rawValue: extension,
      editable: true,
    },
    {
      id: 'file_size',
      group: 'File',
      key: 'Size',
      value: `${file.size.toLocaleString()} bytes`,
      rawValue: `${file.size.toLocaleString()} bytes`,
      editable: false,
      readOnlyReason: 'physical_size',
    },
    {
      id: 'file_mtime',
      group: 'File',
      key: 'Last Modified',
      value: new Date(result.lastModified).toLocaleString(),
      rawValue: result.lastModifiedInput,
      editable: true,
    }
  );

  try {
    if (detectedFormat === 'jpg') {
      await inspectJpeg(bytes, result);
    } else if (detectedFormat === 'png') {
      await inspectPng(bytes, result);
    } else if (detectedFormat === 'webp') {
      await inspectWebp(bytes, result);
    } else if (detectedFormat === 'bmp') {
      inspectBmp(bytes, result);
    } else if (detectedFormat === 'ico') {
      inspectIco(bytes, result);
    } else if (detectedFormat === 'ppm') {
      inspectPpm(bytes, result);
    } else if (detectedFormat === 'tiff') {
      const exif = parseExifTiffBytes(bytes);
      mergeParsedExif(exif, result, 'TIFF');
    } else if (detectedFormat === 'pdf') {
      await inspectPdf(bytes, result);
    } else if (['docx', 'xlsx', 'pptx'].includes(detectedFormat)) {
      await inspectOffice(bytes, result);
    } else if (['mp4', 'mov', 'm4a'].includes(detectedFormat)) {
      inspectIsoBmff(bytes, result);
    } else if (['html', 'svg', 'xml'].includes(detectedFormat)) {
      inspectTextMarkup(readUtf8(bytes), detectedFormat, result);
    }
  } catch (err) {
    console.warn('Metadata inspection notice:', err);
  }

  return result;
}

function inspectBmp(bytes: Uint8Array, result: InspectedMetadata) {
  const info = inspectBmpHeader(bytes);
  if (!info) return;
  const compNames: Record<number, string> = {
    0: 'BI_RGB (Uncompressed)',
    1: 'BI_RLE8',
    2: 'BI_RLE4',
    3: 'BI_BITFIELDS',
  };
  result.tags.push(
    {
      id: 'bmp_dims',
      group: 'File',
      key: 'BMP Dimensions',
      value: `${info.width} × ${info.height} px (${info.topDown ? 'Top-Down' : 'Bottom-Up'})`,
      editable: false,
      readOnlyReason: 'raster_header',
    },
    {
      id: 'bmp_depth',
      group: 'File',
      key: 'BMP Color Depth',
      value: `${info.bitCount}-bit (${compNames[info.compression] || `Compression ${info.compression}`})`,
      editable: false,
      readOnlyReason: 'raster_header',
    }
  );
  if (info.xPelsPerMeter > 0 || info.yPelsPerMeter > 0) {
    const dpiX = Math.round(info.xPelsPerMeter / 39.3701);
    const dpiY = Math.round(info.yPelsPerMeter / 39.3701);
    result.tags.push({
      id: 'bmp_dpi',
      group: 'File',
      key: 'BMP Print Resolution',
      value: `${dpiX} × ${dpiY} DPI (${info.xPelsPerMeter} × ${info.yPelsPerMeter} px/m)`,
      editable: false,
      readOnlyReason: 'raster_header',
    });
  }
}

function inspectIco(bytes: Uint8Array, result: InspectedMetadata) {
  const info = inspectIcoHeader(bytes);
  if (!info) return;
  const frameLabels = info.entries.map(
    (e) => `${e.width}×${e.height} (${e.isPng ? 'PNG' : `${e.bitCount || 32}-bit DIB`})`
  );
  result.tags.push(
    {
      id: 'ico_type',
      group: 'File',
      key: 'Icon Container',
      value: `${info.type.toUpperCase()} (${info.entries.length} frames)`,
      editable: false,
      readOnlyReason: 'raster_header',
    },
    {
      id: 'ico_frames',
      group: 'File',
      key: 'ICO Directory Frames',
      value: frameLabels.join(', '),
      editable: false,
      readOnlyReason: 'raster_header',
    }
  );
}

function inspectPpm(bytes: Uint8Array, result: InspectedMetadata) {
  const info = parsePpmHeader(bytes);
  if (!info) return;
  const variantLabel =
    info.magic === 'P6'
      ? 'P6 (Binary RGB)'
      : info.magic === 'P3'
      ? 'P3 (ASCII RGB)'
      : info.magic === 'P5'
      ? 'P5 (Binary Grayscale)'
      : info.magic === 'P2'
      ? 'P2 (ASCII Grayscale)'
      : `${info.magic} (Netpbm Bitmap)`;
  result.tags.push(
    {
      id: 'ppm_magic',
      group: 'File',
      key: 'Netpbm Format Variant',
      value: variantLabel,
      editable: false,
      readOnlyReason: 'raster_header',
    },
    {
      id: 'ppm_dims',
      group: 'File',
      key: 'PPM Dimensions',
      value: `${info.width} × ${info.height} px`,
      editable: false,
      readOnlyReason: 'raster_header',
    },
    {
      id: 'ppm_maxval',
      group: 'File',
      key: 'PPM Max Sample Value',
      value: String(info.maxval),
      editable: false,
      readOnlyReason: 'raster_header',
    }
  );
  if (info.comments.length > 0) {
    result.documentMeta.description = info.comments.join(' / ');
    info.comments.forEach((comment, idx) => {
      result.tags.push({
        id: `ppm_comment_${idx}`,
        group: 'File',
        key: `PPM Header Comment #${idx + 1}`,
        value: comment,
        rawValue: comment,
        editable: true,
        deletable: true,
      });
    });
  }
}

function mergeParsedExif(exif: ParsedExifData, result: InspectedMetadata, sourceLabel: string) {
  result.tags.push(...exif.tags);
  result.rawExifEntries = [...(result.rawExifEntries || []), ...exif.rawEntries];
  if (exif.make) result.documentMeta.cameraMake = exif.make;
  if (exif.model) result.documentMeta.cameraModel = exif.model;
  if (exif.software) result.documentMeta.software = exif.software;
  if (exif.artist) result.documentMeta.author = exif.artist;
  if (exif.copyright) result.documentMeta.copyright = exif.copyright;
  if (exif.description) result.documentMeta.description = exif.description;
  if (exif.orientation) result.orientation = exif.orientation;
  if (exif.dateTimeOriginal) result.embeddedDates.original = exif.dateTimeOriginal;
  if (exif.dateTimeDigitized) result.embeddedDates.digitized = exif.dateTimeDigitized;
  if (exif.dateTime) result.embeddedDates.modified = exif.dateTime;
  if (exif.gps && (exif.gps.latitude !== undefined || exif.gps.longitude !== undefined)) {
    result.gps = {
      found: true,
      latitude: exif.gps.latitude,
      longitude: exif.gps.longitude,
      altitude: exif.gps.altitude,
      timestamp: exif.gps.timestamp,
      source: sourceLabel,
    };
  }
}

async function inspectJpeg(bytes: Uint8Array, result: InspectedMetadata) {
  let offset = 2;
  const app11Buffers: Uint8Array[] = [];

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) break;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break; // EOI or SOS
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;

    if (offset + 2 > bytes.length) break;
    const segLen = readUint16(bytes, offset, false);
    if (segLen < 2 || offset + segLen > bytes.length) break;
    const segData = bytes.subarray(offset + 2, offset + segLen);

    if (marker === 0xe1) {
      if (segData.length >= 6 && readAscii(segData, 0, 4) === 'Exif' && segData[4] === 0 && segData[5] === 0) {
        const exif = parseExifTiffBytes(segData.subarray(6));
        mergeParsedExif(exif, result, 'JPEG EXIF');
      } else {
        const prefix = readAscii(segData, 0, 29);
        if (prefix.startsWith('http://ns.adobe.com/xap/1.0/')) {
          const xmp = readUtf8(segData.subarray(29));
          parseXmpXml(xmp, result);
        }
      }
    } else if (marker === 0xeb) {
      if (segData.length > 8 && readAscii(segData, 0, 2) === 'JP') {
        app11Buffers.push(segData.subarray(8));
      } else {
        app11Buffers.push(segData);
      }
    } else if (marker === 0xed) {
      const asciiPreview = extractPrintableAsciiStrings(segData).slice(0, 12).join(' | ');
      result.tags.push({
        id: `jpeg_app13_${offset}`,
        group: 'EXIF',
        key: 'Photoshop / IPTC (APP13)',
        value: asciiPreview ? `${segData.length} bytes (${asciiPreview})` : `${segData.length} bytes`,
        rawValue: asciiPreview || '',
        editable: true,
        deletable: true,
        metaRef: { marker: 0xed, offset },
      });
    } else if (marker === 0xfe) {
      const comment = readUtf8(segData).trim();
      if (comment) {
        result.tags.push({
          id: `jpeg_com_${offset}`,
          group: 'EXIF',
          key: 'JPEG Comment (COM)',
          value: comment.slice(0, 200),
          rawValue: comment,
          editable: true,
          deletable: true,
          metaRef: { marker: 0xfe, offset },
        });
      }
    }

    offset += segLen;
  }

  if (app11Buffers.length > 0) {
    const total = app11Buffers.reduce((s, b) => s + b.length, 0);
    const combined = new Uint8Array(total);
    let p = 0;
    for (const b of app11Buffers) {
      combined.set(b, p);
      p += b.length;
    }
    parseJumbfC2paPayload(combined, 'JPEG APP11 JUMBF', result.c2pa, result.tags);
  }
}

async function tryInflatePngZlib(compressed: Uint8Array): Promise<string | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const ds = new DecompressionStream('deflate');
    const copy = new Uint8Array(compressed.byteLength);
    copy.set(compressed);
    const stream = new Blob([copy]).stream().pipeThrough(ds);
    const text = await new Response(stream).text();
    return text;
  } catch {
    return null;
  }
}

async function inspectPng(bytes: Uint8Array, result: InspectedMetadata) {
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const len = readUint32(bytes, offset, false);
    const type = readAscii(bytes, offset + 4, 4);
    if (offset + 12 + len > bytes.length) break;
    const data = bytes.subarray(offset + 8, offset + 8 + len);

    if (type === 'tEXt') {
      const nullIdx = data.indexOf(0);
      if (nullIdx !== -1) {
        const key = readAscii(data, 0, nullIdx);
        const val = readUtf8(data.subarray(nullIdx + 1));
        result.tags.push({
          id: `png_text_${offset}`,
          group: 'PNG',
          key: `tEXt: ${key}`,
          value: val.slice(0, 300),
          rawValue: val,
          editable: true,
          deletable: true,
          metaRef: { chunkType: 'tEXt', key, offset },
        });
        applyPngTextToDocMeta(key, val, result);
      }
    } else if (type === 'iTXt') {
      const nullIdx = data.indexOf(0);
      if (nullIdx !== -1) {
        const key = readAscii(data, 0, nullIdx);
        const compFlag = data[nullIdx + 1];
        let cursor = nullIdx + 3;
        while (cursor < data.length && data[cursor] !== 0) cursor++;
        cursor++;
        while (cursor < data.length && data[cursor] !== 0) cursor++;
        cursor++;
        const rawSlice = data.subarray(cursor);
        let textVal = compFlag === 0 ? readUtf8(rawSlice) : (await tryInflatePngZlib(rawSlice)) || `(compressed ${len} bytes)`;
        if (key === 'XML:com.adobe.xmp' && !textVal.startsWith('(compressed')) {
          parseXmpXml(textVal, result);
        } else {
          result.tags.push({
            id: `png_itxt_${offset}`,
            group: 'PNG',
            key: `iTXt: ${key}`,
            value: textVal.slice(0, 300),
            rawValue: textVal,
            editable: true,
            deletable: true,
            metaRef: { chunkType: 'iTXt', key, offset },
          });
          applyPngTextToDocMeta(key, textVal, result);
        }
      }
    } else if (type === 'zTXt') {
      const nullIdx = data.indexOf(0);
      const key = nullIdx !== -1 ? readAscii(data, 0, nullIdx) : 'zTXt';
      const compressedPayload = nullIdx !== -1 && nullIdx + 2 < data.length ? data.subarray(nullIdx + 2) : new Uint8Array(0);
      const inflated = compressedPayload.length > 0 ? await tryInflatePngZlib(compressedPayload) : null;
      const displayVal = inflated !== null ? inflated : `(compressed ${len} bytes)`;
      result.tags.push({
        id: `png_ztxt_${offset}`,
        group: 'PNG',
        key: `zTXt: ${key}`,
        value: displayVal.slice(0, 300),
        rawValue: displayVal,
        editable: true,
        deletable: true,
        metaRef: { chunkType: 'zTXt', key, offset },
      });
      if (inflated !== null) applyPngTextToDocMeta(key, inflated, result);
    } else if (type === 'tIME' && data.length >= 7) {
      const y = readUint16(data, 0, false);
      const m = String(data[2]).padStart(2, '0');
      const d = String(data[3]).padStart(2, '0');
      const hh = String(data[4]).padStart(2, '0');
      const mm = String(data[5]).padStart(2, '0');
      const ss = String(data[6]).padStart(2, '0');
      const timeStr = `${y}:${m}:${d} ${hh}:${mm}:${ss}`;
      if (!result.embeddedDates.modified) result.embeddedDates.modified = timeStr;
      result.tags.push({
        id: `png_time_${offset}`,
        group: 'PNG',
        key: 'tIME (ModifyDate)',
        value: timeStr,
        rawValue: `${y}-${m}-${d} ${hh}:${mm}:${ss}`,
        editable: true,
        deletable: true,
        metaRef: { chunkType: 'tIME', offset },
      });
    } else if (type === 'eXIf') {
      const exif = parseExifTiffBytes(data);
      mergeParsedExif(exif, result, 'PNG eXIf');
    } else if (type === 'caBX' || type === 'juMB') {
      parseJumbfC2paPayload(data, `PNG ${type}`, result.c2pa, result.tags);
    }

    offset += 12 + len;
    if (type === 'IEND') break;
  }
}

function applyPngTextToDocMeta(key: string, val: string, result: InspectedMetadata) {
  const k = key.toLowerCase();
  if (k === 'author' && !result.documentMeta.author) result.documentMeta.author = val;
  if (k === 'title' && !result.documentMeta.title) result.documentMeta.title = val;
  if (k === 'description' && !result.documentMeta.description) result.documentMeta.description = val;
  if (k === 'copyright' && !result.documentMeta.copyright) result.documentMeta.copyright = val;
  if (k === 'software' && !result.documentMeta.software) result.documentMeta.software = val;
  if (k === 'creation time' && !result.embeddedDates.created) result.embeddedDates.created = val;
}

async function inspectWebp(bytes: Uint8Array, result: InspectedMetadata) {
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkId = readAscii(bytes, offset, 4);
    const chunkSize = readUint32(bytes, offset + 4, true);
    const dataStart = offset + 8;
    const dataEnd = Math.min(bytes.length, dataStart + chunkSize);
    const data = bytes.subarray(dataStart, dataEnd);

    if (chunkId === 'EXIF') {
      const tiffStart = readAscii(data, 0, 4) === 'Exif' ? 6 : 0;
      const exif = parseExifTiffBytes(data.subarray(tiffStart));
      mergeParsedExif(exif, result, 'WebP EXIF');
    } else if (chunkId === 'XMP ') {
      parseXmpXml(readUtf8(data), result);
    } else if (chunkId === 'C2PA' || chunkId === 'JUMB') {
      parseJumbfC2paPayload(data, `WebP ${chunkId}`, result.c2pa, result.tags);
    }

    offset += 8 + chunkSize + (chunkSize % 2);
  }
}

async function inspectPdf(bytes: Uint8Array, result: InspectedMetadata) {
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const title = pdfDoc.getTitle();
  const author = pdfDoc.getAuthor();
  const subject = pdfDoc.getSubject();
  const keywords = pdfDoc.getKeywords();
  const creator = pdfDoc.getCreator();
  const producer = pdfDoc.getProducer();
  const cDate = pdfDoc.getCreationDate();
  const mDate = pdfDoc.getModificationDate();

  if (title) {
    result.documentMeta.title = title;
    result.tags.push({ id: 'pdf_title', group: 'PDF', key: 'Title', value: title, rawValue: title, editable: true, deletable: true });
  }
  if (author) {
    result.documentMeta.author = author;
    result.tags.push({ id: 'pdf_author', group: 'PDF', key: 'Author', value: author, rawValue: author, editable: true, deletable: true });
  }
  if (subject) {
    result.documentMeta.subject = subject;
    result.tags.push({ id: 'pdf_subject', group: 'PDF', key: 'Subject', value: subject, rawValue: subject, editable: true, deletable: true });
  }
  if (keywords) {
    result.documentMeta.keywords = keywords;
    result.tags.push({ id: 'pdf_keywords', group: 'PDF', key: 'Keywords', value: keywords, rawValue: keywords, editable: true, deletable: true });
  }
  if (creator) {
    result.documentMeta.software = creator;
    result.tags.push({ id: 'pdf_creator', group: 'PDF', key: 'Creator', value: creator, rawValue: creator, editable: true, deletable: true });
  }
  if (producer) {
    result.tags.push({ id: 'pdf_producer', group: 'PDF', key: 'Producer', value: producer, rawValue: producer, editable: true, deletable: true });
  }
  if (cDate) {
    result.embeddedDates.created = cDate.toISOString();
    result.tags.push({ id: 'pdf_cdate', group: 'PDF', key: 'CreationDate', value: cDate.toLocaleString(), rawValue: cDate.toISOString(), editable: true, deletable: true });
  }
  if (mDate) {
    result.embeddedDates.modified = mDate.toISOString();
    result.tags.push({ id: 'pdf_mdate', group: 'PDF', key: 'ModDate', value: mDate.toLocaleString(), rawValue: mDate.toISOString(), editable: true, deletable: true });
  }

  // Inspect any custom keys in PDF Info dictionary
  try {
    const infoDict = pdfDoc.context.lookup(pdfDoc.context.trailerInfo.Info) as any;
    const stdKeys = new Set(['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate']);
    if (infoDict && typeof infoDict.entries === 'function') {
      for (const [kObj, vObj] of infoDict.entries()) {
        const keyName = kObj?.asString?.().replace(/^\//, '') || String(kObj).replace(/^\//, '');
        if (!keyName || stdKeys.has(keyName)) continue;
        const resolved = pdfDoc.context.lookup(vObj) as any;
        const strVal =
          typeof resolved?.decodeText === 'function'
            ? resolved.decodeText()
            : typeof resolved?.asString === 'function'
            ? resolved.asString()
            : String(resolved ?? '');
        result.tags.push({
          id: `pdf_custom_${keyName}`,
          group: 'PDF',
          key: keyName,
          value: strVal,
          rawValue: strVal,
          editable: true,
          deletable: true,
          metaRef: { pdfCustomKey: keyName },
        });
      }
    }
  } catch {
    // Non-standard Info dict
  }

  // Scan raw PDF bytes for XMP and C2PA JUMBF markers
  const rawSlice = readUtf8(bytes.subarray(0, Math.min(bytes.length, 4_000_000)));
  const xmpMatch = rawSlice.match(/<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/);
  if (xmpMatch) {
    parseXmpXml(xmpMatch[0], result);
  }

  // Check XMP metadata stream in catalog
  if (pdfDoc.catalog.has(PDFName.of('Metadata'))) {
    const xmpContent = result.rawXmpText || 'Present';
    result.tags.push({
      id: 'pdf_xmp_stream',
      group: 'XMP',
      key: 'Catalog XMP Metadata Stream',
      value: xmpContent === 'Present' ? 'Present' : `${xmpContent.length} chars XMP XML`,
      rawValue: xmpContent,
      editable: true,
      deletable: true,
    });
  }

  if (rawSlice.includes('c2pa') || rawSlice.includes('jumb')) {
    const idx = rawSlice.indexOf('jumb');
    if (idx !== -1) {
      parseJumbfC2paPayload(bytes.subarray(Math.max(0, idx - 4), Math.min(bytes.length, idx + 65536)), 'PDF Stream', result.c2pa, result.tags);
    }
  }
}

async function inspectOffice(bytes: Uint8Array, result: InspectedMetadata) {
  const zip = await JSZip.loadAsync(bytes);
  const coreXmlFile = zip.file('docProps/core.xml');
  const appXmlFile = zip.file('docProps/app.xml');
  const customXmlFile = zip.file('docProps/custom.xml');

  const parser = new DOMParser();

  if (coreXmlFile) {
    const coreXml = await coreXmlFile.async('string');
    const doc = parser.parseFromString(coreXml, 'application/xml');
    const getText = (localName: string) => {
      const els = doc.getElementsByTagName('*');
      for (let i = 0; i < els.length; i++) {
        if (els[i].localName === localName) return els[i].textContent?.trim() || undefined;
      }
      return undefined;
    };

    const title = getText('title');
    const subject = getText('subject');
    const creator = getText('creator');
    const keywords = getText('keywords');
    const description = getText('description');
    const lastModifiedBy = getText('lastModifiedBy');
    const created = getText('created');
    const modified = getText('modified');
    const category = getText('category');
    const revision = getText('revision');

    if (title) {
      result.documentMeta.title = title;
      result.tags.push({ id: 'office_title', group: 'Office', key: 'Title', value: title, rawValue: title, editable: true, deletable: true });
    }
    if (subject) {
      result.documentMeta.subject = subject;
      result.tags.push({ id: 'office_subject', group: 'Office', key: 'Subject', value: subject, rawValue: subject, editable: true, deletable: true });
    }
    if (creator) {
      result.documentMeta.author = creator;
      result.tags.push({ id: 'office_creator', group: 'Office', key: 'Creator (Author)', value: creator, rawValue: creator, editable: true, deletable: true });
    }
    if (lastModifiedBy) {
      result.tags.push({ id: 'office_lastModifiedBy', group: 'Office', key: 'Last Modified By', value: lastModifiedBy, rawValue: lastModifiedBy, editable: true, deletable: true });
    }
    if (keywords) {
      result.documentMeta.keywords = keywords;
      result.tags.push({ id: 'office_keywords', group: 'Office', key: 'Keywords', value: keywords, rawValue: keywords, editable: true, deletable: true });
    }
    if (description) {
      result.documentMeta.description = description;
      result.tags.push({ id: 'office_description', group: 'Office', key: 'Description', value: description, rawValue: description, editable: true, deletable: true });
    }
    if (category) {
      result.tags.push({ id: 'office_category', group: 'Office', key: 'Category', value: category, rawValue: category, editable: true, deletable: true });
    }
    if (revision) {
      result.tags.push({ id: 'office_revision', group: 'Office', key: 'Revision', value: revision, rawValue: revision, editable: true, deletable: true });
    }
    if (created) {
      result.embeddedDates.created = created;
      result.tags.push({ id: 'office_created', group: 'Office', key: 'dcterms:created', value: created, rawValue: created, editable: true, deletable: true });
    }
    if (modified) {
      result.embeddedDates.modified = modified;
      result.tags.push({ id: 'office_modified', group: 'Office', key: 'dcterms:modified', value: modified, rawValue: modified, editable: true, deletable: true });
    }
  }

  if (appXmlFile) {
    const appXml = await appXmlFile.async('string');
    const doc = parser.parseFromString(appXml, 'application/xml');
    const getAppText = (localName: string) => {
      const els = doc.getElementsByTagName('*');
      for (let i = 0; i < els.length; i++) {
        if (els[i].localName === localName) return els[i].textContent?.trim() || undefined;
      }
      return undefined;
    };
    const appName = getAppText('Application');
    const company = getAppText('Company');
    const manager = getAppText('Manager');
    if (appName) {
      result.documentMeta.software = appName;
      result.tags.push({ id: 'office_app', group: 'Office', key: 'Application', value: appName, rawValue: appName, editable: true, deletable: true });
    }
    if (company) {
      result.documentMeta.company = company;
      result.tags.push({ id: 'office_company', group: 'Office', key: 'Company', value: company, rawValue: company, editable: true, deletable: true });
    }
    if (manager) {
      result.tags.push({ id: 'office_manager', group: 'Office', key: 'Manager', value: manager, rawValue: manager, editable: true, deletable: true });
    }
  }

  if (customXmlFile) {
    const customXml = await customXmlFile.async('string');
    const doc = parser.parseFromString(customXml, 'application/xml');
    const propEls = doc.getElementsByTagName('property');
    if (propEls.length > 0) {
      for (let i = 0; i < propEls.length; i++) {
        const el = propEls[i];
        const pName = el.getAttribute('name') || `CustomProperty_${i + 1}`;
        const pVal = el.textContent?.trim() || '';
        result.tags.push({
          id: `office_custom_prop_${pName}`,
          group: 'Office',
          key: `Custom: ${pName}`,
          value: pVal,
          rawValue: pVal,
          editable: true,
          deletable: true,
          metaRef: { customPropName: pName },
        });
      }
    } else {
      result.tags.push({
        id: 'office_custom_xml',
        group: 'Office',
        key: 'docProps/custom.xml',
        value: 'Present',
        rawValue: customXml,
        editable: true,
        deletable: true,
      });
    }
  }
}

const ILST_ATOM_LABELS: Record<string, string> = {
  '\xa9nam': 'Media Title (©nam)',
  '\xa9ART': 'Artist (©ART)',
  '\xa9day': 'Release / Capture Date (©day)',
  '\xa9too': 'Encoding Tool (©too)',
  '\xa9cmt': 'Comment (©cmt)',
  '\xa9alb': 'Album (©alb)',
  '\xa9gen': 'Genre (©gen)',
  'aART': 'Album Artist (aART)',
  'desc': 'Description (desc)',
};

function inspectIsoBmff(bytes: Uint8Array, result: InspectedMetadata) {
  const macEpochOffset = 2082844800; // Seconds between 1904-01-01 and 1970-01-01
  const walkBoxes = (start: number, end: number, depth: number, inIlst = false) => {
    if (depth > 6) return;
    let offset = start;
    while (offset + 8 <= end) {
      let size = readUint32(bytes, offset, false);
      const typeBytes = bytes.subarray(offset + 4, offset + 8);
      const type = String.fromCharCode(typeBytes[0], typeBytes[1], typeBytes[2], typeBytes[3]);
      let headerSize = 8;
      if (size === 1 && offset + 16 <= end) {
        const hi = readUint32(bytes, offset + 8, false);
        const lo = readUint32(bytes, offset + 12, false);
        size = hi * 4294967296 + lo;
        headerSize = 16;
      } else if (size === 0) {
        size = end - offset;
      }
      if (size < headerSize || offset + size > end) break;

      const bodyStart = offset + headerSize;
      const bodyEnd = offset + size;

      if (inIlst) {
        // Walk inside iTunes atom to find 'data' box
        let innerOff = bodyStart;
        while (innerOff + 16 <= bodyEnd) {
          const iSize = readUint32(bytes, innerOff, false);
          const iType = readAscii(bytes, innerOff + 4, 4);
          if (iSize < 16 || innerOff + iSize > bodyEnd) break;
          if (iType === 'data') {
            const typeInd = readUint32(bytes, innerOff + 8, false);
            if (typeInd === 1 || typeInd === 0) {
              const txt = readUtf8(bytes.subarray(innerOff + 16, innerOff + iSize)).replace(/\0+$/, '').trim();
              if (txt) {
                const label = ILST_ATOM_LABELS[type] || `iTunes Atom (${type})`;
                result.tags.push({
                  id: `mp4_ilst_${offset}`,
                  group: 'ISO-BMFF',
                  key: label,
                  value: txt,
                  rawValue: txt,
                  editable: true,
                  deletable: true,
                  metaRef: { boxOffset: offset, boxSize: size, dataPayloadStart: innerOff + 16, dataPayloadLen: iSize - 16 },
                });
                if (type === '\xa9nam' || type === '©nam') result.documentMeta.title = result.documentMeta.title || txt;
                if (type === '\xa9ART' || type === '©ART') result.documentMeta.author = result.documentMeta.author || txt;
                if (type === '\xa9too' || type === '©too') result.documentMeta.software = result.documentMeta.software || txt;
              }
            }
          }
          innerOff += iSize;
        }
      } else if (type === 'mvhd' && bodyStart + 20 <= bodyEnd) {
        const version = bytes[bodyStart];
        let cSec = 0;
        let mSec = 0;
        if (version === 0 && bodyStart + 12 <= bodyEnd) {
          cSec = readUint32(bytes, bodyStart + 4, false);
          mSec = readUint32(bytes, bodyStart + 8, false);
        } else if (version === 1 && bodyStart + 20 <= bodyEnd) {
          cSec = readUint32(bytes, bodyStart + 8, false);
          mSec = readUint32(bytes, bodyStart + 16, false);
        }
        if (cSec > macEpochOffset) {
          const iso = new Date((cSec - macEpochOffset) * 1000).toISOString();
          result.embeddedDates.created = iso;
          result.tags.push({
            id: `mp4_mvhd_c_${offset}`,
            group: 'ISO-BMFF',
            key: 'mvhd CreationTime',
            value: new Date(iso).toLocaleString(),
            rawValue: iso,
            editable: true,
            deletable: true,
          });
        }
        if (mSec > macEpochOffset) {
          const iso = new Date((mSec - macEpochOffset) * 1000).toISOString();
          result.embeddedDates.modified = iso;
          result.tags.push({
            id: `mp4_mvhd_m_${offset}`,
            group: 'ISO-BMFF',
            key: 'mvhd ModificationTime',
            value: new Date(iso).toLocaleString(),
            rawValue: iso,
            editable: true,
            deletable: true,
          });
        }
      } else if (type === 'uuid' && bodyStart + 16 <= bodyEnd) {
        const uuidHex = Array.from(bytes.subarray(bodyStart, bodyStart + 16))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        if (uuidHex === 'd8fec3d61b0e483c92975828877ec481') {
          parseJumbfC2paPayload(bytes.subarray(bodyStart + 16, bodyEnd), 'MP4 uuid (C2PA)', result.c2pa, result.tags);
        } else if (uuidHex === 'be7acfcb97a942e89c71999491e3afac') {
          parseXmpXml(readUtf8(bytes.subarray(bodyStart + 16, bodyEnd)), result);
        }
      } else if (type === 'jumb' || type === 'c2pa') {
        parseJumbfC2paPayload(bytes.subarray(offset, bodyEnd), `MP4 ${type}`, result.c2pa, result.tags);
      } else if (type === '©xyz' || type === '\xa9xyz') {
        const gpsStr = readUtf8(bytes.subarray(bodyStart + 4, bodyEnd)).trim();
        const m = gpsStr.match(/([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/);
        if (m) {
          result.gps = {
            found: true,
            latitude: parseFloat(m[1]),
            longitude: parseFloat(m[2]),
            source: 'MP4 ©xyz',
          };
          result.tags.push({
            id: `mp4_xyz_${offset}`,
            group: 'GPS',
            key: 'QuickTime GPS (©xyz)',
            value: gpsStr,
            rawValue: gpsStr,
            editable: true,
            deletable: true,
          });
        }
      } else if (type === 'ilst') {
        walkBoxes(bodyStart, bodyEnd, depth + 1, true);
      } else if (['moov', 'udta', 'trak', 'mdia'].includes(type)) {
        walkBoxes(bodyStart, bodyEnd, depth + 1, false);
      } else if (type === 'meta' && bodyStart + 4 < bodyEnd) {
        walkBoxes(bodyStart + 4, bodyEnd, depth + 1, false);
      }

      offset += size;
    }
  };
  walkBoxes(0, bytes.length, 0, false);
}

function inspectTextMarkup(text: string, format: string, result: InspectedMetadata) {
  const titleMatch = text.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch) {
    result.documentMeta.title = titleMatch[1].trim();
    result.tags.push({
      id: 'markup_title',
      group: 'HTML/SVG',
      key: '<title>',
      value: result.documentMeta.title,
      rawValue: result.documentMeta.title,
      editable: true,
      deletable: true,
    });
  }
  const metaRegex = /<meta\s+[^>]*name=["']([^"']+)["'][^>]*content=["']([^"']*)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = metaRegex.exec(text)) !== null) {
    const name = m[1].toLowerCase();
    const val = m[2];
    result.tags.push({
      id: `markup_meta_${name}`,
      group: 'HTML/SVG',
      key: `meta:${m[1]}`,
      value: val,
      rawValue: val,
      editable: true,
      deletable: true,
    });
    if (name === 'author') result.documentMeta.author = val;
    if (name === 'description') result.documentMeta.description = val;
    if (name === 'keywords') result.documentMeta.keywords = val;
    if (name === 'generator') result.documentMeta.software = val;
    if (name === 'date') result.embeddedDates.created = val;
    if (name === 'geo.position' || name === 'icbm') {
      const coords = val.split(/[;,]/).map((s) => parseFloat(s.trim()));
      if (coords.length >= 2 && !isNaN(coords[0]) && !isNaN(coords[1])) {
        result.gps = { found: true, latitude: coords[0], longitude: coords[1], source: `${format.toUpperCase()} meta` };
      }
    }
  }
  const xmpMatch = text.match(/<x:xmpmeta[\s\S]*?<\/x:xmpmeta>|<rdf:RDF[\s\S]*?<\/rdf:RDF>/i);
  if (xmpMatch) {
    parseXmpXml(xmpMatch[0], result);
  }
}

// ---------- Editors / Scrubbers ----------

export async function applyMetadataChanges(
  file: File,
  inspected: InspectedMetadata,
  opts: MetadataEditOptions
): Promise<MetadataEditResult> {
  const buf = await file.arrayBuffer();
  let bytes = new Uint8Array(buf);
  const changesApplied: string[] = [];

  // 1. Filename & Extension (respect per-tag overrides if editedTags contains file_name / file_ext)
  const rawBase = opts.editedTags?.['file_name'] ?? opts.newBaseName ?? inspected.baseName ?? 'file';
  const rawExt = opts.editedTags?.['file_ext'] ?? opts.newExtension ?? inspected.nameExtension ?? '';
  const cleanBase = (rawBase || 'file').replace(/[\\/:*?"<>|]/g, '_');
  const cleanExt = rawExt.trim().replace(/^\.+/, '').replace(/[\\/:*?"<>|]/g, '');
  const finalName = cleanExt ? `${cleanBase}.${cleanExt}` : cleanBase;
  if (finalName !== file.name) {
    changesApplied.push(`ファイル名変更: ${finalName}`);
  }

  // 2. Last Modified Timestamp
  let finalLastModified = file.lastModified || Date.now();
  if (opts.lastModifiedAction === 'set' && opts.newLastModified) {
    finalLastModified = opts.newLastModified;
    changesApplied.push(`更新日時変更: ${new Date(finalLastModified).toLocaleString()}`);
  } else if (opts.lastModifiedAction === 'reset') {
    finalLastModified = new Date('2000-01-01T00:00:00.000Z').getTime();
    changesApplied.push('更新日時リセット (2000-01-01)');
  } else if (opts.editedTags?.['file_mtime']) {
    const parsedMtime = new Date(opts.editedTags['file_mtime']).getTime();
    if (!isNaN(parsedMtime)) {
      finalLastModified = parsedMtime;
      changesApplied.push(`更新日時変更: ${new Date(finalLastModified).toLocaleString()}`);
    }
  }

  // 3. Binary / Container Metadata Editing
  const fmt = inspected.detectedFormat;
  if (fmt === 'jpg') {
    bytes = editJpegBytes(bytes, inspected, opts, changesApplied);
  } else if (fmt === 'png') {
    bytes = editPngBytes(bytes, inspected, opts, changesApplied);
  } else if (fmt === 'webp') {
    bytes = editWebpBytes(bytes, inspected, opts, changesApplied);
  } else if (fmt === 'pdf') {
    bytes = await editPdfBytes(bytes, inspected, opts, changesApplied);
  } else if (['docx', 'xlsx', 'pptx'].includes(fmt)) {
    bytes = await editOfficeBytes(bytes, inspected, opts, changesApplied);
  } else if (['mp4', 'mov', 'm4a'].includes(fmt)) {
    bytes = editIsoBmffBytes(bytes, inspected, opts, changesApplied);
  } else if (['html', 'svg', 'xml'].includes(fmt)) {
    bytes = editTextMarkupBytes(bytes, inspected, opts, changesApplied);
  } else if (fmt === 'ppm') {
    bytes = editPpmBytes(bytes, inspected, opts, changesApplied);
  }

  const outMime = file.type || inspected.detectedMime || 'application/octet-stream';
  const blob = new Blob([bytes], { type: outMime });
  const outFile = new File([blob], finalName, { type: outMime, lastModified: finalLastModified });

  return {
    file: outFile,
    blob,
    fileName: finalName,
    lastModified: finalLastModified,
    changesApplied,
  };
}

function hasAnyEditedKey(opts: MetadataEditOptions, prefixes: string[]): boolean {
  const keys = Object.keys(opts.editedTags || {});
  return keys.some((k) => prefixes.some((p) => k.startsWith(p)));
}

function hasAnyDeletedKey(opts: MetadataEditOptions, prefixes: string[]): boolean {
  if (!opts.deletedTagIds || opts.deletedTagIds.size === 0) return false;
  return Array.from(opts.deletedTagIds).some((id) => prefixes.some((p) => id.startsWith(p)));
}

function buildUpdatedExifTiffBytes(inspected: InspectedMetadata, opts: MetadataEditOptions): Uint8Array | null {
  if (opts.scrubAllMetadata) {
    const orientVal = opts.editedTags?.['exif_112'] !== undefined
      ? parseInt(opts.editedTags['exif_112'], 10)
      : inspected.orientation;
    if (opts.preserveIccAndOrientation && orientVal && orientVal !== 1) {
      return buildExifTiffBytes({ orientation: orientVal });
    }
    return null;
  }

  const rawEntries = inspected.rawExifEntries || [];
  if (rawEntries.length === 0) {
    // Fallback builder when no raw TIFF directory was previously present (e.g. adding EXIF/GPS to PNG/WebP/JPG)
    const input: ExifBuildInput = {};
    const dm = inspected.documentMeta;
    if (opts.preserveIccAndOrientation && inspected.orientation) input.orientation = inspected.orientation;
    if (opts.docMetaAction === 'keep') {
      if (dm.cameraMake) input.make = dm.cameraMake;
      if (dm.cameraModel) input.model = dm.cameraModel;
      if (dm.software) input.software = dm.software;
      if (dm.author) input.artist = dm.author;
      if (dm.copyright) input.copyright = dm.copyright;
      if (dm.description) input.description = dm.description;
    } else if (opts.docMetaAction === 'set' && opts.newDocMeta) {
      if (dm.cameraMake) input.make = dm.cameraMake;
      if (dm.cameraModel) input.model = dm.cameraModel;
      if (opts.newDocMeta.software) input.software = opts.newDocMeta.software;
      if (opts.newDocMeta.author) input.artist = opts.newDocMeta.author;
      if (opts.newDocMeta.copyright) input.copyright = opts.newDocMeta.copyright;
      if (opts.newDocMeta.description) input.description = opts.newDocMeta.description;
    }
    if (opts.embeddedDateAction === 'keep') {
      if (inspected.embeddedDates.modified) input.dateTime = inspected.embeddedDates.modified;
      if (inspected.embeddedDates.original) input.dateTimeOriginal = inspected.embeddedDates.original;
      if (inspected.embeddedDates.digitized) input.dateTimeDigitized = inspected.embeddedDates.digitized;
    } else if (opts.embeddedDateAction === 'set' && opts.newEmbeddedDate) {
      const exifDt = dateTimeLocalToExifDate(opts.newEmbeddedDate);
      input.dateTime = exifDt;
      input.dateTimeOriginal = exifDt;
      input.dateTimeDigitized = exifDt;
    }
    if (opts.gpsAction === 'keep' && inspected.gps.found && inspected.gps.latitude !== undefined && inspected.gps.longitude !== undefined) {
      input.gps = { latitude: inspected.gps.latitude, longitude: inspected.gps.longitude, altitude: inspected.gps.altitude };
    } else if (opts.gpsAction === 'set' && typeof opts.newLatitude === 'number' && typeof opts.newLongitude === 'number' && !isNaN(opts.newLatitude) && !isNaN(opts.newLongitude)) {
      input.gps = { latitude: opts.newLatitude, longitude: opts.newLongitude, altitude: opts.newAltitude };
    }
    return buildExifTiffBytes(input);
  }

  // Start from preserved raw IFD entries so ALL untouched tags (LensModel, ExposureTime, ISO, etc.) are preserved
  const ifd0: RawIfdEntry[] = [];
  const exifIfd: RawIfdEntry[] = [];
  const gpsIfd: RawIfdEntry[] = [];

  const personalDocTags = new Set([0x010e, 0x0131, 0x013b, 0x8298, 0x9286, 0xa430]);
  const dateTags = new Set([0x0132, 0x9003, 0x9004, 0x9010, 0x9011]);

  for (const raw of rawEntries) {
    if (opts.deletedTagIds?.has(raw.id)) continue;
    if (raw.ifd === 'gps' && opts.gpsAction === 'delete') continue;
    if (raw.ifd !== 'gps' && opts.docMetaAction === 'delete' && personalDocTags.has(raw.tag)) continue;
    if (raw.ifd !== 'gps' && opts.embeddedDateAction === 'delete' && dateTags.has(raw.tag)) continue;

    let entry: RawIfdEntry = { tag: raw.tag, type: raw.type, count: raw.count, bytes: raw.rawBytes };

    // Apply per-tag edit if user edited this specific tag ID
    if (opts.editedTags && Object.prototype.hasOwnProperty.call(opts.editedTags, raw.id)) {
      const valStr = opts.editedTags[raw.id];
      entry = encodeRawExifValueFromString(raw.tag, raw.type, valStr);
    }

    if (raw.ifd === 'ifd0') ifd0.push(entry);
    else if (raw.ifd === 'exif') exifIfd.push(entry);
    else gpsIfd.push(entry);
  }

  // Upsert section-level overrides
  const upsert = (arr: RawIfdEntry[], entry: RawIfdEntry) => {
    const idx = arr.findIndex((e) => e.tag === entry.tag);
    if (idx !== -1) arr[idx] = entry;
    else arr.push(entry);
  };

  if (opts.docMetaAction === 'set' && opts.newDocMeta) {
    if (opts.newDocMeta.description) upsert(ifd0, makeAsciiEntry(0x010e, opts.newDocMeta.description));
    if (opts.newDocMeta.software) upsert(ifd0, makeAsciiEntry(0x0131, opts.newDocMeta.software));
    if (opts.newDocMeta.author) upsert(ifd0, makeAsciiEntry(0x013b, opts.newDocMeta.author));
    if (opts.newDocMeta.copyright) upsert(ifd0, makeAsciiEntry(0x8298, opts.newDocMeta.copyright));
  }

  if (opts.embeddedDateAction === 'set' && opts.newEmbeddedDate) {
    const exifDt = dateTimeLocalToExifDate(opts.newEmbeddedDate);
    upsert(ifd0, makeAsciiEntry(0x0132, exifDt));
    upsert(exifIfd, makeAsciiEntry(0x9003, exifDt));
    upsert(exifIfd, makeAsciiEntry(0x9004, exifDt));
  }

  if (opts.gpsAction === 'set' && typeof opts.newLatitude === 'number' && typeof opts.newLongitude === 'number' && !isNaN(opts.newLatitude) && !isNaN(opts.newLongitude)) {
    upsert(gpsIfd, { tag: 0x0000, type: 1, count: 4, bytes: new Uint8Array([2, 3, 0, 0]) });
    upsert(gpsIfd, makeAsciiEntry(0x0001, opts.newLatitude >= 0 ? 'N' : 'S'));
    upsert(gpsIfd, makeRationalEntry(0x0002, decimalToDmsRationals(opts.newLatitude)));
    upsert(gpsIfd, makeAsciiEntry(0x0003, opts.newLongitude >= 0 ? 'E' : 'W'));
    upsert(gpsIfd, makeRationalEntry(0x0004, decimalToDmsRationals(opts.newLongitude)));
    if (typeof opts.newAltitude === 'number' && !isNaN(opts.newAltitude)) {
      upsert(gpsIfd, { tag: 0x0005, type: 1, count: 1, bytes: new Uint8Array([opts.newAltitude < 0 ? 1 : 0]) });
      upsert(gpsIfd, makeRationalEntry(0x0006, [[Math.round(Math.abs(opts.newAltitude) * 100), 100]]));
    }
  }

  return serializeIfdEntries(ifd0, exifIfd, gpsIfd);
}

function needsExifRewrite(opts: MetadataEditOptions): boolean {
  return (
    opts.scrubAllMetadata ||
    opts.gpsAction !== 'keep' ||
    opts.embeddedDateAction !== 'keep' ||
    opts.docMetaAction !== 'keep' ||
    hasAnyDeletedKey(opts, ['exif_', 'gps_']) ||
    hasAnyEditedKey(opts, ['exif_', 'gps_'])
  );
}

function cleanXmpString(xmp: string, opts: MetadataEditOptions, inspected?: InspectedMetadata): string | null {
  if (opts.scrubAllMetadata) return null;
  let updated = xmp;
  if (opts.gpsAction === 'delete' || opts.deletedTagIds?.has('xmp_gps')) {
    updated = updated.replace(/\s*exif:GPS[A-Za-z0-9]+=["'][^"']*["']/g, '');
    updated = updated.replace(/<exif:GPS[A-Za-z0-9]+>[\s\S]*?<\/exif:GPS[A-Za-z0-9]+>/g, '');
  }
  if (opts.c2paAction === 'delete' || opts.deletedTagIds?.has('xmp_c2pa_provenance')) {
    updated = updated.replace(/\s*[^:\s>]*:?DigitalSourceType=["'][^"']*["']/g, '');
    updated = updated.replace(/<[^:>]+:DigitalSourceType>[\s\S]*?<\/[^:>]+:DigitalSourceType>/g, '');
    updated = updated.replace(/<dcterms:provenance>[\s\S]*?<\/dcterms:provenance>/g, '');
  }
  if (opts.embeddedDateAction === 'delete') {
    updated = updated.replace(/\s*xmp:(CreateDate|ModifyDate|MetadataDate)=["'][^"']*["']/g, '');
    updated = updated.replace(/<xmp:(CreateDate|ModifyDate|MetadataDate)>[\s\S]*?<\/xmp:\1>/g, '');
  } else if (opts.embeddedDateAction === 'set' && opts.newEmbeddedDate) {
    const iso = dateTimeLocalToIso(opts.newEmbeddedDate);
    updated = updated.replace(/xmp:CreateDate=["'][^"']*["']/g, `xmp:CreateDate="${iso}"`);
    updated = updated.replace(/xmp:ModifyDate=["'][^"']*["']/g, `xmp:ModifyDate="${iso}"`);
    updated = updated.replace(/<xmp:CreateDate>[^<]*<\/xmp:CreateDate>/g, `<xmp:CreateDate>${iso}</xmp:CreateDate>`);
    updated = updated.replace(/<xmp:ModifyDate>[^<]*<\/xmp:ModifyDate>/g, `<xmp:ModifyDate>${iso}</xmp:ModifyDate>`);
  }
  if (opts.docMetaAction === 'delete') {
    updated = updated.replace(/<dc:creator>[\s\S]*?<\/dc:creator>/g, '');
    updated = updated.replace(/<dc:rights>[\s\S]*?<\/dc:rights>/g, '');
    updated = updated.replace(/\s*xmp:CreatorTool=["'][^"']*["']/g, '');
    updated = updated.replace(/<xmp:CreatorTool>[\s\S]*?<\/xmp:CreatorTool>/g, '');
  }

  // Apply per-tag XMP deletions and edits
  const xmpTags = (inspected?.tags || []).filter((t) => t.group === 'XMP' && t.id !== 'pdf_xmp_stream');
  for (const tag of xmpTags) {
    const key = tag.metaRef?.xmpKey || tag.key;
    const escKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (opts.deletedTagIds?.has(tag.id)) {
      if (tag.id === 'xmp_author') updated = updated.replace(/<dc:creator>[\s\S]*?<\/dc:creator>/g, '');
      else if (tag.id === 'xmp_title') updated = updated.replace(/<dc:title>[\s\S]*?<\/dc:title>/g, '');
      else if (tag.id === 'xmp_rights') updated = updated.replace(/<dc:rights>[\s\S]*?<\/dc:rights>/g, '');
      else {
        updated = updated.replace(new RegExp(`<${escKey}>[\\s\\S]*?<\\/${escKey}>`, 'g'), '');
        updated = updated.replace(new RegExp(`\\s*${escKey}=["'][^"']*["']`, 'g'), '');
      }
    } else if (opts.editedTags && Object.prototype.hasOwnProperty.call(opts.editedTags, tag.id)) {
      const safeVal = escapeXml(opts.editedTags[tag.id]);
      if (tag.id === 'xmp_author') {
        updated = updated.replace(/(<dc:creator>[\s\S]*?<rdf:li[^>]*>)[^<]*(<\/rdf:li>[\s\S]*?<\/dc:creator>)/g, `$1${safeVal}$2`);
      } else if (tag.id === 'xmp_title') {
        updated = updated.replace(/(<dc:title>[\s\S]*?<rdf:li[^>]*>)[^<]*(<\/rdf:li>[\s\S]*?<\/dc:title>)/g, `$1${safeVal}$2`);
      } else if (tag.id === 'xmp_rights') {
        updated = updated.replace(/(<dc:rights>[\s\S]*?<rdf:li[^>]*>)[^<]*(<\/rdf:li>[\s\S]*?<\/dc:rights>)/g, `$1${safeVal}$2`);
      } else if (tag.id === 'xmp_gps') {
        const parts = opts.editedTags[tag.id].split('/').map((s) => s.trim());
        if (parts[0]) {
          updated = updated.replace(/exif:GPSLatitude=["'][^"']*["']/g, `exif:GPSLatitude="${escapeXml(parts[0])}"`);
          updated = updated.replace(/<exif:GPSLatitude>[^<]*<\/exif:GPSLatitude>/g, `<exif:GPSLatitude>${escapeXml(parts[0])}</exif:GPSLatitude>`);
        }
        if (parts[1]) {
          updated = updated.replace(/exif:GPSLongitude=["'][^"']*["']/g, `exif:GPSLongitude="${escapeXml(parts[1])}"`);
          updated = updated.replace(/<exif:GPSLongitude>[^<]*<\/exif:GPSLongitude>/g, `<exif:GPSLongitude>${escapeXml(parts[1])}</exif:GPSLongitude>`);
        }
      } else if (tag.id === 'xmp_c2pa_provenance') {
        updated = updated.replace(/([^:\s>]*:?DigitalSourceType)=["'][^"']*["']/g, `$1="${safeVal}"`);
        updated = updated.replace(/(<[^:>]+:DigitalSourceType>)[^<]*(<\/[^:>]+:DigitalSourceType>)/g, `$1${safeVal}$2`);
      } else {
        updated = updated.replace(new RegExp(`${escKey}=["'][^"']*["']`, 'g'), `${key}="${safeVal}"`);
        updated = updated.replace(new RegExp(`<${escKey}>[^<]*<\\/${escKey}>`, 'g'), `<${key}>${safeVal}</${key}>`);
      }
    }
  }

  return updated;
}

function patchC2paPayloadInPlace(payload: Uint8Array, inspected: InspectedMetadata, opts: MetadataEditOptions): Uint8Array {
  if (!opts.editedTags) return payload;
  const c2paTag = inspected.tags.find((t) => t.group === 'C2PA' && opts.editedTags && Object.prototype.hasOwnProperty.call(opts.editedTags, t.id));
  if (!c2paTag) return payload;
  const out = new Uint8Array(payload);
  const replacement = opts.editedTags[c2paTag.id];
  const oldGen = inspected.c2pa.generator;
  if (oldGen && replacement) {
    const oldBytes = encodeUtf8(oldGen);
    const newBytes = encodeUtf8(replacement);
    for (let i = 0; i <= out.length - oldBytes.length; i++) {
      let match = true;
      for (let j = 0; j < oldBytes.length; j++) {
        if (out[i + j] !== oldBytes[j]) { match = false; break; }
      }
      if (match) {
        const writeLen = Math.min(oldBytes.length, newBytes.length);
        for (let j = 0; j < oldBytes.length; j++) {
          out[i + j] = j < writeLen ? newBytes[j] : 0x20;
        }
      }
    }
  }
  return out;
}

function editJpegBytes(
  bytes: Uint8Array,
  inspected: InspectedMetadata,
  opts: MetadataEditOptions,
  changesApplied: string[]
): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;

  const rewriteExif = needsExifRewrite(opts);
  const rewriteXmp =
    opts.gpsAction !== 'keep' ||
    opts.c2paAction === 'delete' ||
    opts.embeddedDateAction !== 'keep' ||
    opts.docMetaAction !== 'keep' ||
    hasAnyEditedKey(opts, ['xmp_']) ||
    hasAnyDeletedKey(opts, ['xmp_']);
  const c2paDeleted =
    opts.c2paAction === 'delete' ||
    opts.scrubAllMetadata ||
    hasAnyDeletedKey(opts, ['c2pa_']);
  const c2paEdited = hasAnyEditedKey(opts, ['c2pa_']);

  const chunks: Uint8Array[] = [bytes.subarray(0, 2)]; // SOI
  let exifInserted = false;
  let offset = 2;

  const insertNewExifSegment = () => {
    if (exifInserted || !rewriteExif) return;
    exifInserted = true;
    const tiffBytes = buildUpdatedExifTiffBytes(inspected, opts);
    if (!tiffBytes) return;

    const segBody = new Uint8Array(6 + tiffBytes.length);
    segBody.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 0);
    segBody.set(tiffBytes, 6);
    const seg = new Uint8Array(4 + segBody.length);
    seg[0] = 0xff;
    seg[1] = 0xe1;
    writeUint16(seg, 2, segBody.length + 2, false);
    seg.set(segBody, 4);
    chunks.push(seg);
  };

  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      chunks.push(bytes.subarray(offset));
      break;
    }
    const markerStart = offset;
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) {
      chunks.push(bytes.subarray(markerStart));
      break;
    }
    const marker = bytes[offset++];
    if (marker === 0xda) {
      insertNewExifSegment();
      chunks.push(bytes.subarray(markerStart));
      break;
    }
    if (marker === 0xd9) {
      insertNewExifSegment();
      chunks.push(bytes.subarray(markerStart));
      break;
    }
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      chunks.push(bytes.subarray(markerStart, offset));
      continue;
    }

    if (offset + 2 > bytes.length) {
      chunks.push(bytes.subarray(markerStart));
      break;
    }
    const segLen = readUint16(bytes, offset, false);
    const segEnd = offset + segLen;
    if (segLen < 2 || segEnd > bytes.length) {
      chunks.push(bytes.subarray(markerStart));
      break;
    }
    const segData = bytes.subarray(offset + 2, segEnd);

    // APP11 JUMBF / C2PA
    if (marker === 0xeb) {
      if (c2paDeleted) {
        offset = segEnd;
        continue;
      }
      if (c2paEdited) {
        const patched = patchC2paPayloadInPlace(segData, inspected, opts);
        const seg = new Uint8Array(4 + patched.length);
        seg[0] = 0xff;
        seg[1] = 0xeb;
        writeUint16(seg, 2, patched.length + 2, false);
        seg.set(patched, 4);
        chunks.push(seg);
        offset = segEnd;
        continue;
      }
    }

    // APP13 IPTC / COM
    if (marker === 0xed) {
      const app13Id = `jpeg_app13_${offset}`;
      if (opts.scrubAllMetadata || opts.deletedTagIds?.has(app13Id)) {
        offset = segEnd;
        continue;
      }
      if (opts.editedTags && Object.prototype.hasOwnProperty.call(opts.editedTags, app13Id)) {
        const body = encodeUtf8(opts.editedTags[app13Id]);
        const seg = new Uint8Array(4 + body.length);
        seg[0] = 0xff;
        seg[1] = 0xed;
        writeUint16(seg, 2, body.length + 2, false);
        seg.set(body, 4);
        chunks.push(seg);
        offset = segEnd;
        continue;
      }
    }

    if (marker === 0xfe) {
      const comId = `jpeg_com_${offset}`;
      if (opts.scrubAllMetadata || opts.deletedTagIds?.has(comId)) {
        offset = segEnd;
        continue;
      }
      if (opts.editedTags && Object.prototype.hasOwnProperty.call(opts.editedTags, comId)) {
        const body = encodeUtf8(opts.editedTags[comId]);
        const seg = new Uint8Array(4 + body.length);
        seg[0] = 0xff;
        seg[1] = 0xfe;
        writeUint16(seg, 2, body.length + 2, false);
        seg.set(body, 4);
        chunks.push(seg);
        offset = segEnd;
        continue;
      }
    }

    // APP2 ICC Profile
    if (marker === 0xe2 && opts.scrubAllMetadata && !opts.preserveIccAndOrientation) {
      offset = segEnd;
      continue;
    }

    // APP1
    if (marker === 0xe1) {
      const isExif = segData.length >= 6 && readAscii(segData, 0, 4) === 'Exif' && segData[4] === 0 && segData[5] === 0;
      const isXmp = readAscii(segData, 0, 29).startsWith('http://ns.adobe.com/xap/1.0/');

      if (isExif) {
        if (rewriteExif) {
          insertNewExifSegment();
          offset = segEnd;
          continue;
        }
      } else if (isXmp) {
        if (opts.scrubAllMetadata) {
          offset = segEnd;
          continue;
        }
        if (rewriteXmp) {
          const xmp = readUtf8(segData.subarray(29));
          const cleaned = cleanXmpString(xmp, opts, inspected);
          if (cleaned) {
            const header = encodeUtf8('http://ns.adobe.com/xap/1.0/\0');
            const body = encodeUtf8(cleaned);
            if (header.length + body.length + 2 <= 65535) {
              const seg = new Uint8Array(4 + header.length + body.length);
              seg[0] = 0xff;
              seg[1] = 0xe1;
              writeUint16(seg, 2, header.length + body.length + 2, false);
              seg.set(header, 4);
              seg.set(body, 4 + header.length);
              chunks.push(seg);
            }
          }
          offset = segEnd;
          continue;
        }
      } else if (opts.scrubAllMetadata) {
        offset = segEnd;
        continue;
      }
    }

    if (marker >= 0xe3 && marker <= 0xef && marker !== 0xee && opts.scrubAllMetadata) {
      offset = segEnd;
      continue;
    }

    chunks.push(bytes.subarray(markerStart, segEnd));
    offset = segEnd;
  }

  recordEditSummaries(opts, changesApplied);
  return concatChunks(chunks);
}

function makePngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  writeUint32(chunk, 0, data.length, false);
  for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(data, 8);
  const crcVal = crc32(chunk.subarray(4, 8 + data.length));
  writeUint32(chunk, 8 + data.length, crcVal, false);
  return chunk;
}

function buildPngITXtData(key: string, value: string): Uint8Array {
  const keyBytes = encodeUtf8(key);
  const valBytes = encodeUtf8(value);
  const out = new Uint8Array(keyBytes.length + 5 + valBytes.length);
  out.set(keyBytes, 0);
  // \0 (1B) + compFlag 0 (1B) + compMethod 0 (1B) + lang\0 (1B) + transKey\0 (1B)
  out.set(valBytes, keyBytes.length + 5);
  return out;
}

function editPngBytes(
  bytes: Uint8Array,
  inspected: InspectedMetadata,
  opts: MetadataEditOptions,
  changesApplied: string[]
): Uint8Array {
  if (bytes.length < 8) return bytes;
  const chunks: Uint8Array[] = [bytes.subarray(0, 8)]; // PNG signature
  const rewriteExif = needsExifRewrite(opts);
  const rewriteXmp =
    opts.gpsAction !== 'keep' ||
    opts.c2paAction === 'delete' ||
    opts.embeddedDateAction !== 'keep' ||
    opts.docMetaAction !== 'keep' ||
    hasAnyEditedKey(opts, ['xmp_']) ||
    hasAnyDeletedKey(opts, ['xmp_']);
  const c2paDeleted = opts.c2paAction === 'delete' || opts.scrubAllMetadata || hasAnyDeletedKey(opts, ['c2pa_']);
  const c2paEdited = hasAnyEditedKey(opts, ['c2pa_']);

  let exifWritten = false;
  let timeWritten = false;

  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const len = readUint32(bytes, offset, false);
    const type = readAscii(bytes, offset + 4, 4);
    const totalChunkLen = 12 + len;
    if (offset + totalChunkLen > bytes.length) break;
    const data = bytes.subarray(offset + 8, offset + 8 + len);

    const dropChunk = () => {
      offset += totalChunkLen;
    };

    if (type === 'caBX' || type === 'juMB') {
      if (c2paDeleted) {
        dropChunk();
        continue;
      }
      if (c2paEdited) {
        const patched = patchC2paPayloadInPlace(data, inspected, opts);
        chunks.push(makePngChunk(type, patched));
        dropChunk();
        continue;
      }
    }

    if (type === 'iCCP' && opts.scrubAllMetadata && !opts.preserveIccAndOrientation) {
      dropChunk();
      continue;
    }

    if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      const tagId = `png_${type.toLowerCase()}_${offset}`;
      if (opts.scrubAllMetadata || opts.deletedTagIds?.has(tagId)) {
        dropChunk();
        continue;
      }
      const nullIdx = data.indexOf(0);
      const key = nullIdx !== -1 ? readAscii(data, 0, nullIdx) : '';

      if (type === 'iTXt' && key === 'XML:com.adobe.xmp' && rewriteXmp) {
        let cursor = nullIdx + 3;
        while (cursor < data.length && data[cursor] !== 0) cursor++;
        cursor++;
        while (cursor < data.length && data[cursor] !== 0) cursor++;
        cursor++;
        const xmpText = readUtf8(data.subarray(cursor));
        const cleaned = cleanXmpString(xmpText, opts, inspected);
        if (cleaned) {
          chunks.push(makePngChunk('iTXt', buildPngITXtData('XML:com.adobe.xmp', cleaned)));
        }
        dropChunk();
        continue;
      }

      if (opts.editedTags && Object.prototype.hasOwnProperty.call(opts.editedTags, tagId)) {
        const newVal = opts.editedTags[tagId];
        // Write UTF-8 safe iTXt (or tEXt for pure ASCII)
        const isPureAscii = /^[\x20-\x7e\r\n\t]*$/.test(newVal);
        if (type === 'tEXt' && isPureAscii) {
          const kb = encodeUtf8(key);
          const vb = encodeUtf8(newVal);
          const d = new Uint8Array(kb.length + 1 + vb.length);
          d.set(kb, 0);
          d[kb.length] = 0;
          d.set(vb, kb.length + 1);
          chunks.push(makePngChunk('tEXt', d));
        } else {
          chunks.push(makePngChunk('iTXt', buildPngITXtData(key || 'Comment', newVal)));
        }
        dropChunk();
        continue;
      }

      if (opts.docMetaAction === 'delete') {
        const kl = key.toLowerCase();
        if (['author', 'title', 'description', 'copyright', 'software', 'comment'].includes(kl)) {
          dropChunk();
          continue;
        }
      }
    }

    if (type === 'tIME') {
      const timeTagId = `png_time_${offset}`;
      if (opts.scrubAllMetadata || opts.embeddedDateAction === 'delete' || opts.deletedTagIds?.has(timeTagId)) {
        dropChunk();
        continue;
      }
      const targetTimeStr =
        opts.editedTags && Object.prototype.hasOwnProperty.call(opts.editedTags, timeTagId)
          ? opts.editedTags[timeTagId]
          : opts.embeddedDateAction === 'set'
          ? opts.newEmbeddedDate
          : undefined;
      if (targetTimeStr) {
        const normalized = targetTimeStr.trim().replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
        const d = new Date(normalized);
        if (!isNaN(d.getTime())) {
          const tb = new Uint8Array(7);
          writeUint16(tb, 0, d.getFullYear(), false);
          tb[2] = d.getMonth() + 1;
          tb[3] = d.getDate();
          tb[4] = d.getHours();
          tb[5] = d.getMinutes();
          tb[6] = d.getSeconds();
          chunks.push(makePngChunk('tIME', tb));
          timeWritten = true;
          dropChunk();
          continue;
        }
      }
    }

    if (type === 'eXIf') {
      if (rewriteExif) {
        const tiff = buildUpdatedExifTiffBytes(inspected, opts);
        if (tiff) {
          chunks.push(makePngChunk('eXIf', tiff));
        }
        exifWritten = true;
        dropChunk();
        continue;
      }
    }

    if (type === 'IEND') {
      if (rewriteExif && !exifWritten) {
        const tiff = buildUpdatedExifTiffBytes(inspected, opts);
        if (tiff) chunks.push(makePngChunk('eXIf', tiff));
        exifWritten = true;
      }
      if (opts.embeddedDateAction === 'set' && opts.newEmbeddedDate && !timeWritten && !opts.scrubAllMetadata) {
        const d = new Date(opts.newEmbeddedDate);
        if (!isNaN(d.getTime())) {
          const tb = new Uint8Array(7);
          writeUint16(tb, 0, d.getFullYear(), false);
          tb[2] = d.getMonth() + 1;
          tb[3] = d.getDate();
          tb[4] = d.getHours();
          tb[5] = d.getMinutes();
          tb[6] = d.getSeconds();
          chunks.push(makePngChunk('tIME', tb));
          timeWritten = true;
        }
      }
    }

    chunks.push(bytes.subarray(offset, offset + totalChunkLen));
    offset += totalChunkLen;
    if (type === 'IEND') break;
  }

  recordEditSummaries(opts, changesApplied);
  return concatChunks(chunks);
}

function editWebpBytes(
  bytes: Uint8Array,
  inspected: InspectedMetadata,
  opts: MetadataEditOptions,
  changesApplied: string[]
): Uint8Array {
  if (bytes.length < 12) return bytes;
  const rewriteExif = needsExifRewrite(opts);
  const c2paDeleted = opts.c2paAction === 'delete' || opts.scrubAllMetadata || hasAnyDeletedKey(opts, ['c2pa_']);
  const c2paEdited = hasAnyEditedKey(opts, ['c2pa_']);
  const chunks: Uint8Array[] = [];
  let hasExifAfter = false;
  let hasXmpAfter = false;
  let hasIccAfter = false;
  let vp8xIndex = -1;

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkId = readAscii(bytes, offset, 4);
    const chunkSize = readUint32(bytes, offset + 4, true);
    const padded = chunkSize + (chunkSize % 2);
    const totalLen = 8 + padded;
    if (offset + 8 + chunkSize > bytes.length) break;
    const data = bytes.subarray(offset + 8, offset + 8 + chunkSize);

    if (chunkId === 'C2PA' || chunkId === 'JUMB') {
      if (c2paDeleted) {
        offset += totalLen;
        continue;
      }
      if (c2paEdited) {
        const patched = patchC2paPayloadInPlace(data, inspected, opts);
        const pad = patched.length % 2;
        const c = new Uint8Array(8 + patched.length + pad);
        c.set(encodeUtf8(chunkId), 0);
        writeUint32(c, 4, patched.length, true);
        c.set(patched, 8);
        chunks.push(c);
        offset += totalLen;
        continue;
      }
    }
    if (chunkId === 'ICCP') {
      if (opts.scrubAllMetadata && !opts.preserveIccAndOrientation) {
        offset += totalLen;
        continue;
      }
      hasIccAfter = true;
    }
    if (chunkId === 'XMP ') {
      if (opts.scrubAllMetadata) {
        offset += totalLen;
        continue;
      }
      const cleaned = cleanXmpString(readUtf8(data), opts, inspected);
      if (cleaned) {
        const cb = encodeUtf8(cleaned);
        const pad = cb.length % 2;
        const c = new Uint8Array(8 + cb.length + pad);
        c.set(encodeUtf8('XMP '), 0);
        writeUint32(c, 4, cb.length, true);
        c.set(cb, 8);
        chunks.push(c);
        hasXmpAfter = true;
      }
      offset += totalLen;
      continue;
    }
    if (chunkId === 'EXIF') {
      if (rewriteExif) {
        const tiff = buildUpdatedExifTiffBytes(inspected, opts);
        if (tiff) {
          const pad = tiff.length % 2;
          const c = new Uint8Array(8 + tiff.length + pad);
          c.set(encodeUtf8('EXIF'), 0);
          writeUint32(c, 4, tiff.length, true);
          c.set(tiff, 8);
          chunks.push(c);
          hasExifAfter = true;
        }
        offset += totalLen;
        continue;
      }
      hasExifAfter = true;
    }

    if (chunkId === 'VP8X') vp8xIndex = chunks.length;
    chunks.push(bytes.slice(offset, Math.min(bytes.length, offset + totalLen)));
    offset += totalLen;
  }

  if (rewriteExif && !hasExifAfter) {
    const tiff = buildUpdatedExifTiffBytes(inspected, opts);
    if (tiff) {
      const pad = tiff.length % 2;
      const c = new Uint8Array(8 + tiff.length + pad);
      c.set(encodeUtf8('EXIF'), 0);
      writeUint32(c, 4, tiff.length, true);
      c.set(tiff, 8);
      chunks.push(c);
      hasExifAfter = true;
    }
  }

  if (vp8xIndex !== -1 && chunks[vp8xIndex].length >= 12) {
    let flags = chunks[vp8xIndex][8];
    if (hasIccAfter) flags |= 0x20; else flags &= ~0x20;
    if (hasExifAfter) flags |= 0x08; else flags &= ~0x08;
    if (hasXmpAfter) flags |= 0x04; else flags &= ~0x04;
    chunks[vp8xIndex][8] = flags;
  }

  const bodyLen = chunks.reduce((s, c) => s + c.length, 0);
  const riff = new Uint8Array(12 + bodyLen);
  riff.set(encodeUtf8('RIFF'), 0);
  writeUint32(riff, 4, 4 + bodyLen, true);
  riff.set(encodeUtf8('WEBP'), 8);
  let pos = 12;
  for (const c of chunks) {
    riff.set(c, pos);
    pos += c.length;
  }

  recordEditSummaries(opts, changesApplied);
  return riff;
}

async function editPdfBytes(
  bytes: Uint8Array,
  inspected: InspectedMetadata,
  opts: MetadataEditOptions,
  changesApplied: string[]
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const ed = opts.editedTags || {};
  const del = opts.deletedTagIds || new Set<string>();

  if (opts.scrubAllMetadata || opts.docMetaAction === 'delete') {
    pdfDoc.setTitle('');
    pdfDoc.setAuthor('');
    pdfDoc.setSubject('');
    pdfDoc.setKeywords([]);
    pdfDoc.setCreator('');
    pdfDoc.setProducer('');
  } else if (opts.docMetaAction === 'set' && opts.newDocMeta) {
    if (opts.newDocMeta.title !== undefined) pdfDoc.setTitle(opts.newDocMeta.title);
    if (opts.newDocMeta.author !== undefined) pdfDoc.setAuthor(opts.newDocMeta.author);
    if (opts.newDocMeta.subject !== undefined) pdfDoc.setSubject(opts.newDocMeta.subject);
    if (opts.newDocMeta.keywords !== undefined) {
      pdfDoc.setKeywords(opts.newDocMeta.keywords.split(',').map((k) => k.trim()).filter(Boolean));
    }
    if (opts.newDocMeta.software !== undefined) pdfDoc.setCreator(opts.newDocMeta.software);
  }

  // Per-tag PDF overrides & deletions
  if (del.has('pdf_title')) pdfDoc.setTitle('');
  else if (ed['pdf_title'] !== undefined) pdfDoc.setTitle(ed['pdf_title']);

  if (del.has('pdf_author')) pdfDoc.setAuthor('');
  else if (ed['pdf_author'] !== undefined) pdfDoc.setAuthor(ed['pdf_author']);

  if (del.has('pdf_subject')) pdfDoc.setSubject('');
  else if (ed['pdf_subject'] !== undefined) pdfDoc.setSubject(ed['pdf_subject']);

  if (del.has('pdf_keywords')) pdfDoc.setKeywords([]);
  else if (ed['pdf_keywords'] !== undefined) {
    pdfDoc.setKeywords(ed['pdf_keywords'].split(',').map((k) => k.trim()).filter(Boolean));
  }

  if (del.has('pdf_creator')) pdfDoc.setCreator('');
  else if (ed['pdf_creator'] !== undefined) pdfDoc.setCreator(ed['pdf_creator']);

  if (del.has('pdf_producer')) pdfDoc.setProducer('');
  else if (ed['pdf_producer'] !== undefined) pdfDoc.setProducer(ed['pdf_producer']);

  const infoDict = pdfDoc.context.lookup(pdfDoc.context.trailerInfo.Info) as any;

  if (opts.scrubAllMetadata || opts.embeddedDateAction === 'delete') {
    if (infoDict && typeof infoDict.delete === 'function') {
      infoDict.delete(PDFName.of('CreationDate'));
      infoDict.delete(PDFName.of('ModDate'));
    }
  } else if (opts.embeddedDateAction === 'set' && opts.newEmbeddedDate) {
    const d = new Date(opts.newEmbeddedDate);
    if (!isNaN(d.getTime())) {
      pdfDoc.setCreationDate(d);
      pdfDoc.setModificationDate(d);
    }
  }

  if (del.has('pdf_cdate') && infoDict?.delete) {
    infoDict.delete(PDFName.of('CreationDate'));
  } else if (ed['pdf_cdate'] !== undefined) {
    const d = new Date(ed['pdf_cdate']);
    if (!isNaN(d.getTime())) pdfDoc.setCreationDate(d);
  }

  if (del.has('pdf_mdate') && infoDict?.delete) {
    infoDict.delete(PDFName.of('ModDate'));
  } else if (ed['pdf_mdate'] !== undefined) {
    const d = new Date(ed['pdf_mdate']);
    if (!isNaN(d.getTime())) pdfDoc.setModificationDate(d);
  }

  // Custom PDF Info dictionary keys
  if (infoDict) {
    const customPdfTags = inspected.tags.filter((t) => t.id.startsWith('pdf_custom_'));
    for (const tag of customPdfTags) {
      const kName = tag.metaRef?.pdfCustomKey || tag.key;
      if ((opts.scrubAllMetadata || del.has(tag.id)) && typeof infoDict.delete === 'function') {
        infoDict.delete(PDFName.of(kName));
      } else if (Object.prototype.hasOwnProperty.call(ed, tag.id) && typeof infoDict.set === 'function') {
        infoDict.set(PDFName.of(kName), PDFString.of(ed[tag.id]));
      }
    }
  }

  // XMP Metadata Stream in Catalog
  if (opts.scrubAllMetadata || opts.c2paAction === 'delete' || opts.gpsAction === 'delete' || del.has('pdf_xmp_stream')) {
    pdfDoc.catalog.delete(PDFName.of('Metadata'));
  } else if (ed['pdf_xmp_stream'] !== undefined) {
    const stream = pdfDoc.context.flateStream(encodeUtf8(ed['pdf_xmp_stream']), {
      Type: PDFName.of('Metadata'),
      Subtype: PDFName.of('XML'),
    });
    const ref = pdfDoc.context.register(stream);
    pdfDoc.catalog.set(PDFName.of('Metadata'), ref);
  } else if (inspected.rawXmpText && (hasAnyEditedKey(opts, ['xmp_']) || hasAnyDeletedKey(opts, ['xmp_']) || opts.docMetaAction !== 'keep' || opts.embeddedDateAction !== 'keep')) {
    const updatedXmp = cleanXmpString(inspected.rawXmpText, opts, inspected);
    if (updatedXmp) {
      const stream = pdfDoc.context.flateStream(encodeUtf8(updatedXmp), {
        Type: PDFName.of('Metadata'),
        Subtype: PDFName.of('XML'),
      });
      const ref = pdfDoc.context.register(stream);
      pdfDoc.catalog.set(PDFName.of('Metadata'), ref);
    } else {
      pdfDoc.catalog.delete(PDFName.of('Metadata'));
    }
  }

  recordEditSummaries(opts, changesApplied);
  return await pdfDoc.save();
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function editOfficeBytes(
  bytes: Uint8Array,
  inspected: InspectedMetadata,
  opts: MetadataEditOptions,
  changesApplied: string[]
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  const ed = opts.editedTags || {};
  const del = opts.deletedTagIds || new Set<string>();

  if (opts.scrubAllMetadata || del.has('office_custom_xml')) {
    zip.remove('docProps/custom.xml');
  }

  const dm = inspected.documentMeta;
  const tagVal = (id: string) => inspected.tags.find((t) => t.id === id)?.rawValue ?? inspected.tags.find((t) => t.id === id)?.value ?? '';

  const baseMeta = opts.scrubAllMetadata || opts.docMetaAction === 'delete'
    ? { title: '', subject: '', author: '', keywords: '', description: '', software: '', company: '' }
    : opts.docMetaAction === 'set' && opts.newDocMeta
    ? opts.newDocMeta
    : dm;

  const resolveOfficeField = (tagId: string, fallback?: string) => {
    if (opts.scrubAllMetadata || del.has(tagId)) return '';
    if (Object.prototype.hasOwnProperty.call(ed, tagId)) return ed[tagId];
    return fallback || '';
  };

  const titleStr = resolveOfficeField('office_title', baseMeta.title);
  const subjectStr = resolveOfficeField('office_subject', baseMeta.subject);
  const creatorStr = resolveOfficeField('office_creator', baseMeta.author);
  const keywordsStr = resolveOfficeField('office_keywords', baseMeta.keywords);
  const descriptionStr = resolveOfficeField('office_description', baseMeta.description);
  const lastModifiedByStr = opts.docMetaAction === 'delete' ? '' : resolveOfficeField('office_lastModifiedBy', tagVal('office_lastModifiedBy'));
  const categoryStr = opts.docMetaAction === 'delete' ? '' : resolveOfficeField('office_category', tagVal('office_category'));
  const revisionStr = opts.docMetaAction === 'delete' ? '' : resolveOfficeField('office_revision', tagVal('office_revision'));

  let createdStr = inspected.embeddedDates.created || '';
  let modifiedStr = inspected.embeddedDates.modified || '';
  if (opts.scrubAllMetadata || opts.embeddedDateAction === 'delete') {
    createdStr = '';
    modifiedStr = '';
  } else if (opts.embeddedDateAction === 'set' && opts.newEmbeddedDate) {
    const iso = dateTimeLocalToIso(opts.newEmbeddedDate);
    createdStr = iso;
    modifiedStr = iso;
  }
  if (del.has('office_created')) createdStr = '';
  else if (Object.prototype.hasOwnProperty.call(ed, 'office_created')) createdStr = ed['office_created'];
  if (del.has('office_modified')) modifiedStr = '';
  else if (Object.prototype.hasOwnProperty.call(ed, 'office_modified')) modifiedStr = ed['office_modified'];

  const newCoreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  ${titleStr ? `<dc:title>${escapeXml(titleStr)}</dc:title>` : ''}
  ${subjectStr ? `<dc:subject>${escapeXml(subjectStr)}</dc:subject>` : ''}
  ${creatorStr ? `<dc:creator>${escapeXml(creatorStr)}</dc:creator>` : ''}
  ${lastModifiedByStr ? `<cp:lastModifiedBy>${escapeXml(lastModifiedByStr)}</cp:lastModifiedBy>` : ''}
  ${keywordsStr ? `<cp:keywords>${escapeXml(keywordsStr)}</cp:keywords>` : ''}
  ${descriptionStr ? `<dc:description>${escapeXml(descriptionStr)}</dc:description>` : ''}
  ${categoryStr ? `<cp:category>${escapeXml(categoryStr)}</cp:category>` : ''}
  ${revisionStr ? `<cp:revision>${escapeXml(revisionStr)}</cp:revision>` : ''}
  ${createdStr ? `<dcterms:created xsi:type="dcterms:W3CDTF">${escapeXml(createdStr)}</dcterms:created>` : ''}
  ${modifiedStr ? `<dcterms:modified xsi:type="dcterms:W3CDTF">${escapeXml(modifiedStr)}</dcterms:modified>` : ''}
</cp:coreProperties>`;

  zip.file('docProps/core.xml', newCoreXml);

  const appFile = zip.file('docProps/app.xml');
  if (appFile) {
    let appXml = await appFile.async('string');
    if (opts.scrubAllMetadata || opts.docMetaAction === 'delete') {
      appXml = appXml.replace(/<Company>[\s\S]*?<\/Company>/g, '<Company></Company>');
      appXml = appXml.replace(/<Manager>[\s\S]*?<\/Manager>/g, '<Manager></Manager>');
      appXml = appXml.replace(/<Application>[\s\S]*?<\/Application>/g, '<Application></Application>');
    } else {
      const targetCompany = Object.prototype.hasOwnProperty.call(ed, 'office_company')
        ? ed['office_company']
        : opts.docMetaAction === 'set'
        ? opts.newDocMeta?.company
        : undefined;
      if (del.has('office_company')) {
        appXml = appXml.replace(/<Company>[\s\S]*?<\/Company>/g, '<Company></Company>');
      } else if (targetCompany !== undefined) {
        appXml = appXml.replace(/<Company>[\s\S]*?<\/Company>/g, `<Company>${escapeXml(targetCompany)}</Company>`);
      }

      const targetApp = Object.prototype.hasOwnProperty.call(ed, 'office_app')
        ? ed['office_app']
        : opts.docMetaAction === 'set'
        ? opts.newDocMeta?.software
        : undefined;
      if (del.has('office_app')) {
        appXml = appXml.replace(/<Application>[\s\S]*?<\/Application>/g, '<Application></Application>');
      } else if (targetApp !== undefined) {
        appXml = appXml.replace(/<Application>[\s\S]*?<\/Application>/g, `<Application>${escapeXml(targetApp)}</Application>`);
      }

      if (del.has('office_manager')) {
        appXml = appXml.replace(/<Manager>[\s\S]*?<\/Manager>/g, '<Manager></Manager>');
      } else if (Object.prototype.hasOwnProperty.call(ed, 'office_manager')) {
        appXml = appXml.replace(/<Manager>[\s\S]*?<\/Manager>/g, `<Manager>${escapeXml(ed['office_manager'])}</Manager>`);
      }
    }
    zip.file('docProps/app.xml', appXml);
  }

  // Update docProps/custom.xml individual properties if present
  const customFile = zip.file('docProps/custom.xml');
  if (customFile && !opts.scrubAllMetadata && !del.has('office_custom_xml')) {
    if (ed['office_custom_xml'] !== undefined) {
      zip.file('docProps/custom.xml', ed['office_custom_xml']);
    } else {
      const customProps = inspected.tags.filter((t) => t.id.startsWith('office_custom_prop_'));
      if (customProps.some((p) => del.has(p.id) || Object.prototype.hasOwnProperty.call(ed, p.id))) {
        let customXml = await customFile.async('string');
        for (const prop of customProps) {
          const pName = prop.metaRef?.customPropName || prop.key.replace(/^Custom:\s*/, '');
          const escName = pName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          if (del.has(prop.id)) {
            customXml = customXml.replace(new RegExp(`<property[^>]*name=["']${escName}["'][^>]*>[\\s\\S]*?<\\/property>`, 'g'), '');
          } else if (Object.prototype.hasOwnProperty.call(ed, prop.id)) {
            const safeV = escapeXml(ed[prop.id]);
            customXml = customXml.replace(
              new RegExp(`(<property[^>]*name=["']${escName}["'][^>]*>[\\s\\S]*?<vt:[^>]+>)[^<]*(<\\/vt:[^>]+>[\\s\\S]*?<\\/property>)`, 'g'),
              `$1${safeV}$2`
            );
          }
        }
        zip.file('docProps/custom.xml', customXml);
      }
    }
  }

  recordEditSummaries(opts, changesApplied);
  const outBuf = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return outBuf;
}

function editIsoBmffBytes(bytes: Uint8Array, inspected: InspectedMetadata, opts: MetadataEditOptions, changesApplied: string[]): Uint8Array {
  // Modify in-place or convert stripped boxes to 'free' of identical byte size so stco/co64 offsets stay intact!
  const out = new Uint8Array(bytes);
  const macEpochOffset = 2082844800;
  const ed = opts.editedTags || {};
  const del = opts.deletedTagIds || new Set<string>();
  const c2paDeleted = opts.c2paAction === 'delete' || opts.scrubAllMetadata || hasAnyDeletedKey(opts, ['c2pa_']);

  const replaceWithFree = (start: number, size: number) => {
    out[start + 4] = 0x66;
    out[start + 5] = 0x72;
    out[start + 6] = 0x65;
    out[start + 7] = 0x65;
    out.fill(0, start + 8, start + size);
  };

  const writeMvhdTimestamp = (bodyStart: number, version: number, kind: 'c' | 'm', macSec: number) => {
    if (version === 0) {
      writeUint32(out, bodyStart + (kind === 'c' ? 4 : 8), macSec, false);
    } else if (version === 1) {
      writeUint32(out, bodyStart + (kind === 'c' ? 8 : 16), macSec, false);
    }
  };

  const walk = (start: number, end: number, depth: number, inIlst = false) => {
    if (depth > 6) return;
    let offset = start;
    while (offset + 8 <= end) {
      let size = readUint32(out, offset, false);
      const type = readAscii(out, offset + 4, 4);
      let headerSize = 8;
      if (size === 1 && offset + 16 <= end) {
        const hi = readUint32(out, offset + 8, false);
        const lo = readUint32(out, offset + 12, false);
        size = hi * 4294967296 + lo;
        headerSize = 16;
      } else if (size === 0) {
        size = end - offset;
      }
      if (size < headerSize || offset + size > end) break;
      const bodyStart = offset + headerSize;
      const bodyEnd = offset + size;

      if (inIlst) {
        const tagId = `mp4_ilst_${offset}`;
        if (opts.scrubAllMetadata || del.has(tagId)) {
          replaceWithFree(offset, size);
        } else if (Object.prototype.hasOwnProperty.call(ed, tagId)) {
          const refTag = inspected.tags.find((t) => t.id === tagId);
          const pStart = refTag?.metaRef?.dataPayloadStart;
          const pLen = refTag?.metaRef?.dataPayloadLen;
          if (typeof pStart === 'number' && typeof pLen === 'number' && pStart + pLen <= out.length) {
            const newBytes = encodeUtf8(ed[tagId]);
            out.fill(0x20, pStart, pStart + pLen);
            out.set(newBytes.subarray(0, pLen), pStart);
          }
        }
        offset += size;
        continue;
      }

      if (type === 'mvhd' && bodyStart + 20 <= bodyEnd) {
        const version = out[bodyStart];
        const cId = `mp4_mvhd_c_${offset}`;
        const mId = `mp4_mvhd_m_${offset}`;

        if (opts.scrubAllMetadata || opts.embeddedDateAction === 'delete') {
          writeMvhdTimestamp(bodyStart, version, 'c', 0);
          writeMvhdTimestamp(bodyStart, version, 'm', 0);
        } else if (opts.embeddedDateAction === 'set' && opts.newEmbeddedDate) {
          const ms = new Date(opts.newEmbeddedDate).getTime();
          if (!isNaN(ms)) {
            const macSec = Math.max(0, Math.floor(ms / 1000) + macEpochOffset);
            writeMvhdTimestamp(bodyStart, version, 'c', macSec);
            writeMvhdTimestamp(bodyStart, version, 'm', macSec);
          }
        }

        if (del.has(cId)) writeMvhdTimestamp(bodyStart, version, 'c', 0);
        else if (ed[cId] !== undefined) {
          const ms = new Date(ed[cId]).getTime();
          if (!isNaN(ms)) writeMvhdTimestamp(bodyStart, version, 'c', Math.max(0, Math.floor(ms / 1000) + macEpochOffset));
        }
        if (del.has(mId)) writeMvhdTimestamp(bodyStart, version, 'm', 0);
        else if (ed[mId] !== undefined) {
          const ms = new Date(ed[mId]).getTime();
          if (!isNaN(ms)) writeMvhdTimestamp(bodyStart, version, 'm', Math.max(0, Math.floor(ms / 1000) + macEpochOffset));
        }
      } else if ((type === 'jumb' || type === 'c2pa') && c2paDeleted) {
        replaceWithFree(offset, size);
      } else if (type === 'uuid' && bodyStart + 16 <= bodyEnd) {
        const uuidHex = Array.from(out.subarray(bodyStart, bodyStart + 16))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        if (
          (uuidHex === 'd8fec3d61b0e483c92975828877ec481' && c2paDeleted) ||
          (uuidHex === 'be7acfcb97a942e89c71999491e3afac' && opts.scrubAllMetadata)
        ) {
          replaceWithFree(offset, size);
        }
      } else if (type === '©xyz' || type === '\xa9xyz') {
        const xyzId = `mp4_xyz_${offset}`;
        if (opts.gpsAction === 'delete' || opts.scrubAllMetadata || del.has(xyzId)) {
          replaceWithFree(offset, size);
        } else if (Object.prototype.hasOwnProperty.call(ed, xyzId)) {
          const slotStart = bodyStart + 4;
          const slotLen = bodyEnd - slotStart;
          if (slotLen > 0) {
            const newBytes = encodeUtf8(ed[xyzId]);
            out.fill(0x20, slotStart, bodyEnd);
            out.set(newBytes.subarray(0, slotLen), slotStart);
          }
        }
      } else if (type === 'udta' && opts.scrubAllMetadata) {
        replaceWithFree(offset, size);
      } else if (type === 'ilst') {
        walk(bodyStart, bodyEnd, depth + 1, true);
      } else if (['moov', 'udta', 'trak', 'mdia'].includes(type)) {
        walk(bodyStart, bodyEnd, depth + 1, false);
      } else if (type === 'meta' && bodyStart + 4 < bodyEnd) {
        walk(bodyStart + 4, bodyEnd, depth + 1, false);
      }

      offset += size;
    }
  };

  walk(0, out.length, 0, false);
  recordEditSummaries(opts, changesApplied);
  return out;
}

function editTextMarkupBytes(bytes: Uint8Array, inspected: InspectedMetadata, opts: MetadataEditOptions, changesApplied: string[]): Uint8Array {
  let text = readUtf8(bytes);
  const ed = opts.editedTags || {};
  const del = opts.deletedTagIds || new Set<string>();

  if (opts.scrubAllMetadata || opts.c2paAction === 'delete') {
    text = text.replace(/<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/gi, '');
    text = text.replace(/<metadata[\s\S]*?<\/metadata>/gi, '');
  } else if (inspected.rawXmpText && (hasAnyEditedKey(opts, ['xmp_']) || hasAnyDeletedKey(opts, ['xmp_']))) {
    const cleaned = cleanXmpString(inspected.rawXmpText, opts, inspected);
    text = text.replace(/<x:xmpmeta[\s\S]*?<\/x:xmpmeta>|<rdf:RDF[\s\S]*?<\/rdf:RDF>/i, cleaned || '');
  }

  if (opts.scrubAllMetadata || opts.gpsAction === 'delete') {
    text = text.replace(/<meta\s+[^>]*name=["'](geo\.position|ICBM)["'][^>]*>/gi, '');
  }
  if (opts.scrubAllMetadata || opts.docMetaAction === 'delete') {
    text = text.replace(/<meta\s+[^>]*name=["'](author|keywords|description|generator)["'][^>]*>/gi, '');
  }
  if (opts.scrubAllMetadata || opts.embeddedDateAction === 'delete') {
    text = text.replace(/<meta\s+[^>]*name=["']date["'][^>]*>/gi, '');
  }

  // Title edit/delete
  if (del.has('markup_title')) {
    text = text.replace(/<title>[\s\S]*?<\/title>/i, '');
  } else if (ed['markup_title'] !== undefined) {
    text = text.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeXml(ed['markup_title'])}</title>`);
  } else if (opts.docMetaAction === 'set' && opts.newDocMeta && opts.newDocMeta.title) {
    if (/<title>[\s\S]*?<\/title>/i.test(text)) {
      text = text.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeXml(opts.newDocMeta.title)}</title>`);
    }
  }

  // Per-tag <meta name="..."> edits & deletions
  const metaTags = inspected.tags.filter((t) => t.id.startsWith('markup_meta_'));
  for (const tag of metaTags) {
    const metaName = tag.key.replace(/^meta:/i, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (del.has(tag.id)) {
      text = text.replace(new RegExp(`<meta\\s+[^>]*name=["']${metaName}["'][^>]*>`, 'gi'), '');
    } else if (Object.prototype.hasOwnProperty.call(ed, tag.id)) {
      const newAttr = `content="${escapeXml(ed[tag.id])}"`;
      text = text.replace(
        new RegExp(`(<meta\\s+[^>]*name=["']${metaName}["'][^>]*?)content=["'][^"']*["']([^>]*>)`, 'gi'),
        `$1${newAttr}$2`
      );
    }
  }

  recordEditSummaries(opts, changesApplied);
  return encodeUtf8(text);
}

function editPpmBytes(bytes: Uint8Array, inspected: InspectedMetadata, opts: MetadataEditOptions, changesApplied: string[]): Uint8Array {
  const header = parsePpmHeader(bytes);
  if (!header) return bytes;

  const ed = opts.editedTags || {};
  const del = opts.deletedTagIds || new Set<string>();
  const newComments: string[] = [];

  if (!opts.scrubAllMetadata && opts.docMetaAction !== 'delete') {
    header.comments.forEach((c, idx) => {
      const id = `ppm_comment_${idx}`;
      if (del.has(id)) return;
      const updated = Object.prototype.hasOwnProperty.call(ed, id) ? ed[id] : c;
      const sanitized = updated.replace(/[\r\n]+/g, ' ').trim();
      if (sanitized) newComments.push(sanitized);
    });
    if (opts.docMetaAction === 'set' && opts.newDocMeta?.description) {
      const desc = opts.newDocMeta.description.replace(/[\r\n]+/g, ' ').trim();
      if (desc && !newComments.includes(desc)) newComments.push(desc);
    }
  }

  const lines: string[] = [header.magic];
  for (const comment of newComments) {
    lines.push(`# ${comment}`);
  }
  lines.push(`${header.width} ${header.height}`);
  if (header.magic !== 'P1' && header.magic !== 'P4') {
    lines.push(String(header.maxval));
  }
  const headerBytes = encodeUtf8(`${lines.join('\n')}\n`);
  const payload = bytes.subarray(header.dataOffset);

  recordEditSummaries(opts, changesApplied);
  return concatChunks([headerBytes, payload]);
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function recordEditSummaries(opts: MetadataEditOptions, changesApplied: string[]) {
  if (opts.scrubAllMetadata) {
    changesApplied.push('全メタデータ一括削除');
    return;
  }
  if (opts.gpsAction === 'delete') changesApplied.push('位置情報(GPS)削除');
  if (opts.gpsAction === 'set') changesApplied.push('位置情報(GPS)編集');
  if (opts.c2paAction === 'delete') changesApplied.push('C2PA情報削除');
  if (opts.embeddedDateAction === 'delete') changesApplied.push('埋め込み日時削除');
  if (opts.embeddedDateAction === 'set') changesApplied.push('埋め込み日時編集');
  if (opts.docMetaAction === 'delete') changesApplied.push('作成者・ソフト情報削除');
  if (opts.docMetaAction === 'set') changesApplied.push('文書・EXIFメタデータ編集');
  const editedCount = opts.editedTags ? Object.keys(opts.editedTags).length : 0;
  if (editedCount > 0) changesApplied.push(`個別タグ編集 (${editedCount}件)`);
  const delCount = opts.deletedTagIds ? opts.deletedTagIds.size : 0;
  if (delCount > 0) changesApplied.push(`個別タグ削除 (${delCount}件)`);
}
