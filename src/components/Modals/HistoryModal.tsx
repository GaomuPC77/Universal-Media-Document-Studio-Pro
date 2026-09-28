import React, { useState, useEffect } from 'react';
import {
  X,
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
} from 'lucide-react';
import { HistoryItem, getAllHistory, deleteHistoryItem, clearAllHistory } from '../../utils/historyDb';
import { createZipArchive } from '../../utils/zipUtils';

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang: 'ja' | 'en';
  onPreview: (name: string, blob: Blob, format: string) => void;
  onLoadToActiveStudio?: (file: File) => void;
}

export const HistoryModal: React.FC<HistoryModalProps> = ({
  isOpen,
  onClose,
  lang,
  onPreview,
  onLoadToActiveStudio,
}) => {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [sortBy, setSortBy] = useState('newest');

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
    const confirmMsg = lang === 'ja' ? 'すべての処理履歴を消去しますか？（保存されているデータも削除されます）' : 'Clear all processed file history?';
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
    a.download = `docstudio_history_${new Date().toISOString().slice(0, 10)}.csv`;
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
        if (filterType !== 'all' && item.format.toLowerCase() !== filterType) {
          return false;
        }
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          if (!item.fileName.toLowerCase().includes(q) && !item.originalName.toLowerCase().includes(q)) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'oldest') return a.timestamp - b.timestamp;
        if (sortBy === 'size') return b.data.byteLength - a.data.byteLength;
        return b.timestamp - a.timestamp;
      });
  };

  const filteredItems = getFilteredItems();

  return (
    <div className="modal-overlay" style={{ display: 'flex' }}>
      <div className="modal-box" style={{ maxWidth: '680px', width: '100%', maxHeight: '88vh' }}>
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <History className="w-5 h-5 text-blue-600 dark:text-sky-400" />
            <span>{lang === 'ja' ? '処理履歴 (ローカルストレージ)' : 'Processing History (Local Storage)'}</span>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="閉じる">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {/* Search & Filter & Action Bar */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '8px', marginBottom: '10px' }}>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={lang === 'ja' ? 'ファイル名で検索...' : 'Search history...'}
              className="input-text"
              style={{ paddingLeft: '28px', marginBottom: 0, padding: '7px 10px 7px 28px', fontSize: '0.82rem' }}
            />
          </div>

          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="select-field"
            style={{ padding: '6px 8px', fontSize: '0.82rem' }}
          >
            <option value="all">{lang === 'ja' ? 'すべての形式' : 'All Formats'}</option>
            <option value="pdf">PDF (.pdf)</option>
            <option value="docx">Word (.docx)</option>
            <option value="xlsx">Excel (.xlsx)</option>
            <option value="png">PNG (.png)</option>
            <option value="jpg">JPG (.jpg)</option>
            <option value="txt">TXT (.txt)</option>
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="select-field"
            style={{ padding: '6px 8px', fontSize: '0.82rem' }}
          >
            <option value="newest">{lang === 'ja' ? '新しい順' : 'Newest'}</option>
            <option value="oldest">{lang === 'ja' ? '古い順' : 'Oldest'}</option>
            <option value="size">{lang === 'ja' ? 'サイズ順' : 'Size'}</option>
          </select>

          <button
            onClick={exportHistoryCsv}
            disabled={items.length === 0}
            className="btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '0 10px', cursor: 'pointer' }}
            title="CSV出力"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>CSV</span>
          </button>
        </div>

        {/* Body */}
        <div className="modal-body" style={{ flex: 1, overflowY: 'auto' }}>
          {isLoading ? (
            <div style={{ padding: '36px 10px', textAlign: 'center', color: 'var(--text-sub)' }}>
              <RefreshCw className="w-6 h-6 animate-spin text-blue-500 mx-auto mb-2" />
              <div style={{ fontSize: '0.82rem' }}>{lang === 'ja' ? '履歴を読み込み中...' : 'Loading history...'}</div>
            </div>
          ) : filteredItems.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '36px 20px', color: 'var(--text-sub)', border: '2px dashed var(--border-color)', borderRadius: '8px' }}>
              <FolderOpen className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
              <p style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '4px' }}>
                {lang === 'ja' ? '処理履歴がありません' : 'No processed files in history yet'}
              </p>
              <p style={{ fontSize: '0.75rem' }}>
                {lang === 'ja'
                  ? 'PDF変換や編集を実行すると、成果物がブラウザ内IndexedDBに自動保存され、いつでも再ダウンロード・プレビューできます。'
                  : 'Converted documents are saved locally in browser memory for instant reuse.'}
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filteredItems.map((item) => (
                <div
                  key={item.id}
                  className="history-card"
                  style={{ padding: '10px 12px' }}
                >
                  <div className="history-card-header">
                    <div className="history-card-title">
                      <span className="history-badge history-badge-convert">.{item.format}</span>
                      <span>{item.fileName}</span>
                    </div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-sub)', whiteSpace: 'nowrap' }}>
                      {new Date(item.timestamp).toLocaleString(lang === 'ja' ? 'ja-JP' : 'en-US')}
                    </span>
                  </div>

                  <div className="history-details-grid">
                    <div className="history-detail-item">
                      <span className="history-detail-label">{lang === 'ja' ? '元ファイル' : 'Original'}</span>
                      <span className="history-detail-value">{item.originalName}</span>
                    </div>
                    <div className="history-detail-item">
                      <span className="history-detail-label">{lang === 'ja' ? 'ファイルサイズ' : 'File Size'}</span>
                      <span className="history-detail-value">{formatFileSize(item.data.byteLength)}</span>
                    </div>
                    <div className="history-detail-item">
                      <span className="history-detail-label">{lang === 'ja' ? '形式' : 'Format'}</span>
                      <span className="history-detail-value">.{item.format.toLowerCase()}</span>
                    </div>
                  </div>

                  <div className="history-actions" style={{ marginTop: '4px' }}>
                    <button
                      onClick={() => handlePreviewItem(item)}
                      className="btn-sm"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    >
                      <Eye className="w-3 h-3" />
                      <span>{lang === 'ja' ? '確認' : 'View'}</span>
                    </button>

                    <button
                      onClick={() => handleDownloadItem(item)}
                      className="btn-sm btn-success"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    >
                      <Download className="w-3 h-3" />
                      <span>{lang === 'ja' ? '再保存' : 'Save'}</span>
                    </button>

                    {onLoadToActiveStudio && (
                      <button
                        onClick={() => handleSendToActive(item)}
                        className="btn-sm"
                        style={{ background: 'var(--accent-color)', color: '#fff', border: 'none' }}
                      >
                        {lang === 'ja' ? '再編集' : 'Edit'}
                      </button>
                    )}

                    <button
                      onClick={() => handleDelete(item.id)}
                      className="btn-sm btn-danger"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {items.length > 0 && (
              <>
                <button
                  onClick={handleDownloadAllZip}
                  className="btn-sm btn-success"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '6px 12px' }}
                >
                  <Archive className="w-3.5 h-3.5" />
                  <span>{lang === 'ja' ? '全履歴を一括ZIP保存' : 'Download All as ZIP'}</span>
                </button>
                <button
                  onClick={handleClearAll}
                  className="clear-link"
                >
                  {lang === 'ja' ? '履歴を全消去' : 'Clear All'}
                </button>
              </>
            )}
          </div>

          <button className="btn-sm" onClick={onClose}>
            {lang === 'ja' ? '閉じる' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
};
