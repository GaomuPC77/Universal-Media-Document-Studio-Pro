import JSZip from 'jszip';

export interface ZipEntryInfo {
  name: string;
  size: number;
  date: Date;
  dir: boolean;
  compressedSize: number;
}

/**
 * Inspect contents of a ZIP file
 */
export async function inspectZip(file: File | ArrayBuffer): Promise<ZipEntryInfo[]> {
  const data = file instanceof File ? await file.arrayBuffer() : file;
  const zip = await JSZip.loadAsync(data);
  const entries: ZipEntryInfo[] = [];

  zip.forEach((relativePath, zipEntry) => {
    // @ts-ignore
    const uncompressed = zipEntry._data ? zipEntry._data.uncompressedSize : 0;
    // @ts-ignore
    const compressed = zipEntry._data ? zipEntry._data.compressedSize : 0;
    entries.push({
      name: relativePath,
      size: uncompressed,
      compressedSize: compressed,
      date: zipEntry.date,
      dir: zipEntry.dir,
    });
  });

  return entries;
}

/**
 * Extract single file from ZIP as Blob
 */
export async function extractZipEntry(file: File | ArrayBuffer, entryName: string): Promise<Blob> {
  const data = file instanceof File ? await file.arrayBuffer() : file;
  const zip = await JSZip.loadAsync(data);
  const entry = zip.file(entryName);
  if (!entry) {
    throw new Error(`File "${entryName}" not found in zip archive.`);
  }
  return await entry.async('blob');
}

/**
 * Create a new ZIP archive from file objects
 */
export async function createZipArchive(
  files: { name: string; content: Blob | ArrayBuffer | string }[],
  options?: { compressionLevel?: number }
): Promise<Blob> {
  const zip = new JSZip();

  for (const f of files) {
    zip.file(f.name, f.content);
  }

  return await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: {
      level: options?.compressionLevel || 6,
    },
  });
}
