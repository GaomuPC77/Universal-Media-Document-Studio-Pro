import React, { useState, useRef } from 'react';
import {
  ArchiveRestore,
  Download,
  Upload,
  HardDrive,
  CheckCircle2,
  RefreshCw,
  X,
  Layers,
  History,
  Smartphone,
} from 'lucide-react';
import { FileItem } from '../../types';
import { exportWorkspaceBackup, importWorkspaceBackup } from '../../utils/backupUtils';
import { uploadFileToDrive, getStoredToken } from '../../utils/googleDrive';

interface BackupModalProps {
  isOpen: boolean;
  onClose: () => void;
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

export const BackupModal: React.FC<BackupModalProps> = ({
  isOpen,
  onClose,
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
  const [errorMsg, setErrorMsg] = useState<string>('');
  const importInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const getBackupFileName = () => {
    const now = new Date();
    const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    return `UMC_Workspace_Backup_${ymd}.umc-backup.zip`;
  };

  const handleDownloadBackup = async () => {
    setIsExporting(true);
    setErrorMsg('');
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
      URL.revokeObjectURL(url);

      onShowToast(
        lang === 'ja'
          ? `バックアップファイル「${fileName}」を保存しました`
          : `Saved backup file "${fileName}"`
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Backup export failed');
    } finally {
      setIsExporting(false);
    }
  };

  const handleBackupToDrive = async () => {
    setIsSavingDrive(true);
    setErrorMsg('');
    try {
      const blob = await exportWorkspaceBackup(fileList, activeTab, lang, theme, includeHistory);
      const fileName = getBackupFileName();
      await uploadFileToDrive(fileName, 'application/zip', blob);
      onShowToast(
        lang === 'ja'
          ? `Google Driveにバックアップ「${fileName}」を保存しました`
          : `Saved backup "${fileName}" to Google Drive`
      );
    } catch (err: any) {
      setErrorMsg(
        lang === 'ja'
          ? `Google Driveへの保存に失敗しました: ${err?.message || '連携状態を確認してください'}`
          : `Failed to upload to Google Drive: ${err?.message}`
      );
    } finally {
      setIsSavingDrive(false);
    }
  };

  const handleFileImport = async (file: File) => {
    setIsImporting(true);
    setErrorMsg('');
    try {
      const result = await importWorkspaceBackup(file);
      onRestoreBackup(result);
      onShowToast(
        lang === 'ja'
          ? `バックアップを復元しました（ファイル ${result.restoredFiles.length}件 / 履歴 ${result.historyCount}件）`
          : `Restored ${result.restoredFiles.length} files and ${result.historyCount} history items`
      );
      onClose();
    } catch (err: any) {
      setErrorMsg(
        lang === 'ja'
          ? `バックアップファイルの読み込みに失敗しました。有効なバックアップZIP（.umc-backup.zip）を選択してください。(${err?.message})`
          : `Failed to restore backup. Please select a valid .umc-backup.zip file. (${err?.message})`
      );
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl flex flex-col gap-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                {lang === 'ja' ? 'データ引き継ぎ・作業バックアップ' : 'Cross-Device Workspace Backup & Restore'}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {lang === 'ja'
                  ? '現在読み込み中のファイル・変換設定・処理結果・履歴を1つのパッケージにまとめ、別デバイスや別ブラウザへそのまま引き継げます。'
                  : 'Package your loaded files, conversion queue, results, and history into a single file to continue working on another device.'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
            {errorMsg}
          </div>
        )}

        {/* Section 1: Export Backup */}
        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <Download className="w-4 h-4 text-blue-600" />
              <span>{lang === 'ja' ? '1. 現在の作業状態をバックアップ出力' : '1. Export Current Workspace'}</span>
            </span>
            <span className="text-[11px] font-semibold text-slate-500">
              {lang === 'ja' ? `対象ファイル: ${fileList.length} 件` : `Queue: ${fileList.length} files`}
            </span>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeHistory}
              onChange={(e) => setIncludeHistory(e.target.checked)}
              className="accent-blue-600 rounded"
            />
            <span>
              {lang === 'ja'
                ? '過去の変換履歴データ（IndexedDB内）もバックアップに含める'
                : 'Include saved conversion history from local storage'}
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              onClick={handleDownloadBackup}
              disabled={isExporting}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-xs font-bold shadow-xs transition"
            >
              {isExporting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              <span>{lang === 'ja' ? 'バックアップファイルを保存 (.zip)' : 'Download Backup (.zip)'}</span>
            </button>

            {getStoredToken() && (
              <button
                onClick={handleBackupToDrive}
                disabled={isSavingDrive}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 text-xs font-bold text-slate-700 dark:text-slate-200 transition"
              >
                {isSavingDrive ? <RefreshCw className="w-4 h-4 animate-spin" /> : <HardDrive className="w-4 h-4 text-emerald-600" />}
                <span>{lang === 'ja' ? 'Driveへ保存' : 'Save to Drive'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Section 2: Restore / Import Backup */}
        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 flex flex-col gap-3">
          <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
            <ArchiveRestore className="w-4 h-4 text-emerald-600" />
            <span>{lang === 'ja' ? '2. バックアップファイルから復元・引き継ぎ' : '2. Restore Workspace from Backup'}</span>
          </span>

          <p className="text-xs text-slate-500">
            {lang === 'ja'
              ? '別デバイスで出力した「.umc-backup.zip」ファイルを選択すると、処理中のファイル一覧・設定・履歴をこの端末に復元します。'
              : 'Select a previously exported ".umc-backup.zip" file to restore all pending files, settings, and history onto this device.'}
          </p>

          <input
            ref={importInputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                handleFileImport(e.target.files[0]);
                e.target.value = '';
              }
            }}
          />

          <button
            onClick={() => importInputRef.current?.click()}
            disabled={isImporting}
            className="w-full py-2.5 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 bg-white dark:bg-slate-900 text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center justify-center gap-2 transition cursor-pointer"
          >
            {isImporting ? (
              <RefreshCw className="w-4 h-4 animate-spin text-blue-600" />
            ) : (
              <Upload className="w-4 h-4 text-blue-600" />
            )}
            <span>
              {lang === 'ja'
                ? 'バックアップファイル (.zip) を選択して復元'
                : 'Select Backup File (.zip) to Restore'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
