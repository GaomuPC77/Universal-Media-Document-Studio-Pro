/**
 * Client-side Image Codec Utilities for PPM (Netpbm P3/P6, plus P1/P2/P4/P5),
 * Windows BMP (with BITMAPINFOHEADER / COREHEADER fallback decoder), and multi-resolution ICO/CUR.
 */

export interface PpmHeaderInfo {
  magic: 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6';
  width: number;
  height: number;
  maxval: number;
  dataOffset: number;
  comments: string[];
}

export interface BmpHeaderInfo {
  width: number;
  height: number;
  topDown: boolean;
  bitCount: number;
  compression: number;
  headerSize: number;
  dataOffset: number;
  colorsUsed: number;
  xPelsPerMeter: number;
  yPelsPerMeter: number;
}

export interface IcoEntryInfo {
  index: number;
  width: number;
  height: number;
  colorCount: number;
  planes: number;
  bitCount: number;
  bytesInRes: number;
  imageOffset: number;
  isPng: boolean;
}

export interface DecodedImageResult {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  detectedFormat: string;
}

function isAsciiWhitespace(b: number): boolean {
  return b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d || b === 0x0b || b === 0x0c;
}

function readUint16LE(bytes: Uint8Array, off: number): number {
  if (off + 2 > bytes.length) return 0;
  return bytes[off] | (bytes[off + 1] << 8);
}

function readUint32LE(bytes: Uint8Array, off: number): number {
  if (off + 4 > bytes.length) return 0;
  return (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0;
}

function readInt32LE(bytes: Uint8Array, off: number): number {
  return readUint32LE(bytes, off) | 0;
}

function isPngSignature(bytes: Uint8Array, off = 0): boolean {
  return (
    off + 8 <= bytes.length &&
    bytes[off] === 0x89 &&
    bytes[off + 1] === 0x50 &&
    bytes[off + 2] === 0x4e &&
    bytes[off + 3] === 0x47 &&
    bytes[off + 4] === 0x0d &&
    bytes[off + 5] === 0x0a &&
    bytes[off + 6] === 0x1a &&
    bytes[off + 7] === 0x0a
  );
}

/**
 * Detect whether a buffer starts with a valid Netpbm magic header (P1..P6).
 */
export function isNetpbmBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 7) return false;
  if (bytes[0] !== 0x50) return false; // 'P'
  const second = bytes[1];
  if (second < 0x31 || second > 0x36) return false; // '1'..'6'
  return isAsciiWhitespace(bytes[2]) || bytes[2] === 0x23; // whitespace or '#'
}

/**
 * Parse PPM / PGM / PBM header according to the Netpbm spec.
 * Carefully consumes only the single separating whitespace byte before binary raster data.
 */
export function parsePpmHeader(bytes: Uint8Array): PpmHeaderInfo | null {
  if (!isNetpbmBytes(bytes)) return null;

  const comments: string[] = [];
  let pos = 0;
  const maxHeaderScan = Math.min(bytes.length, 65536);

  const readToken = (): string | null => {
    while (pos < maxHeaderScan) {
      const b = bytes[pos];
      if (isAsciiWhitespace(b)) {
        pos++;
        continue;
      }
      if (b === 0x23) {
        // '#' comment until newline
        pos++;
        const start = pos;
        while (pos < maxHeaderScan && bytes[pos] !== 0x0a && bytes[pos] !== 0x0d) {
          pos++;
        }
        const commentText = new TextDecoder('utf-8', { fatal: false })
          .decode(bytes.subarray(start, pos))
          .trim();
        if (commentText) comments.push(commentText);
        continue;
      }
      break;
    }

    if (pos >= maxHeaderScan) return null;
    const start = pos;
    while (pos < maxHeaderScan && !isAsciiWhitespace(bytes[pos]) && bytes[pos] !== 0x23) {
      pos++;
    }
    return String.fromCharCode(...bytes.subarray(start, pos));
  };

  const magic = readToken();
  if (!magic || !/^P[1-6]$/.test(magic)) return null;

  const wStr = readToken();
  const hStr = readToken();
  const width = wStr ? parseInt(wStr, 10) : NaN;
  const height = hStr ? parseInt(hStr, 10) : NaN;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width > 16384 || height > 16384) {
    return null;
  }

  let maxval = 1;
  if (magic !== 'P1' && magic !== 'P4') {
    const mStr = readToken();
    maxval = mStr ? parseInt(mStr, 10) : NaN;
    if (!Number.isFinite(maxval) || maxval <= 0 || maxval > 65535) {
      return null;
    }
  }

  // If comment immediately follows last header token before the separator whitespace
  while (pos < bytes.length && bytes[pos] === 0x23) {
    pos++;
    const start = pos;
    while (pos < bytes.length && bytes[pos] !== 0x0a && bytes[pos] !== 0x0d) {
      pos++;
    }
    const commentText = new TextDecoder('utf-8', { fatal: false })
      .decode(bytes.subarray(start, pos))
      .trim();
    if (commentText) comments.push(commentText);
    if (pos < bytes.length && bytes[pos] === 0x0d && bytes[pos + 1] === 0x0a) {
      pos++;
    }
  }

  // For binary formats (P4, P5, P6), Netpbm mandates a single whitespace character separates header & pixels.
  let dataOffset = pos;
  if (magic === 'P4' || magic === 'P5' || magic === 'P6') {
    if (dataOffset < bytes.length && isAsciiWhitespace(bytes[dataOffset])) {
      dataOffset++;
    }
  }

  return {
    magic: magic as PpmHeaderInfo['magic'],
    width,
    height,
    maxval,
    dataOffset,
    comments,
  };
}

/**
 * Decode PPM (P3 ASCII / P6 Binary, plus PGM P2/P5 & PBM P1/P4 fallback) bytes into a HTMLCanvasElement.
 */
export function decodePpmToCanvas(bytes: Uint8Array): HTMLCanvasElement {
  const header = parsePpmHeader(bytes);
  if (!header) {
    throw new Error('無効なPPM/Netpbmヘッダです (Invalid PPM header)');
  }

  const { magic, width, height, maxval, dataOffset } = header;
  const totalPixels = width * height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  const imgData = ctx.createImageData(width, height);
  const out = imgData.data;

  const scaleSample = (v: number) =>
    maxval === 255 ? (v & 0xff) : Math.min(255, Math.max(0, Math.round((v * 255) / maxval)));

  if (magic === 'P6') {
    const bytesPerSample = maxval > 255 ? 2 : 1;
    let src = dataOffset;
    for (let i = 0; i < totalPixels; i++) {
      const dst = i * 4;
      if (bytesPerSample === 1) {
        if (src + 2 >= bytes.length) break;
        out[dst] = scaleSample(bytes[src++]);
        out[dst + 1] = scaleSample(bytes[src++]);
        out[dst + 2] = scaleSample(bytes[src++]);
      } else {
        if (src + 5 >= bytes.length) break;
        const r = (bytes[src] << 8) | bytes[src + 1];
        const g = (bytes[src + 2] << 8) | bytes[src + 3];
        const b = (bytes[src + 4] << 8) | bytes[src + 5];
        src += 6;
        out[dst] = scaleSample(r);
        out[dst + 1] = scaleSample(g);
        out[dst + 2] = scaleSample(b);
      }
      out[dst + 3] = 255;
    }
  } else if (magic === 'P5') {
    const bytesPerSample = maxval > 255 ? 2 : 1;
    let src = dataOffset;
    for (let i = 0; i < totalPixels; i++) {
      const dst = i * 4;
      if (bytesPerSample === 1) {
        if (src >= bytes.length) break;
        const v = scaleSample(bytes[src++]);
        out[dst] = v;
        out[dst + 1] = v;
        out[dst + 2] = v;
      } else {
        if (src + 1 >= bytes.length) break;
        const v = scaleSample((bytes[src] << 8) | bytes[src + 1]);
        src += 2;
        out[dst] = v;
        out[dst + 1] = v;
        out[dst + 2] = v;
      }
      out[dst + 3] = 255;
    }
  } else if (magic === 'P4') {
    const rowBytes = Math.ceil(width / 8);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const byteIdx = dataOffset + y * rowBytes + (x >> 3);
        const bit = byteIdx < bytes.length ? (bytes[byteIdx] >> (7 - (x & 7))) & 1 : 0;
        const v = bit ? 0 : 255;
        const dst = (y * width + x) * 4;
        out[dst] = v;
        out[dst + 1] = v;
        out[dst + 2] = v;
        out[dst + 3] = 255;
      }
    }
  } else {
    // ASCII variants: P3 (RGB), P2 (Grayscale), P1 (Bitmap)
    let pos = dataOffset;
    const readNextInt = (): number | null => {
      while (pos < bytes.length) {
        const b = bytes[pos];
        if (isAsciiWhitespace(b)) {
          pos++;
          continue;
        }
        if (b === 0x23) {
          while (pos < bytes.length && bytes[pos] !== 0x0a && bytes[pos] !== 0x0d) pos++;
          continue;
        }
        break;
      }
      if (pos >= bytes.length) return null;
      if (magic === 'P1') {
        // P1 allows digits without whitespace separation in some encoders
        const c = bytes[pos++];
        return c === 0x31 ? 1 : 0;
      }
      let val = 0;
      let hasDigits = false;
      while (pos < bytes.length && bytes[pos] >= 0x30 && bytes[pos] <= 0x39) {
        hasDigits = true;
        val = val * 10 + (bytes[pos] - 0x30);
        pos++;
      }
      if (!hasDigits) {
        pos++;
        return readNextInt();
      }
      return val;
    };

    if (magic === 'P3') {
      for (let i = 0; i < totalPixels; i++) {
        const r = readNextInt();
        const g = readNextInt();
        const b = readNextInt();
        if (r === null || g === null || b === null) break;
        const dst = i * 4;
        out[dst] = scaleSample(r);
        out[dst + 1] = scaleSample(g);
        out[dst + 2] = scaleSample(b);
        out[dst + 3] = 255;
      }
    } else if (magic === 'P2') {
      for (let i = 0; i < totalPixels; i++) {
        const g = readNextInt();
        if (g === null) break;
        const v = scaleSample(g);
        const dst = i * 4;
        out[dst] = v;
        out[dst + 1] = v;
        out[dst + 2] = v;
        out[dst + 3] = 255;
      }
    } else {
      // P1
      for (let i = 0; i < totalPixels; i++) {
        const bit = readNextInt();
        if (bit === null) break;
        const v = bit ? 0 : 255;
        const dst = i * 4;
        out[dst] = v;
        out[dst + 1] = v;
        out[dst + 2] = v;
        out[dst + 3] = 255;
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/**
 * Encode HTMLCanvasElement to standard Netpbm PPM Blob (P6 Binary or P3 ASCII).
 * Composites transparent pixels onto opaque backgroundColor (default #FFFFFF).
 */
export function canvasToPpmBlob(
  canvas: HTMLCanvasElement,
  variant: 'P6' | 'P3' = 'P6',
  backgroundColor: string = '#FFFFFF'
): Blob {
  const width = Math.max(1, canvas.width);
  const height = Math.max(1, canvas.height);

  // Composite onto opaque surface so alpha channel flattens cleanly for RGB-only PPM
  const flatCanvas = document.createElement('canvas');
  flatCanvas.width = width;
  flatCanvas.height = height;
  const fctx = flatCanvas.getContext('2d');
  if (!fctx) throw new Error('Canvas 2D context unavailable for PPM export');

  fctx.fillStyle = backgroundColor || '#FFFFFF';
  fctx.fillRect(0, 0, width, height);
  fctx.drawImage(canvas, 0, 0, width, height);

  const rgba = fctx.getImageData(0, 0, width, height).data;

  if (variant === 'P3') {
    const header = `P3\n# Created by Universal Media & Document Studio Pro\n${width} ${height}\n255\n`;
    const lines: string[] = [header];
    for (let y = 0; y < height; y++) {
      const rowTokens: string[] = [];
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        rowTokens.push(`${rgba[idx]} ${rgba[idx + 1]} ${rgba[idx + 2]}`);
      }
      lines.push(rowTokens.join(' ') + '\n');
    }
    return new Blob(lines, { type: 'image/x-portable-pixmap' });
  }

  // Standard Binary P6
  const headerStr = `P6\n${width} ${height}\n255\n`;
  const headerBytes = new TextEncoder().encode(headerStr);
  const pixelBytes = new Uint8Array(width * height * 3);
  let dst = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    pixelBytes[dst++] = rgba[i];
    pixelBytes[dst++] = rgba[i + 1];
    pixelBytes[dst++] = rgba[i + 2];
  }
  return new Blob([headerBytes, pixelBytes], { type: 'image/x-portable-pixmap' });
}

/**
 * Inspect Windows / OS/2 BMP header fields.
 */
export function inspectBmpHeader(bytes: Uint8Array): BmpHeaderInfo | null {
  if (bytes.length < 26 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) return null;
  const dataOffset = readUint32LE(bytes, 10);
  const headerSize = readUint32LE(bytes, 14);
  if (headerSize === 12 && bytes.length >= 26) {
    // OS/2 BITMAPCOREHEADER
    const width = readUint16LE(bytes, 18);
    const height = readUint16LE(bytes, 20);
    const bitCount = readUint16LE(bytes, 24);
    return {
      width,
      height,
      topDown: false,
      bitCount,
      compression: 0,
      headerSize,
      dataOffset,
      colorsUsed: bitCount <= 8 ? 1 << bitCount : 0,
      xPelsPerMeter: 0,
      yPelsPerMeter: 0,
    };
  }
  if (bytes.length < 54) return null;
  const width = readInt32LE(bytes, 18);
  const rawHeight = readInt32LE(bytes, 22);
  const topDown = rawHeight < 0;
  const height = Math.abs(rawHeight);
  const bitCount = readUint16LE(bytes, 28);
  const compression = readUint32LE(bytes, 30);
  const xPelsPerMeter = readInt32LE(bytes, 38);
  const yPelsPerMeter = readInt32LE(bytes, 42);
  const colorsUsed = readUint32LE(bytes, 46);
  if (width <= 0 || height <= 0) return null;
  return {
    width,
    height,
    topDown,
    bitCount,
    compression,
    headerSize,
    dataOffset,
    colorsUsed: colorsUsed || (bitCount <= 8 ? 1 << bitCount : 0),
    xPelsPerMeter,
    yPelsPerMeter,
  };
}

function decodeDibToCanvas(
  bytes: Uint8Array,
  dibOffset: number,
  width: number,
  height: number,
  topDown: boolean,
  bitCount: number,
  compression: number,
  headerSize: number,
  pixelOffset: number,
  colorsUsed: number,
  isIcoDib: boolean = false
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  const imgData = ctx.createImageData(width, height);
  const out = imgData.data;

  // Locate bitmasks (for BI_BITFIELDS compression === 3) or palette
  let rMask = 0x00ff0000;
  let gMask = 0x0000ff00;
  let bMask = 0x000000ff;
  let aMask = 0xff000000;

  let paletteOffset = dibOffset + headerSize;
  if (compression === 3 && (bitCount === 16 || bitCount === 32)) {
    if (headerSize === 40 && paletteOffset + 12 <= bytes.length) {
      rMask = readUint32LE(bytes, paletteOffset);
      gMask = readUint32LE(bytes, paletteOffset + 4);
      bMask = readUint32LE(bytes, paletteOffset + 8);
      aMask = bitCount === 32 ? ~(rMask | gMask | bMask) >>> 0 : 0;
      paletteOffset += 12;
    } else if (headerSize >= 52 && dibOffset + 52 <= bytes.length) {
      rMask = readUint32LE(bytes, dibOffset + 40);
      gMask = readUint32LE(bytes, dibOffset + 44);
      bMask = readUint32LE(bytes, dibOffset + 48);
      aMask = headerSize >= 56 && dibOffset + 56 <= bytes.length ? readUint32LE(bytes, dibOffset + 52) : 0;
    }
  } else if (bitCount === 16) {
    // Default 5-5-5
    rMask = 0x7c00;
    gMask = 0x03e0;
    bMask = 0x001f;
    aMask = 0;
  }

  const paletteEntrySize = headerSize === 12 ? 3 : 4;
  const numColors = bitCount <= 8 ? (colorsUsed || (1 << bitCount)) : 0;

  const extractMaskedChannel = (val: number, mask: number): number => {
    if (!mask) return 0;
    let m = mask >>> 0;
    let shift = 0;
    while ((m & 1) === 0 && shift < 32) {
      m >>>= 1;
      shift++;
    }
    const maxV = m;
    if (maxV === 0) return 0;
    const raw = (val >>> shift) & maxV;
    return Math.round((raw * 255) / maxV);
  };

  const rowStride = Math.floor((bitCount * width + 31) / 32) * 4;
  let hasNonZeroAlpha32 = false;

  for (let row = 0; row < height; row++) {
    const srcRow = topDown ? row : height - 1 - row;
    const rowBase = pixelOffset + srcRow * rowStride;

    for (let x = 0; x < width; x++) {
      const dst = (row * width + x) * 4;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 255;

      if (bitCount === 32) {
        const p = rowBase + x * 4;
        if (p + 3 < bytes.length) {
          if (compression === 3) {
            const px = readUint32LE(bytes, p);
            r = extractMaskedChannel(px, rMask);
            g = extractMaskedChannel(px, gMask);
            b = extractMaskedChannel(px, bMask);
            a = aMask ? extractMaskedChannel(px, aMask) : 255;
            if (aMask && a > 0) hasNonZeroAlpha32 = true;
          } else {
            b = bytes[p];
            g = bytes[p + 1];
            r = bytes[p + 2];
            a = bytes[p + 3];
            if (a > 0) hasNonZeroAlpha32 = true;
          }
        }
      } else if (bitCount === 24) {
        const p = rowBase + x * 3;
        if (p + 2 < bytes.length) {
          b = bytes[p];
          g = bytes[p + 1];
          r = bytes[p + 2];
        }
      } else if (bitCount === 16) {
        const p = rowBase + x * 2;
        if (p + 1 < bytes.length) {
          const px = readUint16LE(bytes, p);
          r = extractMaskedChannel(px, rMask);
          g = extractMaskedChannel(px, gMask);
          b = extractMaskedChannel(px, bMask);
          a = aMask ? extractMaskedChannel(px, aMask) : 255;
        }
      } else if (bitCount === 8 || bitCount === 4 || bitCount === 1) {
        let idx = 0;
        if (bitCount === 8) {
          idx = rowBase + x < bytes.length ? bytes[rowBase + x] : 0;
        } else if (bitCount === 4) {
          const byteVal = rowBase + (x >> 1) < bytes.length ? bytes[rowBase + (x >> 1)] : 0;
          idx = x & 1 ? byteVal & 0x0f : (byteVal >> 4) & 0x0f;
        } else {
          const byteVal = rowBase + (x >> 3) < bytes.length ? bytes[rowBase + (x >> 3)] : 0;
          idx = (byteVal >> (7 - (x & 7))) & 1;
        }
        const palOff = paletteOffset + (idx % Math.max(1, numColors)) * paletteEntrySize;
        if (palOff + 2 < bytes.length) {
          b = bytes[palOff];
          g = bytes[palOff + 1];
          r = bytes[palOff + 2];
        }
      }

      out[dst] = r;
      out[dst + 1] = g;
      out[dst + 2] = b;
      out[dst + 3] = a;
    }
  }

  // Legacy 32-bit BMP/ICO often set alpha byte to 0 everywhere (XRGB).
  if (bitCount === 32 && !hasNonZeroAlpha32) {
    for (let i = 3; i < out.length; i += 4) {
      out[i] = 255;
    }
  }

  // For ICO DIBs, apply 1-bit AND mask if present and no 32-bit alpha was used
  if (isIcoDib && (bitCount < 32 || !hasNonZeroAlpha32)) {
    const andMaskOffset = pixelOffset + rowStride * height;
    const andRowStride = Math.floor((width + 31) / 32) * 4;
    if (andMaskOffset + andRowStride * height <= bytes.length) {
      for (let row = 0; row < height; row++) {
        const srcRow = topDown ? row : height - 1 - row;
        const andRowBase = andMaskOffset + srcRow * andRowStride;
        for (let x = 0; x < width; x++) {
          const andByte = bytes[andRowBase + (x >> 3)];
          const isTransparent = ((andByte >> (7 - (x & 7))) & 1) === 1;
          if (isTransparent) {
            out[(row * width + x) * 4 + 3] = 0;
          }
        }
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/**
 * Decode a BMP blob/bytes using browser native decoder with full manual DIB fallback.
 */
export async function decodeBmpToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  // Try native browser image decode first (fast & supports RLE BMP)
  try {
    return await decodeViaBrowserImage(blob);
  } catch {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const info = inspectBmpHeader(bytes);
    if (!info) throw new Error('無効なBMPファイルです (Invalid BMP)');
    if (info.compression !== 0 && info.compression !== 3) {
      throw new Error(`未対応のBMP圧縮形式です (Compression: ${info.compression})`);
    }
    return decodeDibToCanvas(
      bytes,
      14,
      info.width,
      info.height,
      info.topDown,
      info.bitCount,
      info.compression,
      info.headerSize,
      info.dataOffset,
      info.colorsUsed,
      false
    );
  }
}

/**
 * Inspect Windows ICO / CUR directory header & contained icon frames.
 */
export function inspectIcoHeader(bytes: Uint8Array): { type: 'ico' | 'cur'; entries: IcoEntryInfo[] } | null {
  if (bytes.length < 6) return null;
  const reserved = readUint16LE(bytes, 0);
  const type = readUint16LE(bytes, 2);
  const count = readUint16LE(bytes, 4);
  if (reserved !== 0 || (type !== 1 && type !== 2) || count <= 0 || count > 256) return null;
  if (6 + count * 16 > bytes.length) return null;

  const entries: IcoEntryInfo[] = [];
  for (let i = 0; i < count; i++) {
    const off = 6 + i * 16;
    const rawW = bytes[off];
    const rawH = bytes[off + 1];
    const colorCount = bytes[off + 2];
    const planes = readUint16LE(bytes, off + 4);
    const bitCount = readUint16LE(bytes, off + 6);
    const bytesInRes = readUint32LE(bytes, off + 8);
    const imageOffset = readUint32LE(bytes, off + 12);

    const png = imageOffset + 8 <= bytes.length && isPngSignature(bytes, imageOffset);
    let w = rawW === 0 ? 256 : rawW;
    let h = rawH === 0 ? 256 : rawH;

    // Refine PNG or DIB dimensions if available
    if (png && imageOffset + 24 <= bytes.length) {
      const pngW = (bytes[imageOffset + 16] << 24) | (bytes[imageOffset + 17] << 16) | (bytes[imageOffset + 18] << 8) | bytes[imageOffset + 19];
      const pngH = (bytes[imageOffset + 20] << 24) | (bytes[imageOffset + 21] << 16) | (bytes[imageOffset + 22] << 8) | bytes[imageOffset + 23];
      if (pngW > 0 && pngW <= 4096) w = pngW;
      if (pngH > 0 && pngH <= 4096) h = pngH;
    }

    entries.push({
      index: i,
      width: w,
      height: h,
      colorCount,
      planes,
      bitCount,
      bytesInRes,
      imageOffset,
      isPng: png,
    });
  }

  return { type: type === 2 ? 'cur' : 'ico', entries };
}

/**
 * Decode multi-resolution ICO/CUR selecting the sharpest highest-resolution frame cleanly.
 */
export async function decodeIcoToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const parsed = inspectIcoHeader(bytes);
  if (!parsed || parsed.entries.length === 0) {
    // Fallback to native <img> if non-standard
    return await decodeViaBrowserImage(blob);
  }

  // Pick largest resolution, then highest color depth
  const sorted = [...parsed.entries]
    .filter((e) => e.imageOffset < bytes.length && e.bytesInRes > 0)
    .sort((a, b) => b.width * b.height - a.width * a.height || b.bitCount - a.bitCount || b.bytesInRes - a.bytesInRes);

  for (const entry of sorted) {
    const end = Math.min(bytes.length, entry.imageOffset + entry.bytesInRes);
    const frameBytes = bytes.subarray(entry.imageOffset, end);

    try {
      if (entry.isPng || isPngSignature(frameBytes, 0)) {
        const pngBlob = new Blob([frameBytes], { type: 'image/png' });
        return await decodeViaBrowserImage(pngBlob);
      }

      // DIB inside ICO
      if (frameBytes.length >= 40) {
        const headerSize = readUint32LE(frameBytes, 0);
        const dibW = readInt32LE(frameBytes, 4);
        const dibH = readInt32LE(frameBytes, 8);
        const topDown = dibH < 0;
        const actualW = dibW > 0 ? dibW : entry.width;
        const actualH = Math.abs(dibH) >= actualW ? Math.floor(Math.abs(dibH) / 2) : Math.abs(dibH) || entry.height;
        const bitCount = readUint16LE(frameBytes, 14) || entry.bitCount || 32;
        const compression = readUint32LE(frameBytes, 16);
        const colorsUsed = readUint32LE(frameBytes, 32) || (bitCount <= 8 ? entry.colorCount || (1 << bitCount) : 0);
        const paletteLen = bitCount <= 8 ? colorsUsed * 4 : compression === 3 && headerSize === 40 ? 12 : 0;
        const pixelOffset = headerSize + paletteLen;
        return decodeDibToCanvas(
          frameBytes,
          0,
          actualW,
          actualH,
          topDown,
          bitCount,
          compression,
          headerSize,
          pixelOffset,
          colorsUsed,
          true
        );
      }
    } catch {
      // Try next frame candidate
    }
  }

  return await decodeViaBrowserImage(blob);
}

/**
 * Decode a Blob via standard browser HTMLImageElement -> HTMLCanvasElement.
 */
export async function decodeViaBrowserImage(blob: Blob): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Failed to decode image in browser'));
      image.src = url;
    });
    const w = Math.max(1, img.naturalWidth || img.width || 1);
    const h = Math.max(1, img.naturalHeight || img.height || 1);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.drawImage(img, 0, 0, w, h);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Unified decoder for ALL image formats supported by the app:
 * PPM (P3/P6 & PGM/PBM), ICO/CUR, BMP, PNG, JPEG, WebP, GIF, SVG.
 */
export async function decodeAnyImageToCanvas(
  fileOrBlob: File | Blob,
  hintName?: string
): Promise<DecodedImageResult> {
  const headSize = Math.min(fileOrBlob.size, 64);
  const head = new Uint8Array(await fileOrBlob.slice(0, headSize).arrayBuffer());
  const ext = (hintName || (fileOrBlob instanceof File ? fileOrBlob.name : '')).split('.').pop()?.toLowerCase() || '';

  if (isNetpbmBytes(head) || ext === 'ppm' || ext === 'pnm' || ext === 'pgm' || ext === 'pbm') {
    const fullBytes = new Uint8Array(await fileOrBlob.arrayBuffer());
    if (isNetpbmBytes(fullBytes)) {
      const canvas = decodePpmToCanvas(fullBytes);
      return { canvas, width: canvas.width, height: canvas.height, detectedFormat: 'ppm' };
    }
  }

  if (
    (head.length >= 4 && head[0] === 0x00 && head[1] === 0x00 && (head[2] === 0x01 || head[2] === 0x02) && head[3] === 0x00) ||
    ext === 'ico' ||
    ext === 'cur'
  ) {
    const canvas = await decodeIcoToCanvas(fileOrBlob);
    return { canvas, width: canvas.width, height: canvas.height, detectedFormat: 'ico' };
  }

  if ((head.length >= 2 && head[0] === 0x42 && head[1] === 0x4d) || ext === 'bmp' || ext === 'dib') {
    const canvas = await decodeBmpToCanvas(fileOrBlob);
    return { canvas, width: canvas.width, height: canvas.height, detectedFormat: 'bmp' };
  }

  const canvas = await decodeViaBrowserImage(fileOrBlob);
  return {
    canvas,
    width: canvas.width,
    height: canvas.height,
    detectedFormat: ext || 'image',
  };
}

/**
 * Check if a file/format needs canvas-based preview transcoding (e.g., PPM cannot be rendered natively by <img>,
 * and multi-res ICO renders more crisply via highest-res PNG preview).
 */
export function needsDecodedPreview(formatOrName: string): boolean {
  const lower = (formatOrName || '').toLowerCase();
  return lower === 'ppm' || lower === 'pnm' || lower === 'pgm' || lower === 'pbm' || /\.(ppm|pnm|pgm|pbm|ico)$/i.test(lower);
}

/**
 * Build a browser-renderable ObjectURL for any image file (transcoding PPM/multi-res ICO to PNG preview).
 */
export async function createUniversalPreviewUrl(fileOrBlob: File | Blob, formatOrName?: string): Promise<string> {
  const nameHint = formatOrName || (fileOrBlob instanceof File ? fileOrBlob.name : '');
  if (!needsDecodedPreview(nameHint)) {
    return URL.createObjectURL(fileOrBlob);
  }
  try {
    const { canvas } = await decodeAnyImageToCanvas(fileOrBlob, nameHint);
    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Preview PNG encode failed'))), 'image/png');
    });
    return URL.createObjectURL(pngBlob);
  } catch {
    return URL.createObjectURL(fileOrBlob);
  }
}
