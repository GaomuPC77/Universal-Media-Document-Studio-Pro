import React, { useState, useEffect } from 'react';
import {
  History,
  Download,
  Trash2,
  Eye,
  Archive,
  RefreshCw,
  FolderOpen,
  FileText,
  Search,
  FileSpreadsheet,
  Layers,
  ArrowUpRight,
} from 'lucide-react';
import { HistoryItem, getAllHistory, deleteHistoryItem, clearAllHistory } from '../../utils/historyDb';
import { createZipArchive } from '../../utils/zipUtils';

interface HistoryTabProps {
  lang: 'ja' | 'en';
  onPreview: (name: string, blob: Blob, format: string) => void;
  onLoadToActiveStudio?: (file: File) => void;
  onShowToast?: (msg: string) => void;
}

export const HistoryTab: React.FC<HistoryTabProps> = ({
  lang,
  onPreview,
  onLoadToActiveStudio,
  onShowToast,
}) => {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [sortBy, setSortBy] = useState('newest');

  const loadItems = async () => {
    setIsLoading(true);
    try {
      const data = await getAllHistory();
      setItems(data);
    } catch (e) {
      console.error('Failed to load history:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadItems();
  }, []);

  const handleDelete = async (id: string) => {
    await deleteHistoryItem(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
    if (onShowToast) {
      onShowToast(lang === 'ja' ? '履歴アイテムを削除しました' : 'History item removed');
    }
  };

  const handleClearAll = async () => {
    if (items.length === 0) return;
    const confirmMsg =
      lang === 'ja'
        ? 'すべての処理履歴を消去しますか？（保存されているデータも削除されます）'
        : 'Clear all processed file history? (Stored data will be deleted)';
    if (window.confirm(confirmMsg)) {
      await clearAllHistory();
      setItems([]);
      if (onShowToast) {
        onShowToast(lang === 'ja' ? '履歴をすべて消去しました' : 'All history cleared');
      }
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
    try {
      const zipFiles = items.map((i) => ({
        name: i.fileName,
        content: new Blob([i.data]),
      }));

      const zipBlob = await createZipArchive(zipFiles);
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `MediaConverter_History_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      if (onShowToast) {
        onShowToast(lang === 'ja' ? '一括ZIPアーカイブをダウンロードしました' : 'Downloaded all files as ZIP archive');
      }
    } catch (e) {
      console.error('ZIP creation error:', e);
      alert(lang === 'ja' ? 'ZIP作成中にエラーが発生しました' : 'Failed to create ZIP package');
    }
  };

  const handlePreviewItem = (item: HistoryItem) => {
    const mimeMap: Record<string, string> = {
      pdf: 'application/pdf',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      txt: 'text/plain',
      md: 'text/markdown',
      csv: 'text/csv',
      tsv: 'text/tab-separated-values',
      html: 'text/html',
      json: 'application/json',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      mp4: 'video/mp4',
      webm: 'video/webm',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
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
    if (onShowToast) {
      onShowToast(
        lang === 'ja'
          ? `「${item.fileName}」をアクティブスタジオに読み込みました`
          : `Loaded "${item.fileName}" into active studio`
      );
    }
  };

  const exportHistoryCsv = () => {
    if (items.length === 0) return;
    const headers = ['ID', 'Date', 'Original Name', 'Output File', 'Size (Bytes)', 'Format', 'Options'];
    const rows = items.map((r) => {
      const d = r.timestamp ? new Date(r.timestamp).toISOString() : '';
      return [
        r.id,
        d,
        `"${(r.originalName || '').replace(/"/g, '""')}"`,
        `"${(r.fileName || '').replace(/"/g, '""')}"`,
        r.data.byteLength,
        r.format,
        `"${JSON.stringify(r.metadata || {}).replace(/"/g, '""')}"`,
      ];
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `converter_history_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFilteredItems = () => {
    return items
      .filter((item) => {
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchName = item.fileName.toLowerCase().includes(q);
          const matchOrig = (item.originalName || '').toLowerCase().includes(q);
          const matchFmt = item.format.toLowerCase().includes(q);
          if (!matchName && !matchOrig && !matchFmt) return false;
        }

        if (filterType !== 'all') {
          const fmt = item.format.toLowerCase();
          if (filterType === 'pdf' && fmt !== 'pdf') return false;
          if (filterType === 'image' && !['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif', 'bmp'].includes(fmt)) return false;
          if (filterType === 'media' && !['mp4', 'webm', 'mov', 'mp3', 'wav', 'm4a', 'aac', 'ogg'].includes(fmt)) return false;
          if (filterType === 'office' && !['docx', 'xlsx', 'csv', 'tsv'].includes(fmt)) return false;
          if (filterType === 'text' && !['txt', 'md', 'html', 'json', 'xml'].includes(fmt)) return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'newest') return (b.timestamp || 0) - (a.timestamp || 0);
        if (sortBy === 'oldest') return (a.timestamp || 0) - (b.timestamp || 0);
        if (sortBy === 'name') return a.fileName.localeCompare(b.fileName);
        if (sortBy === 'size') return b.data.byteLength - a.data.byteLength;
        return 0;
      });
  };

  const filteredItems = getFilteredItems();
  const totalBytes = items.reduce((acc, curr) => acc + curr.data.byteLength, 0);

  return (
    <div className="w-full flex flex-col gap-4">
      <div className="card">
        {/* Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base sm:text-lg text-slate-800 dark:text-slate-100 flex items-center gap-2">
                {lang === 'ja' ? 'ローカル処理履歴' : 'Local Conversion History'}
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                  {items.length} {lang === 'ja' ? '件' : 'items'} ({formatFileSize(totalBytes)})
                </span>
              </h3>
              <p className="text-xs text-slate-500">
                {lang === 'ja'
                  ? 'ブラウザ内のIndexedDBに保存された処理完了ファイルです。外部サーバーへ送信されることはありません。'
                  : 'Files processed and saved inside your browser storage (IndexedDB). Zero server storage.'}
              </p>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center flex-wrap gap-2">
            <button
              onClick={loadItems}
              className="btn-header"
              title={lang === 'ja' ? '最新の状態に更新' : 'Refresh'}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>{lang === 'ja' ? '更新' : 'Refresh'}</span>
            </button>

            <button
              onClick={exportHistoryCsv}
              disabled={items.length === 0}
              className="btn-header disabled:opacity-40"
              title={lang === 'ja' ? '履歴メタデータをCSV出力' : 'Export History as CSV'}
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              <span>{lang === 'ja' ? 'CSV出力' : 'CSV'}</span>
            </button>

            <button
              onClick={handleDownloadAllZip}
              disabled={items.length === 0}
              className="btn-header disabled:opacity-40"
              title={lang === 'ja' ? 'すべての履歴成果物をZIP一括保存' : 'Download All as ZIP'}
            >
              <Archive className="w-3.5 h-3.5 text-indigo-600" />
              <span>{lang === 'ja' ? '一括ZIP' : 'Batch ZIP'}</span>
            </button>

            <button
              onClick={handleClearAll}
              disabled={items.length === 0}
              className="btn-header text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 border-rose-200 dark:border-rose-900/50 disabled:opacity-40"
              title={lang === 'ja' ? 'すべての履歴を消去' : 'Clear All History'}
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-600" />
              <span>{lang === 'ja' ? '全消去' : 'Clear All'}</span>
            </button>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-wrap items-center gap-3 pt-3">
          {/* Search Box */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={lang === 'ja' ? 'ファイル名・拡張子で検索...' : 'Search by file name or extension...'}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Type Filter */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-500">{lang === 'ja' ? '種類:' : 'Type:'}</span>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="select-sm"
            >
              <option value="all">{lang === 'ja' ? 'すべて' : 'All Types'}</option>
              <option value="pdf">PDF</option>
              <option value="image">{lang === 'ja' ? '画像 (PNG/JPG/WebP)' : 'Images'}</option>
              <option value="media">{lang === 'ja' ? '動画・音声 (MP4/MP3)' : 'Media'}</option>
              <option value="office">Office / CSV</option>
              <option value="text">{lang === 'ja' ? 'テキスト / HTML' : 'Text / HTML'}</option>
            </select>
          </div>

          {/* Sort Filter */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-500">{lang === 'ja' ? '並び順:' : 'Sort:'}</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="select-sm"
            >
              <option value="newest">{lang === 'ja' ? '新しい順' : 'Newest'}</option>
              <option value="oldest">{lang === 'ja' ? '古い順' : 'Oldest'}</option>
              <option value="name">{lang === 'ja' ? '名前順' : 'Name'}</option>
              <option value="size">{lang === 'ja' ? 'サイズ順' : 'File Size'}</option>
            </select>
          </div>
        </div>
      </div>

      {/* Item List Card */}
      <div className="card">
        {isLoading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-500 text-sm">
            <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
            <span>{lang === 'ja' ? '履歴を読み込み中...' : 'Loading history...'}</span>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center gap-3 text-center">
            <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
              <History className="w-6 h-6" />
            </div>
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              {searchQuery || filterType !== 'all'
                ? lang === 'ja'
                  ? '該当する処理履歴が見つかりませんでした'
                  : 'No matching history found'
                : lang === 'ja'
                ? '処理履歴はまだありません'
                : 'No conversion history yet'}
            </div>
            <p className="text-xs text-slate-500 max-w-sm">
              {lang === 'ja'
                ? 'ファイルの一括変換やPDF編集を行うと、ここに成果物が自動保存されます。'
                : 'Files converted or processed across tabs will automatically appear here.'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filteredItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
              >
                {/* File info */}
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-xs uppercase shrink-0 border border-blue-100 dark:border-blue-900/50">
                    {item.format.slice(0, 4)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm text-slate-800 dark:text-slate-100 truncate" title={item.fileName}>
                      {item.fileName}
                    </div>
                    <div className="flex items-center flex-wrap gap-2 text-xs text-slate-400 mt-0.5">
                      <span>{formatFileSize(item.data.byteLength)}</span>
                      <span>•</span>
                      <span>{item.timestamp ? new Date(item.timestamp).toLocaleString(lang === 'ja' ? 'ja-JP' : 'en-US') : ''}</span>
                      {item.originalName && item.originalName !== item.fileName && (
                        <>
                          <span>•</span>
                          <span className="truncate max-w-[150px] text-slate-500" title={`元のファイル: ${item.originalName}`}>
                            {lang === 'ja' ? '元: ' : 'From: '}
                            {item.originalName}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => handlePreviewItem(item)}
                    className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    title={lang === 'ja' ? 'プレビュー表示' : 'Preview'}
                  >
                    <Eye className="w-4 h-4" />
                  </button>

                  {onLoadToActiveStudio && (
                    <button
                      onClick={() => handleSendToActive(item)}
                      className="p-1.5 rounded-lg text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors"
                      title={lang === 'ja' ? 'スタジオに追加して再編集・再変換' : 'Load into Studio'}
                    >
                      <ArrowUpRight className="w-4 h-4" />
                    </button>
                  )}

                  <button
                    onClick={() => handleDownloadItem(item)}
                    className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors"
                    title={lang === 'ja' ? 'ファイルをダウンロード' : 'Download File'}
                  >
                    <Download className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => handleDelete(item.id)}
                    className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                    title={lang === 'ja' ? '履歴から削除' : 'Delete from history'}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
