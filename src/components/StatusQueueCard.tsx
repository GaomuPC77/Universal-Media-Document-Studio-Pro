import React, { useState, useEffect } from 'react';
import {
  FileText,
  Download,
  Trash2,
  Eye,
  CheckCircle2,
  HardDrive,
  FolderArchive,
  Bell,
  Check,
  RefreshCw,
} from 'lucide-react';
import { FileItem } from '../types';
import { createZipArchive } from '../utils/zipUtils';
import { deletePendingFile, clearAllPendingFiles, clearEntireAppCache } from '../utils/historyDb';
import {
  isNotificationSupported,
  getNotificationPermission,
  requestNotificationPermission,
} from '../utils/notification';

interface StatusQueueCardProps {
  lang: 'ja' | 'en';
  fileList: FileItem[];
  setFileList: React.Dispatch<React.SetStateAction<FileItem[]>>;
  onPreview: (item: FileItem) => void;
  onSaveToDrive: (item: FileItem) => void;
  onOpenDrivePicker: () => void;
  onShowToast: (msg: string) => void;
  onClearCache?: () => void;
  overallProgress?: number;
  overallStatusText?: string;
}

export const StatusQueueCard: React.FC<StatusQueueCardProps> = ({
  lang,
  fileList,
  setFileList,
  onPreview,
  onSaveToDrive,
  onOpenDrivePicker,
  onShowToast,
  onClearCache,
  overallProgress = 0,
  overallStatusText,
}) => {
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [isSavingAllToDrive, setIsSavingAllToDrive] = useState(false);
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);

  useEffect(() => {
    setNotifPermission(getNotificationPermission());
  }, []);

  const handleToggleNotification = async () => {
    const granted = await requestNotificationPermission();
    setNotifPermission(getNotificationPermission());
    if (granted) {
      onShowToast(lang === 'ja' ? '完了通知を有効化しました' : 'Completion notifications enabled');
    }
  };

  const handleDownloadItem = (item: FileItem) => {
    const blob = item.resultBlob || item.file;
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = item.resultName || item.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const handleDownloadAllZip = async () => {
    const doneItems = fileList.filter((i) => i.status === 'done' && i.resultBlob);
    if (doneItems.length === 0) return;

    setIsDownloadingZip(true);
    onShowToast(lang === 'ja' ? 'ZIPアーカイブを作成中...' : 'Creating ZIP archive...');
    try {
      const entries = doneItems.map((item) => ({
        name: item.resultName || item.name,
        content: item.resultBlob!,
      }));
      const zipBlob = await createZipArchive(entries);
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Converted_Files_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onShowToast(lang === 'ja' ? '一括ZIPアーカイブをダウンロードしました' : 'Downloaded all files as ZIP package');
    } catch (e: any) {
      console.error('ZIP creation error:', e);
      alert(lang === 'ja' ? 'ZIP作成中にエラーが発生しました' : 'Failed to create ZIP package');
    } finally {
      setIsDownloadingZip(false);
    }
  };

  const handleSaveAllToDrive = async () => {
    const doneItems = fileList.filter((i) => i.status === 'done' && i.resultBlob);
    if (doneItems.length === 0) return;

    setIsSavingAllToDrive(true);
    for (const item of doneItems) {
      await onSaveToDrive(item);
    }
    setIsSavingAllToDrive(false);
  };

  const handleDeleteItem = async (id: string) => {
    setFileList((prev) => prev.filter((i) => i.id !== id));
    await deletePendingFile(id);
  };

  const handleClearList = async () => {
    setFileList([]);
    await clearAllPendingFiles();
    onShowToast(lang === 'ja' ? 'リストを一括クリアしました' : 'Cleared file list');
  };

  const doneCount = fileList.filter((i) => i.status === 'done').length;
  const statusDisplay = overallStatusText || (doneCount === fileList.length && fileList.length > 0
    ? (lang === 'ja' ? 'すべての処理が完了しました' : 'All tasks completed')
    : (lang === 'ja' ? '待機中' : 'Idle'));

  const progressDisplay = overallProgress > 0 ? overallProgress : (fileList.length > 0 ? Math.round((doneCount / fileList.length) * 100) : 0);

  return (
    <div className="card" id="statusQueueSection">
      {/* Header */}
      <div className="section-title">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-blue-600" />
          <span>{lang === 'ja' ? '変換・処理ステータス' : 'Conversion & Processing Status'}</span>
        </div>
        <span id="counterLabel" style={{ fontSize: '0.85rem', color: 'var(--text-sub)' }}>
          {doneCount} / {fileList.length}
        </span>
      </div>

      {/* Detailed Progress Bar Section */}
      <div className="progress-section">
        <div className="progress-header">
          <span id="progressStatusText">{statusDisplay}</span>
          <span id="progressPercentText">{progressDisplay}%</span>
        </div>
        <div className="progress-bar-bg">
          <div
            className="progress-bar-fill"
            id="progressBar"
            style={{ width: `${progressDisplay}%` }}
          ></div>
        </div>
      </div>

      {/* Background Status Bar */}
      <div
        className="bg-status-bar"
        id="bgStatusBar"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px',
          marginTop: '12px',
          padding: '10px 14px',
          background: 'var(--item-bg)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          fontSize: '0.8rem',
          color: 'var(--text-sub)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              display: 'inline-block',
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: '#10b981',
            }}
          ></span>
          <span>{lang === 'ja' ? 'タブを閉じても処理待ち状態を自動保存・復元' : 'Queue auto-saved across browser sessions'}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem' }}>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            <span>{lang === 'ja' ? '画面オフ防止・バックグラウンド維持' : 'Screen Keep-Alive Ready'}</span>
          </span>

          {notifPermission !== 'unsupported' && (
            <button
              id="btnToggleNotification"
              onClick={handleToggleNotification}
              disabled={notifPermission === 'granted'}
              className="btn-sm"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 10px',
                fontSize: '0.75rem',
                cursor: notifPermission === 'granted' ? 'default' : 'pointer',
                opacity: notifPermission === 'granted' ? 0.75 : 1,
                backgroundColor: notifPermission === 'granted' ? 'var(--card-bg)' : 'var(--accent-color)',
                color: notifPermission === 'granted' ? 'var(--text-color)' : '#ffffff',
                borderColor: notifPermission === 'granted' ? 'var(--border-color)' : 'var(--accent-color)',
              }}
            >
              {notifPermission === 'granted' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  <span>{lang === 'ja' ? '通知: 許可済み' : 'Notifications: Enabled'}</span>
                </>
              ) : (
                <>
                  <Bell className="w-3.5 h-3.5" />
                  <span id="btnToggleNotifText">{lang === 'ja' ? '完了通知を有効化' : 'Enable Notifications'}</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* File Queue Items */}
      <div className="file-list" id="fileList">
        {fileList.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 10px', color: 'var(--text-sub)', fontSize: '0.85rem' }}>
            {lang === 'ja'
              ? 'ファイルがまだ追加されていません。上の「1. 処理するファイルの読み込み・追加」から追加してください。'
              : 'No files loaded yet. Add files via Section 1 above.'}
          </div>
        ) : (
          fileList.map((item) => (
            <div key={item.id} className="file-item">
              <div className="file-header">
                <div className="file-info">
                  <div className="file-name" title={item.resultName || item.name}>
                    {item.resultName || item.name}
                  </div>
                  <div className="file-meta">
                    形式: .{item.format} {item.targetFormat && item.targetFormat !== item.format ? `→ .${item.targetFormat}` : ''} |{' '}
                    <span
                      className="file-status"
                      style={{
                        fontWeight: item.status === 'done' ? 700 : 500,
                        color:
                          item.status === 'done'
                            ? 'var(--success-color)'
                            : item.status === 'error'
                            ? 'var(--danger-color)'
                            : 'var(--text-sub)',
                      }}
                    >
                      {item.status === 'done'
                        ? lang === 'ja'
                          ? '完了'
                          : 'Done'
                        : item.status === 'processing'
                        ? lang === 'ja'
                          ? '処理中'
                          : 'Processing'
                        : item.status === 'error'
                        ? lang === 'ja'
                          ? 'エラー'
                          : 'Error'
                        : lang === 'ja'
                        ? '待機中'
                        : 'Pending'}
                    </span>
                  </div>
                </div>

                <div className="file-actions">
                  <button
                    onClick={() => onPreview(item)}
                    className="btn-sm btn-preview"
                    title={lang === 'ja' ? 'プレビュー表示' : 'Preview'}
                  >
                    <Eye className="w-3.5 h-3.5 inline mr-1" />
                    <span>{lang === 'ja' ? 'プレビュー' : 'Preview'}</span>
                  </button>

                  <button
                    onClick={() => handleDownloadItem(item)}
                    disabled={item.status !== 'done' && !item.resultBlob && !item.file}
                    className="btn-sm btn-success btn-dl"
                    title={lang === 'ja' ? 'ローカルに保存' : 'Save File'}
                  >
                    <Download className="w-3.5 h-3.5 inline mr-1" />
                    <span>{lang === 'ja' ? '保存' : 'Save'}</span>
                  </button>

                  <button
                    onClick={() => onSaveToDrive(item)}
                    disabled={item.status !== 'done' && !item.resultBlob}
                    className="btn-sm btn-drive"
                    style={{
                      backgroundColor: '#0284c7',
                      color: '#ffffff',
                      border: 'none',
                      padding: '4px 8px',
                      fontWeight: 500,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      opacity: item.status !== 'done' && !item.resultBlob ? 0.4 : 1,
                    }}
                    title={lang === 'ja' ? 'Google Driveに保存' : 'Save to Google Drive'}
                  >
                    <HardDrive className="w-3.5 h-3.5" />
                    <span>Drive</span>
                  </button>

                  <button
                    onClick={() => handleDeleteItem(item.id)}
                    className="btn-sm btn-danger btn-remove"
                    title={lang === 'ja' ? 'リストから削除' : 'Remove'}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Batch Download / Cloud Sync Actions */}
      <div style={{ display: 'flex', gap: '10px', marginTop: '16px', flexWrap: 'wrap' }}>
        <button
          id="downloadAllBtn"
          onClick={handleDownloadAllZip}
          disabled={doneCount === 0 || isDownloadingZip}
          className="btn"
          style={{ flex: 1, minWidth: '200px', marginTop: 0 }}
        >
          {isDownloadingZip ? <RefreshCw className="w-4 h-4 animate-spin inline mr-1" /> : <FolderArchive className="w-4 h-4 inline mr-1" />}
          <span>{lang === 'ja' ? '変換済みファイルを一括ZIPダウンロード' : 'Download All Converted as ZIP'}</span>
        </button>

        <button
          id="saveAllToDriveBtn"
          onClick={handleSaveAllToDrive}
          disabled={doneCount === 0 || isSavingAllToDrive}
          className="btn btn-drive-action"
          style={{
            flex: 1,
            minWidth: '200px',
            marginTop: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
          }}
        >
          <HardDrive className="w-4 h-4" />
          <span id="saveAllToDriveBtnText">
            {isSavingAllToDrive
              ? lang === 'ja'
                ? 'Google Driveへ保存中...'
                : 'Saving to Drive...'
              : lang === 'ja'
              ? 'Google Driveへ一括保存'
              : 'Save All to Google Drive'}
          </span>
        </button>
      </div>

      {/* Footer Clear Links */}
      <div className="card-footer">
        <button id="clearListBtn" onClick={handleClearList} className="clear-link">
          {lang === 'ja' ? 'リストを一括クリア' : 'Clear List'}
        </button>
        <button
          id="clearCacheBtn"
          onClick={async () => {
            await clearEntireAppCache();
            setFileList([]);
            localStorage.removeItem('converter_form_settings');
            if (onClearCache) onClearCache();
            onShowToast(lang === 'ja' ? 'キャッシュと保存データを消去しました' : 'Cleared cache and stored data');
          }}
          className="clear-link"
        >
          {lang === 'ja' ? 'キャッシュを消去' : 'Clear Cache'}
        </button>
      </div>
    </div>
  );
};
