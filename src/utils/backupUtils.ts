import JSZip from 'jszip';
import { FileItem, DocumentFormat } from '../types';
import {
  getAllHistory,
  saveProcessedFile,
  savePendingFile,
  HistoryItem,
} from './historyDb';

export interface BackupManifest {
  version: string;
  exportedAt: string;
  activeTab: string;
  lang: 'ja' | 'en';
  theme: 'auto' | 'light' | 'dark';
  htmlStudioDraft?: {
    content: string;
    docType: 'html' | 'markdown';
    fileName: string;
    updatedAt: number;
  } | null;
  gdriveConnection?: {
    connected: boolean;
    user?: {
      displayName?: string;
      emailAddress?: string;
      photoLink?: string;
    } | null;
  } | null;
  pendingFiles: {
    id: string;
    name: string;
    size: number;
    type: string;
    format: DocumentFormat;
    targetFormat: DocumentFormat;
    status: 'idle' | 'processing' | 'done' | 'error';
    progress: number;
    resultName?: string;
    zipEntryPath: string;
    resultZipEntryPath?: string;
  }[];
  historyItems: {
    id: string;
    originalName: string;
    fileName: string;
    format: string;
    timestamp: number;
    zipEntryPath: string;
  }[];
}

/**
 * Export entire workspace (loaded/in-progress files, converted results, history, and UI settings)
 * as a single portable ZIP archive (.umc-backup.zip) that can be imported on any device.
 */
export async function exportWorkspaceBackup(
  fileList: FileItem[],
  activeTab: string,
  lang: 'ja' | 'en',
  theme: 'auto' | 'light' | 'dark',
  includeHistory: boolean = true
): Promise<Blob> {
  const zip = new JSZip();

  // Read HTML / Markdown editor draft from localStorage if present
  let htmlStudioDraft: BackupManifest['htmlStudioDraft'] = null;
  try {
    const savedContent = localStorage.getItem('umc_html_studio_content');
    const savedDocType = (localStorage.getItem('umc_html_studio_doctype') as 'html' | 'markdown') || 'html';
    const savedFileName = localStorage.getItem('umc_html_studio_filename') || (savedDocType === 'markdown' ? 'document.md' : 'document.html');
    const savedAt = parseInt(localStorage.getItem('umc_html_studio_updated_at') || '0', 10);
    if (savedContent) {
      htmlStudioDraft = {
        content: savedContent,
        docType: savedDocType,
        fileName: savedFileName,
        updatedAt: savedAt || Date.now(),
      };
    }
  } catch (e) {
    console.warn('Could not read HTML studio draft for backup:', e);
  }

  // Google Drive connection info
  let gdriveConnection: BackupManifest['gdriveConnection'] = null;
  try {
    const rawUser = localStorage.getItem('gdrive_user_info');
    const isConn = localStorage.getItem('gdrive_connected') === 'true' || !!localStorage.getItem('gdrive_access_token');
    if (isConn) {
      gdriveConnection = {
        connected: true,
        user: rawUser ? JSON.parse(rawUser) : null,
      };
    }
  } catch (e) {
    console.warn('Could not read Google Drive connection for backup:', e);
  }

  const manifest: BackupManifest = {
    version: '2.0',
    exportedAt: new Date().toISOString(),
    activeTab,
    lang,
    theme,
    htmlStudioDraft,
    gdriveConnection,
    pendingFiles: [],
    historyItems: [],
  };

  // 1. Add all current queue/in-progress files
  for (let i = 0; i < fileList.length; i++) {
    const item = fileList[i];
    if (!item.file) continue;

    try {
      const safeName = item.name.replace(/[/\\?%*:|"<>]/g, '_');
      const entryPath = `pending/${i}_${item.id}_${safeName}`;
      const buf = await item.file.arrayBuffer();
      zip.file(entryPath, buf);

      let resultEntryPath: string | undefined;
      if (item.resultBlob) {
        const resSafeName = (item.resultName || `result_${safeName}`).replace(/[/\\?%*:|"<>]/g, '_');
        resultEntryPath = `results/${i}_${item.id}_${resSafeName}`;
        const resBuf = await item.resultBlob.arrayBuffer();
        zip.file(resultEntryPath, resBuf);
      }

      manifest.pendingFiles.push({
        id: item.id,
        name: item.name,
        size: item.size,
        type: item.type || 'application/octet-stream',
        format: item.format,
        targetFormat: item.targetFormat,
        status: item.status === 'processing' ? 'idle' : item.status,
        progress: item.status === 'done' ? 100 : 0,
        resultName: item.resultName,
        zipEntryPath: entryPath,
        resultZipEntryPath: resultEntryPath,
      });
    } catch (itemErr) {
      console.warn(`Failed to package item ${item.name}:`, itemErr);
    }
  }

  // 2. Optionally include processed history from IndexedDB
  if (includeHistory) {
    try {
      const historyList: HistoryItem[] = await getAllHistory();
      for (let j = 0; j < historyList.length; j++) {
        const h = historyList[j];
        const safeFileName = h.fileName.replace(/[/\\?%*:|"<>]/g, '_');
        const hPath = `history/${j}_${h.id}_${safeFileName}`;
        zip.file(hPath, h.data);

        manifest.historyItems.push({
          id: h.id,
          originalName: h.originalName,
          fileName: h.fileName,
          format: h.format,
          timestamp: h.timestamp,
          zipEntryPath: hPath,
        });
      }
    } catch (histErr) {
      console.warn('Failed to package history:', histErr);
    }
  }

  // 3. Write manifest.json
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  return await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

/**
 * Restore workspace backup from a .zip backup file onto the current device.
 */
export async function importWorkspaceBackup(backupFile: File): Promise<{
  restoredFiles: FileItem[];
  activeTab: string;
  lang: 'ja' | 'en';
  theme: 'auto' | 'light' | 'dark';
  historyCount: number;
  htmlStudioDraft?: BackupManifest['htmlStudioDraft'];
}> {
  const zip = await JSZip.loadAsync(backupFile);
  const manifestEntry = zip.file('manifest.json');
  if (!manifestEntry) {
    throw new Error('無効なバックアップファイルです。manifest.jsonが見つかりません。');
  }

  const manifestText = await manifestEntry.async('text');
  const manifest: BackupManifest = JSON.parse(manifestText);

  const restoredFiles: FileItem[] = [];

  // 1. Restore pending & in-progress files
  for (const pf of manifest.pendingFiles || []) {
    try {
      const fileEntry = zip.file(pf.zipEntryPath);
      if (!fileEntry) continue;

      const arrayBuf = await fileEntry.async('arraybuffer');
      const fileObj = new File([arrayBuf], pf.name, { type: pf.type || 'application/octet-stream' });

      let resultBlob: Blob | undefined;
      let resultUrl: string | undefined;
      if (pf.resultZipEntryPath) {
        const resEntry = zip.file(pf.resultZipEntryPath);
        if (resEntry) {
          const resBuf = await resEntry.async('arraybuffer');
          resultBlob = new Blob([resBuf]);
          resultUrl = URL.createObjectURL(resultBlob);
        }
      }

      const previewUrl = ['png', 'jpg', 'jpeg', 'webp', 'svg', 'bmp', 'gif', 'ico'].includes(pf.format)
        ? URL.createObjectURL(fileObj)
        : undefined;

      restoredFiles.push({
        id: pf.id || `file_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        file: fileObj,
        name: pf.name,
        size: pf.size,
        type: pf.type,
        format: pf.format,
        targetFormat: pf.targetFormat,
        status: pf.status,
        progress: pf.progress,
        resultBlob,
        resultName: pf.resultName,
        resultUrl,
        previewUrl,
      });

      // Persist into IndexedDB pending store so reloads on this new device keep it
      await savePendingFile({
        id: pf.id,
        name: pf.name,
        size: pf.size,
        type: pf.type,
        format: pf.format,
        targetFormat: pf.targetFormat,
        data: arrayBuf,
        date: Date.now(),
      });
    } catch (e) {
      console.warn('Failed restoring file entry:', pf.name, e);
    }
  }

  // 2. Restore history items into IndexedDB
  let historyCount = 0;
  for (const hi of manifest.historyItems || []) {
    try {
      const hEntry = zip.file(hi.zipEntryPath);
      if (!hEntry) continue;
      const hBuf = await hEntry.async('arraybuffer');
      await saveProcessedFile(hi.id, hi.originalName, hi.fileName, hBuf, hi.format);
      historyCount++;
    } catch (e) {
      console.warn('Failed restoring history entry:', hi.fileName, e);
    }
  }

  // 3. Restore HTML/Markdown studio draft into localStorage
  if (manifest.htmlStudioDraft) {
    try {
      localStorage.setItem('umc_html_studio_content', manifest.htmlStudioDraft.content);
      localStorage.setItem('umc_html_studio_doctype', manifest.htmlStudioDraft.docType);
      localStorage.setItem('umc_html_studio_filename', manifest.htmlStudioDraft.fileName);
      localStorage.setItem('umc_html_studio_updated_at', String(manifest.htmlStudioDraft.updatedAt));
      window.dispatchEvent(new CustomEvent('umc_html_draft_restored'));
    } catch (e) {
      console.warn('Could not restore HTML studio draft to localStorage:', e);
    }
  }

  // 4. Restore preferences
  if (manifest.lang) {
    localStorage.setItem('user_lang', manifest.lang);
  }
  if (manifest.theme) {
    localStorage.setItem('user_theme', manifest.theme);
  }

  // 5. Restore Google Drive connection info
  if (manifest.gdriveConnection?.connected) {
    try {
      localStorage.setItem('gdrive_connected', 'true');
      if (manifest.gdriveConnection.user) {
        localStorage.setItem('gdrive_user_info', JSON.stringify(manifest.gdriveConnection.user));
      }
    } catch (e) {
      console.warn('Could not restore Google Drive connection info:', e);
    }
  }

  return {
    restoredFiles,
    activeTab: manifest.activeTab || 'converter',
    lang: manifest.lang || 'ja',
    theme: manifest.theme || 'auto',
    historyCount,
    htmlStudioDraft: manifest.htmlStudioDraft,
  };
}
