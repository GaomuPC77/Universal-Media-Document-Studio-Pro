import React, { useState, useRef } from 'react';
import {
  ArchiveRestore,
  Download,
  Upload,
  HardDrive,
  CheckCircle2,
  RefreshCw,
  Layers,
  History,
  Smartphone,
  Laptop,
  Check,
  FileCode,
  AlertCircle,
} from 'lucide-react';
import { FileItem } from '../types';
import { exportWorkspaceBackup, importWorkspaceBackup } from '../utils/backupUtils';
import { uploadFileToDrive, getStoredToken } from '../utils/googleDrive';

interface WorkspaceBackupCardProps {
  lang: 'ja' | 'en';
  fileList: FileItem[];
  activeTab: string;
  theme: 'auto' | 'light' | 'dark';
  onRestoreBackup: (data: {
    restoredFiles: FileItem[];
    activeTab: string;
    lang: 'ja' | 'en';
    theme: 'auto' | 'light' | 'dark';
    historyCount: number;
  }) => void;
  onShowToast: (msg: string) => void;
}

export const WorkspaceBackupCard: React.FC<WorkspaceBackupCardProps> = ({
  lang,
  fileList,
  activeTab,
  theme,
  onRestoreBackup,
  onShowToast,
}) => {
  const [includeHistory, setIncludeHistory] = useState<boolean>(true);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isSavingDrive, setIsSavingDrive] = useState<boolean>(false);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const importInputRef = useRef<HTMLInputElement>(null);

  const getBackupFileName = () => {
    const now = new Date();
    const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    return `UMC_Workspace_Backup_${ymd}.umc-backup.zip`;
  };

  const handleDownloadBackup = async () => {
    setIsExporting(true);
    setErrorMessage('');
    setStatusMessage('');
    try {
      const blob = await exportWorkspaceBackup(fileList, activeTab, lang, theme, includeHistory);
      const fileName = getBackupFileName();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);

      const msg = lang === 'ja'
        ? `バックアップ「${fileName}」を保存しました。別端末で復元して作業を再開できます。`
        : `Exported backup "${fileName}".`;
      setStatusMessage(msg);
      onShowToast(msg);
    } catch (err: any) {
      console.error(err);
      setErrorMessage(lang === 'ja' ? `エクスポート失敗: ${err?.message}` : `Export failed: ${err?.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleBackupToDrive = async () => {
    setIsSavingDrive(true);
    setErrorMessage('');
    setStatusMessage('');
    try {
      const blob = await exportWorkspaceBackup(fileList, activeTab, lang, theme, includeHistory);
      const fileName = getBackupFileName();
      await uploadFileToDrive(fileName, 'application/zip', blob);
      const msg = lang === 'ja'
        ? `Google Driveにバックアップ「${fileName}」を保存しました`
        : `Saved backup "${fileName}" to Google Drive`;
      setStatusMessage(msg);
      onShowToast(msg);
    } catch (err: any) {
      console.error(err);
      setErrorMessage(
        lang === 'ja'
          ? `Google Driveへの保存に失敗しました: ${err?.message || '連携状態を確認してください'}`
          : `Failed to upload to Google Drive: ${err?.message}`
      );
    } finally {
      setIsSavingDrive(false);
    }
  };

  const processImportFile = async (file: File) => {
    setIsImporting(true);
    setErrorMessage('');
    setStatusMessage('');
    try {
      const result = await importWorkspaceBackup(file);
      onRestoreBackup(result);
      const msg = lang === 'ja'
        ? `バックアップを正常に復元しました！（ファイル: ${result.restoredFiles.length}件 / 履歴: ${result.historyCount}件）`
        : `Successfully restored ${result.restoredFiles.length} files and ${result.historyCount} history items!`;
      setStatusMessage(msg);
      onShowToast(msg);
    } catch (err: any) {
      console.error(err);
      setErrorMessage(
        lang === 'ja'
          ? `復元エラー: ${err?.message || '有効なバックアップZIPファイルを選択してください'}`
          : `Restore error: ${err?.message}`
      );
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="card" id="workspaceBackupSection" style={{ marginTop: '16px' }}>
      {/* Title */}
      <div className="section-title flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-blue-600" />
          <span style={{ fontWeight: 700 }}>
            {lang === 'ja' ? '3. データ引き継ぎ・作業状態バックアップ' : '3. Cross-Device Workspace Backup & Sync'}
          </span>
        </div>
        <span className="text-xs text-slate-500 font-semibold">
          {lang === 'ja'
            ? '別PC・スマホ・ブラウザへの全データ引継ぎ'
            : 'Continue work on other devices seamlessly'}
        </span>
      </div>

      <p className="text-xs text-slate-500 mb-4 leading-relaxed">
        {lang === 'ja'
          ? '現在読み込み中のファイルキュー、変換結果、履歴データ、およびHTML/Markdownのエディタ下書きを1つのZIPファイルにまとめ、別デバイスへ丸ごと引き継げます。'
          : 'Export your current file queue, converted results, history, and editor drafts into a portable backup ZIP archive to resume on any PC, tablet, or mobile device.'}
      </p>

      {/* Status or Error Notice */}
      {statusMessage && (
        <div className="mb-4 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* 2-Column Responsive Layout: Export on Left, Import on Right */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left Column: Export Backup */}
        <div className="p-4 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 flex flex-col justify-between gap-3">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <Download className="w-4 h-4 text-blue-600" />
                <span>{lang === 'ja' ? '作業状態をバックアップ出力' : 'Export Current Workspace'}</span>
              </span>
              <span className="text-[11px] font-semibold text-slate-500">
                {lang === 'ja' ? `キュー: ${fileList.length} 件` : `${fileList.length} files in queue`}
              </span>
            </div>

            <p className="text-[11px] text-slate-500">
              {lang === 'ja'
                ? '読み込み済みファイル、変換結果、設定、HTML/MD下書きを丸ごと内蔵したバックアップファイルを生成します。'
                : 'Generates a complete ZIP archive with all files, results, drafts, and settings.'}
            </p>

            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none mt-1">
              <input
                type="checkbox"
                checked={includeHistory}
                onChange={(e) => setIncludeHistory(e.target.checked)}
                className="accent-blue-600 rounded"
              />
              <span>{lang === 'ja' ? 'ローカル変換履歴も含める' : 'Include local history items'}</span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200/80 dark:border-slate-700/80">
            <button
              onClick={handleDownloadBackup}
              disabled={isExporting}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-xs font-bold shadow-xs transition cursor-pointer"
            >
              {isExporting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              <span>{lang === 'ja' ? 'バックアップを保存 (.zip)' : 'Download Backup (.zip)'}</span>
            </button>

            {getStoredToken() && (
              <button
                onClick={handleBackupToDrive}
                disabled={isSavingDrive}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 text-xs font-bold text-slate-700 dark:text-slate-200 transition cursor-pointer"
                title="Google Driveに保存"
              >
                {isSavingDrive ? <RefreshCw className="w-4 h-4 animate-spin" /> : <HardDrive className="w-4 h-4 text-emerald-600" />}
                <span>Drive</span>
              </button>
            )}
          </div>
        </div>

        {/* Right Column: Restore / Import Backup */}
        <div className="p-4 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 flex flex-col justify-between gap-3">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <ArchiveRestore className="w-4 h-4 text-emerald-600" />
              <span>{lang === 'ja' ? 'バックアップから復元・引き継ぎ' : 'Restore Workspace from Backup'}</span>
            </span>

            <p className="text-[11px] text-slate-500">
              {lang === 'ja'
                ? '以前出力した「.umc-backup.zip」を選択またはドラッグ＆ドロップすると、即座にこの端末へ復元されます。'
                : 'Select or drag & drop a ".umc-backup.zip" to restore files, drafts, and history onto this device.'}
            </p>
          </div>

          <input
            ref={importInputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                processImportFile(e.target.files[0]);
                e.target.value = '';
              }
            }}
          />

          <div
            onClick={() => importInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                processImportFile(e.dataTransfer.files[0]);
              }
            }}
            className={`border-2 border-dashed rounded-xl p-4 flex items-center justify-center gap-2.5 text-center cursor-pointer transition ${
              isDragging
                ? 'border-blue-500 bg-blue-50/60 dark:bg-blue-950/40'
                : 'border-slate-300 dark:border-slate-700 hover:border-blue-400 bg-white dark:bg-slate-900/60'
            }`}
          >
            {isImporting ? (
              <RefreshCw className="w-4 h-4 animate-spin text-blue-600" />
            ) : (
              <Upload className="w-4 h-4 text-blue-600" />
            )}
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
              {isImporting
                ? lang === 'ja' ? '復元処理中...' : 'Restoring workspace...'
                : lang === 'ja'
                ? 'バックアップZIPファイルを選択またはドロップ'
                : 'Select or drop backup ZIP to restore'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
