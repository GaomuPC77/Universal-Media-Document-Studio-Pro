import React, { useState, useEffect } from 'react';
import {
  X,
  HardDrive,
  Download,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertCircle,
  FileText,
  LogOut,
  ExternalLink,
  Film,
  Music,
  FileSpreadsheet,
  Image as ImageIcon,
} from 'lucide-react';
import {
  initGoogleIdentityServices,
  requestGoogleAccessToken,
  disconnectGoogleDrive,
  fetchDriveUserInfo,
  fetchDriveFiles,
  downloadDriveFile,
  DriveFileInfo,
  DriveUser,
  getStoredToken,
} from '../../utils/googleDrive';

interface DrivePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang: 'ja' | 'en';
  onFilesImported: (files: File[]) => void;
}

export const DrivePickerModal: React.FC<DrivePickerModalProps> = ({
  isOpen,
  onClose,
  lang,
  onFilesImported,
}) => {
  const [driveUser, setDriveUser] = useState<DriveUser | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [files, setFiles] = useState<DriveFileInfo[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [filterExt, setFilterExt] = useState('all');
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Initialize and check connection state
  useEffect(() => {
    if (!isOpen) return;

    const token = getStoredToken();
    if (token) {
      setIsConnected(true);
      fetchDriveUserInfo().then((user) => {
        if (user) {
          setDriveUser(user);
          loadFiles();
        } else {
          setIsConnected(false);
        }
      });
    }

    initGoogleIdentityServices(
      async (tok, user) => {
        setIsConnected(true);
        if (user) setDriveUser(user);
        setErrorMessage(null);
        await loadFiles();
      },
      (err) => {
        console.error('GIS Error in Modal:', err);
        setErrorMessage(
          lang === 'ja'
            ? 'Google認証に失敗しました。ポップアップのブロックを解除してください。'
            : 'Authentication failed. Please check popup blockers.'
        );
      }
    );
  }, [isOpen]);

  const loadFiles = async (query = '') => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const list = await fetchDriveFiles(query);
      setFiles(list);
    } catch (err: any) {
      console.error('Failed to load drive files:', err);
      if (err.message === 'AUTH_EXPIRED') {
        setIsConnected(false);
        setDriveUser(null);
      } else {
        setErrorMessage(err.message || 'Google Driveファイルの取得に失敗しました');
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const handleConnect = async () => {
    setErrorMessage(null);
    try {
      await requestGoogleAccessToken(
        async () => {
          setIsConnected(true);
          const user = await fetchDriveUserInfo();
          if (user) setDriveUser(user);
          await loadFiles();
        },
        (err) => {
          console.error('Google Auth error in Modal:', err);
          setErrorMessage(
            lang === 'ja'
              ? 'Google認証に失敗しました。ポップアップのブロックを解除してください。'
              : 'Authentication failed. Please check popup blockers.'
          );
        }
      );
    } catch (e: any) {
      if (e?.code !== 'auth/popup-closed-by-user') {
        setErrorMessage(e.message || (lang === 'ja' ? 'Google認証に失敗しました' : 'Authentication failed'));
      }
    }
  };

  const handleDisconnect = () => {
    disconnectGoogleDrive();
    setIsConnected(false);
    setDriveUser(null);
    setFiles([]);
    setSelectedIds(new Set());
  };

  const handleToggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const handleSelectAll = () => {
    const visible = getFilteredFiles();
    if (visible.every((f) => selectedIds.has(f.id))) {
      const next = new Set(selectedIds);
      visible.forEach((f) => next.delete(f.id));
      setSelectedIds(next);
    } else {
      const next = new Set(selectedIds);
      visible.forEach((f) => next.add(f.id));
      setSelectedIds(next);
    }
  };

  const handleImport = async () => {
    if (selectedIds.size === 0) return;
    setIsImporting(true);
    setErrorMessage(null);

    const targetFiles = files.filter((f) => selectedIds.has(f.id));
    const imported: File[] = [];

    for (const info of targetFiles) {
      try {
        const fileObj = await downloadDriveFile(info);
        imported.push(fileObj);
      } catch (e: any) {
        console.error(`Download failed for ${info.name}:`, e);
      }
    }

    setIsImporting(false);
    if (imported.length > 0) {
      onFilesImported(imported);
      onClose();
    } else {
      setErrorMessage(
        lang === 'ja'
          ? 'ファイルのダウンロードに失敗しました。権限をご確認ください。'
          : 'Failed to download selected files. Please check permissions.'
      );
    }
  };

  const isGoogleWorkspaceNative = (f: DriveFileInfo) => {
    if (!f.mimeType) return false;
    if (f.mimeType.startsWith('application/vnd.google-apps.') && f.mimeType !== 'application/vnd.google-apps.file') {
      return true;
    }
    const ext = f.name.includes('.') ? f.name.split('.').pop()?.toLowerCase() || '' : '';
    const knownExts = ['pdf','docx','doc','xlsx','xls','pptx','ppt','csv','tsv','txt','md','html','json','xml','png','jpg','jpeg','webp','svg','gif','bmp','ico','mp4','webm','mov','mp3','wav','m4a','aac','ogg','zip','rar','7z'];
    if (!ext || !knownExts.includes(ext)) {
      if (!ext && f.mimeType.includes('google')) return true;
    }
    return false;
  };

  const getGoogleNativeTypeName = (f: DriveFileInfo) => {
    const mime = (f.mimeType || '').toLowerCase();
    if (mime.includes('document')) return lang === 'ja' ? 'Google ドキュメント' : 'Google Docs';
    if (mime.includes('spreadsheet')) return lang === 'ja' ? 'Google スプレッドシート' : 'Google Sheets';
    if (mime.includes('presentation')) return lang === 'ja' ? 'Google スライド' : 'Google Slides';
    if (mime.includes('form')) return lang === 'ja' ? 'Google フォーム' : 'Google Forms';
    if (mime.includes('drawing')) return lang === 'ja' ? 'Google 図形描画' : 'Google Drawings';
    return lang === 'ja' ? 'Google専用形式 (拡張子なし)' : 'Google Cloud Native';
  };

  const getFilteredFiles = () => {
    return files
      .filter((f) => !isGoogleWorkspaceNative(f))
      .filter((f) => {
        const ext = f.name.split('.').pop()?.toLowerCase() || '';
        if (filterExt !== 'all') {
          if (filterExt === 'pdf' && ext !== 'pdf') return false;
          if (filterExt === 'office' && !['docx', 'doc', 'xlsx', 'xls', 'pptx', 'csv'].includes(ext)) return false;
          if (filterExt === 'images' && !['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif'].includes(ext)) return false;
          if (filterExt === 'media' && !['mp4', 'webm', 'mov', 'mp3', 'wav', 'm4a', 'aac', 'ogg'].includes(ext)) return false;
        }
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          if (!f.name.toLowerCase().includes(q)) return false;
        }
        return true;
      });
  };

  const getUnsupportedWorkspaceFiles = () => {
    return files.filter((f) => isGoogleWorkspaceNative(f));
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileIcon = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    if (ext === 'pdf') return <FileText className="w-4 h-4 text-red-500" />;
    if (['docx', 'doc', 'txt', 'md'].includes(ext)) return <FileText className="w-4 h-4 text-blue-500" />;
    if (['xlsx', 'xls', 'csv'].includes(ext)) return <FileSpreadsheet className="w-4 h-4 text-emerald-500" />;
    if (['png', 'jpg', 'jpeg', 'webp', 'svg'].includes(ext)) return <ImageIcon className="w-4 h-4 text-purple-500" />;
    if (['mp4', 'webm', 'mov'].includes(ext)) return <Film className="w-4 h-4 text-sky-500" />;
    if (['mp3', 'wav', 'm4a', 'aac', 'ogg'].includes(ext)) return <Music className="w-4 h-4 text-amber-500" />;
    return <FileText className="w-4 h-4 text-slate-500" />;
  };

  const filteredFiles = getFilteredFiles();
  const unsupportedFiles = getUnsupportedWorkspaceFiles();

  return (
    <div className="modal-overlay" style={{ display: 'flex' }}>
      <div className="modal-box" style={{ maxWidth: '680px', width: '100%', maxHeight: '88vh' }}>
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"></path>
            </svg>
            <span>{lang === 'ja' ? 'Google Drive クラウド連携' : 'Google Drive Cloud Storage'}</span>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="閉じる">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {!isConnected ? (
            <div className="flex flex-col items-center text-center p-8 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700 gap-4">
              <div className="w-14 h-14 rounded-2xl bg-blue-500/10 flex items-center justify-center text-blue-600 dark:text-sky-400 shadow-xs">
                <HardDrive className="w-7 h-7" />
              </div>
              <div>
                <h4 className="font-bold text-slate-900 dark:text-slate-100 text-base">
                  {lang === 'ja' ? 'Google アカウントと連携する' : 'Sign in to Google Drive'}
                </h4>
                <p className="text-xs text-slate-500 mt-1 max-w-sm">
                  {lang === 'ja'
                    ? 'Google純正のOAuth認証で安全に連携し、マイドライブからPDF・ドキュメント・メディアを直接読み込み、編集結果を自動保存できます。'
                    : 'Securely connect to your Google Drive to browse, import, and save documents directly.'}
                </p>
              </div>

              {errorMessage && (
                <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              <button
                onClick={handleConnect}
                className="py-2.5 px-6 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-xs transition shadow-xs cursor-pointer inline-flex items-center gap-2"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
                  <polyline points="10 17 15 12 10 7"></polyline>
                  <line x1="15" y1="12" x2="3" y2="12"></line>
                </svg>
                <span>{lang === 'ja' ? 'Google Driveアカウントでサインイン' : 'Sign in with Google'}</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 flex-1 overflow-hidden">
              {/* Account Status Card */}
              <div className="flex items-center justify-between p-2.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg text-xs text-emerald-800 dark:text-emerald-300">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <span>
                    Google Drive 連携中: <strong>{driveUser?.displayName || driveUser?.emailAddress || 'Google User'}</strong>
                  </span>
                </div>
                <button
                  onClick={handleDisconnect}
                  className="text-xs text-slate-500 hover:text-red-500 underline cursor-pointer inline-flex items-center gap-1"
                >
                  <LogOut className="w-3 h-3" />
                  <span>{lang === 'ja' ? '解除' : 'Disconnect'}</span>
                </button>
              </div>

              {/* Search & Filter Bar */}
              <div className="flex gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[160px]">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') loadFiles(searchQuery);
                    }}
                    placeholder={lang === 'ja' ? 'Drive内のファイルを検索...' : 'Search Google Drive...'}
                    className="input-text"
                    style={{ paddingLeft: '28px', marginBottom: 0, padding: '7px 10px 7px 28px', fontSize: '0.85rem' }}
                  />
                </div>

                <select
                  value={filterExt}
                  onChange={(e) => setFilterExt(e.target.value)}
                  className="select-sm"
                  style={{ padding: '7px 10px', fontSize: '0.85rem' }}
                >
                  <option value="all">{lang === 'ja' ? 'すべての形式' : 'All Formats'}</option>
                  <option value="pdf">PDF (.pdf)</option>
                  <option value="office">{lang === 'ja' ? 'Office文書 (Word/Excel)' : 'Office Docs'}</option>
                  <option value="images">{lang === 'ja' ? '画像 (PNG/JPG/WebP)' : 'Images'}</option>
                  <option value="media">{lang === 'ja' ? '動画・音声 (MP4/MP3)' : 'Video/Audio'}</option>
                </select>

                <button
                  onClick={() => loadFiles(searchQuery)}
                  className="btn-sm"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '0 12px', cursor: 'pointer' }}
                  title="更新"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                  <span>{lang === 'ja' ? '更新' : 'Refresh'}</span>
                </button>
              </div>

              {/* File List Area */}
              <div
                id="driveFileListContainer"
                style={{
                  flex: 1,
                  maxHeight: '340px',
                  overflowY: 'auto',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  background: 'var(--item-bg)',
                  padding: '6px',
                }}
              >
                {isLoading ? (
                  <div style={{ padding: '36px 10px', textAlign: 'center', color: 'var(--text-sub)' }}>
                    <div className="spinner" style={{ borderColor: 'rgba(2, 132, 199, 0.3)', borderTopColor: '#0284c7', width: '28px', height: '28px', margin: '0 auto 10px auto' }}></div>
                    <div>{lang === 'ja' ? 'Google Driveからファイルを一覧取得中...' : 'Fetching files from Google Drive...'}</div>
                  </div>
                ) : filteredFiles.length === 0 ? (
                  <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-sub)', fontSize: '0.85rem' }}>
                    <HardDrive className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                    <div>{lang === 'ja' ? '対応するファイルが見つかりませんでした' : 'No matching files found in Drive'}</div>
                  </div>
                ) : (
                  filteredFiles.map((file) => {
                    const isSelected = selectedIds.has(file.id);
                    return (
                      <div
                        key={file.id}
                        className={`drive-file-item ${isSelected ? 'selected' : ''}`}
                        onClick={() => handleToggleSelect(file.id)}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          style={{ cursor: 'pointer' }}
                        />
                        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                          {getFileIcon(file.name)}
                        </span>
                        <div className="drive-file-info">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span className="drive-file-name" title={file.name}>{file.name}</span>
                            <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '1px 5px', borderRadius: '4px', textTransform: 'uppercase', background: 'rgba(2, 132, 199, 0.12)', color: '#0284c7' }}>
                              {file.name.split('.').pop() || 'file'}
                            </span>
                          </div>
                          <div className="drive-file-details">
                            <span>{formatFileSize(file.size)}</span>
                            <span>•</span>
                            <span>{file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString() : ''}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}

                {/* Unsupported Google Workspace native documents section placed at bottom */}
                {unsupportedFiles.length > 0 && (
                  <div style={{ marginTop: '14px', borderTop: '1px dashed var(--border-color)', paddingTop: '10px' }}>
                    <div style={{ fontSize: '0.78rem', color: '#b45309', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '4px' }}>
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{lang === 'ja' ? '直接変換非対応のGoogle専用形式ファイル（ドキュメント・スプレッドシート等）' : 'Unsupported Google-Native Files (Docs, Sheets, Slides)'}</span>
                    </div>
                    <p style={{ fontSize: '0.72rem', color: 'var(--text-sub)', marginBottom: '8px', lineHeight: 1.4 }}>
                      {lang === 'ja'
                        ? '※ Googleドキュメント / スプレッドシート / スライド等のGoogle専用形式は直接変換に対応していません。Googleドライブ上で「ファイル」→「ダウンロード」からPDFやDOCX等に保存してご利用ください。'
                        : 'Note: Native Google Docs, Sheets, and Slides cannot be directly converted. Please export them as PDF or DOCX from Google Drive first.'}
                    </p>
                    <div style={{ opacity: 0.65, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {unsupportedFiles.map((u) => (
                        <div
                          key={u.id}
                          className="drive-file-item"
                          style={{ cursor: 'not-allowed', background: 'rgba(0,0,0,0.03)' }}
                        >
                          <input type="checkbox" disabled checked={false} />
                          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                            <FileText className="w-4 h-4 text-slate-400" />
                          </span>
                          <div className="drive-file-info">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span className="drive-file-name" style={{ color: 'var(--text-sub)' }}>{u.name}</span>
                              <span style={{ fontSize: '0.65rem', fontWeight: 600, padding: '1px 6px', borderRadius: '4px', background: '#fef08a', color: '#854d0e', whiteSpace: 'nowrap' }}>
                                {getGoogleNativeTypeName(u)} - {lang === 'ja' ? '直接変換非対応' : 'Cannot Convert'}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {isConnected && (
          <div className="modal-footer" style={{ justifyContent: 'space-between', marginTop: '10px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={filteredFiles.length > 0 && filteredFiles.every((f) => selectedIds.has(f.id))}
                onChange={handleSelectAll}
              />
              <span>{lang === 'ja' ? 'すべて選択' : 'Select All'}</span>
            </label>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn-sm" onClick={onClose}>
                {lang === 'ja' ? 'キャンセル' : 'Cancel'}
              </button>
              <button
                disabled={selectedIds.size === 0 || isImporting}
                onClick={handleImport}
                className="btn-sm btn-drive-action"
                style={{ padding: '8px 16px', fontWeight: 600 }}
              >
                {isImporting ? (
                  <span className="inline-flex items-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>{lang === 'ja' ? 'ダウンロード中...' : 'Importing...'}</span>
                  </span>
                ) : (
                  <span>
                    {lang === 'ja' ? `選択したファイルを読み込む (${selectedIds.size})` : `Import Selected (${selectedIds.size})`}
                  </span>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
