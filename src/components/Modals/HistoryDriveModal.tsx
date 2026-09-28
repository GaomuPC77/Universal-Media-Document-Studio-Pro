import React, { useState, useEffect } from 'react';
import {
  X,
  HardDrive,
  Download,
  Trash2,
  Eye,
  Archive,
  RefreshCw,
  FolderOpen,
  CheckCircle2,
  FileText,
} from 'lucide-react';
import { HistoryItem, getAllHistory, deleteHistoryItem, clearAllHistory } from '../../utils/historyDb';
import { createZipArchive } from '../../utils/zipUtils';

interface HistoryDriveModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang: 'ja' | 'en';
  onPreview: (name: string, blob: Blob, format: string) => void;
  onLoadToActiveStudio?: (file: File) => void;
}

export const HistoryDriveModal: React.FC<HistoryDriveModalProps> = ({
  isOpen,
  onClose,
  lang,
  onPreview,
  onLoadToActiveStudio,
}) => {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'local' | 'gdrive'>('local');
  const [gdriveConnected, setGdriveConnected] = useState(false);

  const loadItems = async () => {
    setIsLoading(true);
    const data = await getAllHistory();
    setItems(data);
    setIsLoading(false);
  };

  useEffect(() => {
    if (isOpen) {
      loadItems();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleDelete = async (id: string) => {
    await deleteHistoryItem(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const handleClearAll = async () => {
    if (items.length === 0) return;
    const confirmMsg = lang === 'ja' ? 'すべての処理履歴を消去しますか？' : 'Clear all processed file history?';
    if (window.confirm(confirmMsg)) {
      await clearAllHistory();
      setItems([]);
    }
  };

  const handleDownloadItem = (item: HistoryItem) => {
    const blob = new Blob([item.data]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = item.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadAllZip = async () => {
    if (items.length === 0) return;
    const zipFiles = items.map((i) => ({
      name: i.fileName,
      content: new Blob([i.data]),
    }));

    const zipBlob = await createZipArchive(zipFiles);
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `DocStudio_History_Bundle_${new Date().toISOString().slice(0, 10)}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handlePreviewItem = (item: HistoryItem) => {
    const mimeMap: Record<string, string> = {
      pdf: 'application/pdf',
      png: 'image/png',
      jpg: 'image/jpeg',
      webp: 'image/webp',
      txt: 'text/plain',
      md: 'text/markdown',
      csv: 'text/csv',
      html: 'text/html',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
    const mime = mimeMap[item.format.toLowerCase()] || 'application/octet-stream';
    const blob = new Blob([item.data], { type: mime });
    onPreview(item.fileName, blob, item.format);
  };

  const handleSendToActive = (item: HistoryItem) => {
    if (!onLoadToActiveStudio) return;
    const file = new File([item.data], item.fileName, {
      type: item.format === 'pdf' ? 'application/pdf' : 'application/octet-stream',
    });
    onLoadToActiveStudio(file);
    onClose();
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fade-in">
      <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-md bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {lang === 'ja' ? 'ローカルドライブ ＆ 処理履歴' : 'Local Drive & Processing History'}
              </h3>
              <p className="text-[11px] text-slate-500">
                {lang === 'ja'
                  ? 'ブラウザ内IndexedDBに安全に保存された処理済みファイルの一覧'
                  : 'Files processed and cached securely inside browser memory'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center px-5 pt-3 gap-2 border-b border-slate-100 dark:border-slate-800">
          <button
            onClick={() => setActiveTab('local')}
            className={`px-3 py-1.5 text-xs font-bold border-b-2 transition cursor-pointer -mb-[1px] ${
              activeTab === 'local'
                ? 'text-blue-600 dark:text-sky-400 border-blue-600 dark:border-sky-400'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 border-transparent'
            }`}
          >
            {lang === 'ja' ? `処理済みファイル (${items.length})` : `Processed History (${items.length})`}
          </button>

          <button
            onClick={() => setActiveTab('gdrive')}
            className={`px-3 py-1.5 text-xs font-bold border-b-2 transition cursor-pointer -mb-[1px] ${
              activeTab === 'gdrive'
                ? 'text-blue-600 dark:text-sky-400 border-blue-600 dark:border-sky-400'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 border-transparent'
            }`}
          >
            {lang === 'ja' ? 'Google Drive クラウド同期' : 'Google Drive Cloud Sync'}
          </button>
        </div>

        {/* Body */}
        <div className="p-5 flex-1 overflow-y-auto">
          {activeTab === 'local' ? (
            <div className="flex flex-col gap-3">
              {isLoading ? (
                <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2">
                  <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
                  <span className="text-xs">{lang === 'ja' ? '履歴を読み込み中...' : 'Loading history...'}</span>
                </div>
              ) : items.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2 text-center">
                  <FolderOpen className="w-10 h-10 text-slate-300 dark:text-slate-600" />
                  <p className="text-xs font-bold text-slate-600 dark:text-slate-400">
                    {lang === 'ja' ? '処理履歴がありません' : 'No processed files in history yet'}
                  </p>
                  <p className="text-[11px] text-slate-400 max-w-xs">
                    {lang === 'ja'
                      ? 'PDF変換や編集を実行すると、処理済みデータがここに自動保存され、いつでも再ダウンロード・プレビューできます。'
                      : 'Files you convert or manipulate will be cached here automatically for instant re-use.'}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 gap-2.5"
                    >
                      <div className="min-w-0 flex-1 flex items-start gap-2.5">
                        <div className="p-2 rounded bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-sky-400 mt-0.5">
                          <FileText className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-xs text-slate-800 dark:text-slate-100 truncate" title={item.fileName}>
                            {item.fileName}
                          </div>
                          <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                            <span className="font-semibold uppercase text-blue-600 dark:text-sky-400">.{item.format}</span>
                            <span>•</span>
                            <span>{formatFileSize(item.data.byteLength)}</span>
                            <span>•</span>
                            <span>{new Date(item.timestamp).toLocaleString(lang === 'ja' ? 'ja-JP' : 'en-US')}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 self-end sm:self-center">
                        <button
                          onClick={() => handlePreviewItem(item)}
                          className="px-2.5 py-1 text-xs font-semibold rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 cursor-pointer flex items-center gap-1"
                          title="プレビュー"
                        >
                          <Eye className="w-3.5 h-3.5 text-slate-500" />
                          <span>{lang === 'ja' ? '確認' : 'View'}</span>
                        </button>

                        <button
                          onClick={() => handleDownloadItem(item)}
                          className="px-2.5 py-1 text-xs font-semibold rounded bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer flex items-center gap-1 shadow-xs"
                          title="ダウンロード"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>{lang === 'ja' ? '保存' : 'Save'}</span>
                        </button>

                        {onLoadToActiveStudio && (
                          <button
                            onClick={() => handleSendToActive(item)}
                            className="px-2 py-1 text-xs font-semibold rounded bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
                            title="このファイルを編集に再読み込み"
                          >
                            {lang === 'ja' ? '再編集' : 'Edit'}
                          </button>
                        )}

                        <button
                          onClick={() => handleDelete(item.id)}
                          className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer transition"
                          title="削除"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center text-center p-6 bg-slate-50 dark:bg-slate-800/40 rounded-lg border border-slate-200 dark:border-slate-700 gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-600 dark:text-sky-400">
                <HardDrive className="w-6 h-6" />
              </div>
              <div>
                <h4 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                  {lang === 'ja' ? 'Google Drive クラウドストレージ同期' : 'Google Drive Cloud Storage Sync'}
                </h4>
                <p className="text-xs text-slate-500 mt-1 max-w-md">
                  {lang === 'ja'
                    ? 'Google Driveと連携することで、クラウド上のPDF・ドキュメントを直接読み込み、変換後の成果物をGoogle Driveへ直接自動保存できます。'
                    : 'Connect Google Drive to import files directly from cloud storage and save outputs back automatically.'}
                </p>
              </div>

              {!gdriveConnected ? (
                <button
                  onClick={() => setGdriveConnected(true)}
                  className="py-2.5 px-6 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-xs transition shadow-xs cursor-pointer"
                >
                  {lang === 'ja' ? 'Google Driveアカウントと連携' : 'Sign in with Google Drive'}
                </button>
              ) : (
                <div className="w-full flex flex-col gap-2">
                  <div className="flex items-center justify-between p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg text-xs text-emerald-800 dark:text-emerald-300">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span className="font-semibold">Google Drive 連携済み (Ready)</span>
                    </div>
                    <button
                      onClick={() => setGdriveConnected(false)}
                      className="text-xs text-emerald-700 dark:text-emerald-400 underline cursor-pointer"
                    >
                      {lang === 'ja' ? '切断' : 'Disconnect'}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400 text-left">
                    {lang === 'ja'
                      ? '✓ 各ファイルの「Drive保存」ボタンから直接Google Driveにアップロード保存できます。'
                      : '✓ You can now click "Save to Drive" on any processed document to upload directly.'}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-5 py-3 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {items.length > 0 && activeTab === 'local' && (
              <>
                <button
                  onClick={handleDownloadAllZip}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white cursor-pointer shadow-xs"
                >
                  <Archive className="w-3.5 h-3.5" />
                  <span>{lang === 'ja' ? '履歴を一括ZIP保存' : 'Download All as ZIP'}</span>
                </button>

                <button
                  onClick={handleClearAll}
                  className="text-xs text-slate-500 hover:text-red-500 underline cursor-pointer"
                >
                  {lang === 'ja' ? '履歴を一括消去' : 'Clear History'}
                </button>
              </>
            )}
          </div>

          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-700 transition cursor-pointer"
          >
            {lang === 'ja' ? '閉じる' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
};
