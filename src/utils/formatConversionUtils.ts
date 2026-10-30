/**
 * Universal Format Conversion Utilities
 * Handles Image mutual conversions (PNG, JPG, WebP, BMP, ICO, SVG),
 * Data conversions (CSV, TSV, XLSX, JSON, HTML/MD Table),
 * and Audio extraction/conversion (WAV/MP3).
 */

import * as XLSX from 'xlsx';
import { parseSpreadsheet, exportSpreadsheet, createDocxFromText } from './officeUtils';

export type ImageTargetFormat = 'png' | 'jpg' | 'jpeg' | 'webp' | 'bmp' | 'ico';
export type DataTargetFormat = 'csv' | 'tsv' | 'xlsx' | 'json' | 'html' | 'md';
export type TextTargetFormat = 'docx' | 'html' | 'md' | 'txt';
export type AudioTargetFormat = 'wav';

export interface ImageConversionOptions {
  targetFormat: ImageTargetFormat;
  quality: number; // 0.1 to 1.0 (default 0.92)
  scale: number; // 0.25, 0.5, 0.75, 1.0, 1.5, 2.0
  customWidth?: number;
  customHeight?: number;
  fillBackgroundForOpaque: boolean;
  backgroundColor: string; // e.g. '#FFFFFF'
  icoSizes?: number[]; // [16, 32, 48, 64, 128, 256]
}

/**
 * Convert canvas image data to 24-bit standard Windows BMP Blob
 */
export function canvasToBmpBlob(canvas: HTMLCanvasElement): Blob {
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D context for BMP');

  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  // Row width in bytes padded to multiple of 4
  const rowBytes = Math.floor((24 * width + 31) / 32) * 4;
  const pixelArraySize = rowBytes * height;
  const fileHeaderSize = 14;
  const dibHeaderSize = 40;
  const fileSize = fileHeaderSize + dibHeaderSize + pixelArraySize;

  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);

  // Bitmap File Header (14 bytes)
  view.setUint16(0, 0x424d, false); // 'BM'
  view.setUint32(2, fileSize, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, 0, true);
  view.setUint32(10, fileHeaderSize + dibHeaderSize, true); // pixel data offset

  // DIB Header (BITMAPINFOHEADER 40 bytes)
  view.setUint32(14, dibHeaderSize, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true); // bottom-up
  view.setUint16(26, 1, true); // 1 plane
  view.setUint16(28, 24, true); // 24-bit color
  view.setUint32(30, 0, true); // BI_RGB (uncompressed)
  view.setUint32(34, pixelArraySize, true);
  view.setInt32(38, 2835, true); // 72 DPI (horizontal)
  view.setInt32(42, 2835, true); // 72 DPI (vertical)
  view.setUint32(46, 0, true);
  view.setUint32(50, 0, true);

  // Write pixel rows from bottom to top (BGR order)
  let offset = fileHeaderSize + dibHeaderSize;
  for (let y = height - 1; y >= 0; y--) {
    let rowOffset = offset;
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const r = data[srcIdx];
      const g = data[srcIdx + 1];
      const b = data[srcIdx + 2];
      view.setUint8(rowOffset++, b);
      view.setUint8(rowOffset++, g);
      view.setUint8(rowOffset++, r);
    }
    // padding bytes
    while (rowOffset < offset + rowBytes) {
      view.setUint8(rowOffset++, 0);
    }
    offset += rowBytes;
  }

  return new Blob([buffer], { type: 'image/bmp' });
}

/**
 * Generate standard multi-resolution ICO file containing PNG-encoded icon frames
 */
export async function canvasToIcoBlob(
  sourceImage: CanvasImageSource,
  sizes: number[] = [16, 32, 48, 64, 128, 256]
): Promise<Blob> {
  const iconFrames: { width: number; height: number; data: Uint8Array }[] = [];

  for (const size of sizes) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    if (!ctx) continue;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(sourceImage, 0, 0, size, size);

    const pngBlob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
    if (pngBlob) {
      const arr = new Uint8Array(await pngBlob.arrayBuffer());
      iconFrames.push({ width: size, height: size, data: arr });
    }
  }

  if (iconFrames.length === 0) {
    throw new Error('Failed to generate ICO frames');
  }

  const numImages = iconFrames.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = numImages * dirEntrySize;

  let totalSize = headerSize + dirSize;
  for (const frame of iconFrames) {
    totalSize += frame.data.length;
  }

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const uint8 = new Uint8Array(buffer);

  // ICO Header
  view.setUint16(0, 0, true); // Reserved (0)
  view.setUint16(2, 1, true); // Type (1 = Icon, 2 = Cursor)
  view.setUint16(4, numImages, true); // Number of images

  let currentImageOffset = headerSize + dirSize;

  for (let i = 0; i < numImages; i++) {
    const frame = iconFrames[i];
    const entryOffset = headerSize + i * dirEntrySize;

    view.setUint8(entryOffset, frame.width >= 256 ? 0 : frame.width);
    view.setUint8(entryOffset + 1, frame.height >= 256 ? 0 : frame.height);
    view.setUint8(entryOffset + 2, 0); // Palette colors (0 = no palette)
    view.setUint8(entryOffset + 3, 0); // Reserved
    view.setUint16(entryOffset + 4, 1, true); // Color planes
    view.setUint16(entryOffset + 6, 32, true); // Bits per pixel
    view.setUint32(entryOffset + 8, frame.data.length, true); // Image data size
    view.setUint32(entryOffset + 12, currentImageOffset, true); // Image data offset

    // Copy PNG data
    uint8.set(frame.data, currentImageOffset);
    currentImageOffset += frame.data.length;
  }

  return new Blob([buffer], { type: 'image/x-icon' });
}

/**
 * Universal Image to Image Converter
 */
export async function convertImage(
  file: File | Blob,
  options: ImageConversionOptions
): Promise<Blob> {
  return new Promise(async (resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = async () => {
      try {
        let targetW = Math.round(img.naturalWidth * options.scale);
        let targetH = Math.round(img.naturalHeight * options.scale);

        if (options.customWidth && options.customHeight) {
          targetW = options.customWidth;
          targetH = options.customHeight;
        } else if (options.customWidth) {
          const ratio = options.customWidth / img.naturalWidth;
          targetW = options.customWidth;
          targetH = Math.round(img.naturalHeight * ratio);
        } else if (options.customHeight) {
          const ratio = options.customHeight / img.naturalHeight;
          targetH = options.customHeight;
          targetW = Math.round(img.naturalWidth * ratio);
        }

        targetW = Math.max(1, targetW);
        targetH = Math.max(1, targetH);

        // ICO format output
        if (options.targetFormat === 'ico') {
          const icoBlob = await canvasToIcoBlob(img, options.icoSizes || [16, 32, 48, 64, 128, 256]);
          URL.revokeObjectURL(url);
          resolve(icoBlob);
          return;
        }

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not get 2D canvas context');

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        const isOpaqueTarget = options.targetFormat === 'jpg' || options.targetFormat === 'jpeg' || options.targetFormat === 'bmp';
        if (isOpaqueTarget || options.fillBackgroundForOpaque) {
          ctx.fillStyle = options.backgroundColor || '#FFFFFF';
          ctx.fillRect(0, 0, targetW, targetH);
        }

        ctx.drawImage(img, 0, 0, targetW, targetH);

        // BMP format output
        if (options.targetFormat === 'bmp') {
          const bmpBlob = canvasToBmpBlob(canvas);
          URL.revokeObjectURL(url);
          resolve(bmpBlob);
          return;
        }

        // Standard PNG / JPEG / WebP
        let mime = 'image/png';
        if (options.targetFormat === 'jpg' || options.targetFormat === 'jpeg') {
          mime = 'image/jpeg';
        } else if (options.targetFormat === 'webp') {
          mime = 'image/webp';
        }

        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(url);
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Canvas export produced null blob'));
            }
          },
          mime,
          options.quality
        );
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for conversion'));
    };

    img.src = url;
  });
}

/**
 * Universal Data to Data Converter (CSV, TSV, XLSX, JSON, HTML Table, Markdown Table)
 */
export async function convertDataFormat(
  file: File | Blob,
  sourceExt: string,
  targetFormat: DataTargetFormat
): Promise<Blob> {
  let matrix: any[][] = [];

  if (['csv', 'tsv', 'xlsx', 'xls'].includes(sourceExt.toLowerCase())) {
    const parsed = await parseSpreadsheet(file);
    const firstSheet = parsed.sheets[parsed.sheetNames[0]] || [];
    matrix = firstSheet;
  } else if (sourceExt.toLowerCase() === 'json') {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      if (parsed.length > 0 && typeof parsed[0] === 'object' && !Array.isArray(parsed[0])) {
        const keys = Array.from(new Set(parsed.flatMap((item) => Object.keys(item || {}))));
        matrix.push(keys);
        for (const item of parsed) {
          matrix.push(keys.map((k) => (item && item[k] !== undefined ? item[k] : '')));
        }
      } else if (Array.isArray(parsed[0])) {
        matrix = parsed;
      } else {
        matrix = parsed.map((item) => [item]);
      }
    } else if (typeof parsed === 'object') {
      matrix = [['Key', 'Value'], ...Object.entries(parsed)];
    }
  } else {
    // Plain text or CSV fallback
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const delimiter = lines[0]?.includes('\t') ? '\t' : ',';
    matrix = lines.map((l) => l.split(delimiter).map((c) => c.replace(/^["']|["']$/g, '')));
  }

  if (targetFormat === 'html') {
    if (matrix.length === 0) {
      return new Blob(['<p>No data</p>'], { type: 'text/html' });
    }
    const headers = matrix[0] || [];
    const rows = matrix.slice(1);
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Data Table</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 24px; color: #1e293b; background: #f8fafc; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border-radius: 8px; overflow: hidden; }
    th { background: #0284c7; color: #fff; text-align: left; padding: 10px 14px; font-size: 14px; }
    td { padding: 10px 14px; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
    tr:nth-child(even) { background: #f1f5f9; }
    tr:hover { background: #e0f2fe; }
  </style>
</head>
<body>
  <h2>Data Table Export</h2>
  <table>
    <thead><tr>${headers.map((h: any) => `<th>${escapeHtml(String(h ?? ''))}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((row: any[]) => `<tr>${row.map((c) => `<td>${escapeHtml(String(c ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody>
  </table>
</body>
</html>`;
    return new Blob([html], { type: 'text/html;charset=utf-8' });
  }

  return exportSpreadsheet(matrix, targetFormat, 'Export');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Universal Text to Document Converter (Text/Markdown to Word .docx, HTML, Markdown)
 */
export async function convertTextDocument(
  file: File | Blob,
  sourceExt: string,
  targetFormat: TextTargetFormat,
  title: string = 'Document'
): Promise<Blob> {
  const text = await file.text();

  if (targetFormat === 'docx') {
    return await createDocxFromText(text, { title });
  }

  if (targetFormat === 'html') {
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.7; padding: 32px; max-width: 800px; margin: 0 auto; color: #334155; }
    pre { background: #f1f5f9; padding: 16px; border-radius: 8px; overflow-x: auto; white-space: pre-wrap; font-family: monospace; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <pre>${escapeHtml(text)}</pre>
</body>
</html>`;
    return new Blob([html], { type: 'text/html;charset=utf-8' });
  }

  if (targetFormat === 'md') {
    return new Blob([text], { type: 'text/markdown;charset=utf-8' });
  }

  return new Blob([text], { type: 'text/plain;charset=utf-8' });
}

/**
 * Audio / Video audio extraction to WAV format
 */
export async function extractOrConvertAudioToWav(file: File | Blob): Promise<Blob> {
  const arrayBuffer = await file.arrayBuffer();
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) {
    throw new Error('Web Audio API is not supported in this browser.');
  }

  const ctx = new AudioCtx();
  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const wavBlob = audioBufferToWav(audioBuffer);
    return wavBlob;
  } finally {
    if (ctx.state !== 'closed') {
      ctx.close().catch(() => {});
    }
  }
}

/**
 * Convert AudioBuffer to 16-bit PCM WAV Blob
 */
function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  let result: Float32Array;
  if (numChannels === 2) {
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    result = new Float32Array(left.length + right.length);
    for (let i = 0; i < left.length; i++) {
      result[i * 2] = left[i];
      result[i * 2 + 1] = right[i];
    }
  } else {
    result = buffer.getChannelData(0);
  }

  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = result.length * bytesPerSample;
  const bufferLength = 44 + dataSize;

  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);

  // RIFF identifier
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, format, true); // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Write PCM samples
  let offset = 44;
  for (let i = 0; i < result.length; i++) {
    const s = Math.max(-1, Math.min(1, result[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
