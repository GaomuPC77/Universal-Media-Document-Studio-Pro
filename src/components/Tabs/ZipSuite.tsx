import React, { useState, useRef, useEffect } from 'react';
import {
  Archive,
  Upload,
  Download,
  FolderOpen,
  FileText,
  Trash2,
  Plus,
  RefreshCw,
  FolderArchive,
  CheckCircle2,
} from 'lucide-react';
import { inspectZip, extractZipEntry, createZipArchive, ZipEntryInfo } from '../../utils/zipUtils';
import { saveProcessedFile } from '../../utils/historyDb';
import { FileItem } from '../../types';
import { notifyCompletion } from '../../utils/notification';
import { AddToQueuePromptModal } from '../Modals/AddToQueuePromptModal';

interface ZipSuiteProps {
  lang: 'ja' | 'en';
  fileList?: FileItem[];
  onResultReady?: (item: FileItem) => void;
  onShowToast?: (msg: string) => void;
  onAddFiles?: (files: File[]) => void;
}

export const ZipSuite: React.FC<ZipSuiteProps> = ({
  lang,
  fileList = [],
  onResultReady,
  onShowToast,
  onAddFiles,
}) => {
  const [activeTab, setActiveTab] = useState<'inspect' | 'create' | 'rename'>('inspect');
  const [selectedZipId, setSelectedZipId] = useState<string>('');
  const [pendingPromptFile, setPendingPromptFile] = useState<{ file: File; mode: 'inspect' | 'create' } | null>(null);

  // Inspect state
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [zipEntries, setZipEntries] = useState<ZipEntryInfo[]>([]);
  const [isInspecting, setIsInspecting] = useState(false);
  const zipInputRef = useRef<HTMLInputElement>(null);

  // Create zip state
  const [createFiles, setCreateFiles] = useState<{ id: string; file: File; name: string; size: number }[]>([]);
  const [zipArchiveName, setZipArchiveName] = useState<string>('Archive.zip');
  const [isCreatingZip, setIsCreatingZip] = useState(false);
  const createInputRef = useRef<HTMLInputElement>(null);

  // Batch rename state
  const [renamePrefix, setRenamePrefix] = useState<string>('DOC_');
  const [renameSuffix, setRenameSuffix] = useState<string>('');
  const [renameIncludeNumber, setRenameIncludeNumber] = useState<boolean>(true);

  // Auto populate files from fileList if available
  useEffect(() => {
    if (fileList.length > 0) {
      if (!zipFile) {
        const foundZip = fileList.find((f) => f.format === 'zip' || f.name.toLowerCase().endsWith('.zip'));
        if (foundZip && foundZip.file) {
          setSelectedZipId(foundZip.id);
          handleSelectZip(foundZip.file);
        }
      }
      if (createFiles.length === 0) {
        setCreateFiles(fileList.filter((f) => f.file).map((f) => ({ id: f.id, file: f.file, name: f.name, size: f.size })));
      }
    }
  }, [fileList]);

  // Handle ZIP inspect
  const handleSelectZip = async (file: File) => {
    setZipFile(file);
    setIsInspecting(true);
    try {
      const entries = await inspectZip(file);
      setZipEntries(entries);
    } catch (e) {
      console.error('Failed to read zip:', e);
    } finally {
      setIsInspecting(false);
    }
  };

  // Extract a specific file from zip
  const handleExtractFile = async (entryName: string) => {
    if (!zipFile) return;
    try {
      const blob = await extractZipEntry(zipFile, entryName);
      const fileName = entryName.split('/').pop() || entryName;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      const ext = fileName.split('.').pop()?.toLowerCase() || 'txt';
      await saveProcessedFile(`zip_ext_${Date.now()}`, zipFile.name, fileName, blob, ext as any);

      if (onResultReady) {
        onResultReady({
          id: `res_zipext_${Date.now()}`,
          name: fileName,
          file: new File([blob], fileName, { type: blob.type }),
          size: blob.size,
          type: blob.type,
          format: ext as any,
          targetFormat: ext as any,
          status: 'done',
          progress: 100,
          resultBlob: blob,
          resultName: fileName,
        });
      }
      if (onShowToast) onShowToast(lang === 'ja' ? `「${fileName}」を抽出・保存しました` : `Extracted "${fileName}"`);
    } catch (e) {
      console.error('Extract failed:', e);
    }
  };

  // Create new ZIP
  const handleCreateZipArchive = async () => {
    if (createFiles.length === 0) return;
    setIsCreatingZip(true);
    const resultName = zipArchiveName.endsWith('.zip') ? zipArchiveName : `${zipArchiveName}.zip`;
    try {
      const filesToArchive = createFiles.map((f, idx) => {
        let finalName = f.name;
        if (activeTab === 'rename') {
          const ext = f.name.includes('.') ? '.' + f.name.split('.').pop() : '';
          const base = f.name.replace(/\.[^/.]+$/, '');
          const numStr = renameIncludeNumber ? `_${String(idx + 1).padStart(2, '0')}` : '';
          finalName = `${renamePrefix}${base}${renameSuffix}${numStr}${ext}`;
        }
        return {
          name: finalName,
          content: f.file,
        };
      });

      const zipBlob = await createZipArchive(filesToArchive);
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = resultName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      await saveProcessedFile(`zip_create_${Date.now()}`, 'batch_files', resultName, zipBlob, 'zip');

      if (onResultReady) {
        onResultReady({
          id: `res_zipcreate_${Date.now()}`,
          name: resultName,
          file: new File([zipBlob], resultName, { type: 'application/zip' }),
          size: zipBlob.size,
          type: 'application/zip',
          format: 'zip',
          targetFormat: 'zip',
          status: 'done',
          progress: 100,
          resultBlob: zipBlob,
          resultName,
        });
      }

      notifyCompletion(lang === 'ja' ? 'ZIPアーカイブの作成が完了しました' : 'ZIP Created', resultName);
      if (onShowToast) onShowToast(lang === 'ja' ? `「${resultName}」を作成しました` : `Saved "${resultName}"`);
    } catch (e) {
      console.error('Failed to create zip:', e);
    } finally {
      setIsCreatingZip(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto">
      {/* Add To Queue Confirmation Modal */}
      <AddToQueuePromptModal
        file={pendingPromptFile?.file || null}
        isOpen={!!pendingPromptFile}
        lang={lang}
        onConfirmAddToQueue={() => {
          if (!pendingPromptFile) return;
          const { file, mode } = pendingPromptFile;
          if (onAddFiles) {
            onAddFiles([file]);
          }
          if (mode === 'inspect') {
            handleSelectZip(file);
          } else {
            setCreateFiles((prev) => [
              ...prev,
              { id: `cf_${Date.now()}`, file, name: file.name, size: file.size },
            ]);
          }
          if (onShowToast) {
            onShowToast(lang === 'ja' ? '変換・処理ステータス（全体キュー）に追加しました' : 'Added to global status queue');
          }
          setPendingPromptFile(null);
        }}
        onUseLocalOnly={() => {
          if (!pendingPromptFile) return;
          const { file, mode } = pendingPromptFile;
          if (mode === 'inspect') {
            handleSelectZip(file);
          } else {
            setCreateFiles((prev) => [
              ...prev,
              { id: `cf_${Date.now()}`, file, name: file.name, size: file.size },
            ]);
          }
          if (onShowToast) {
            onShowToast(lang === 'ja' ? 'このタブのみに読み込みました' : 'Loaded into this tab only');
          }
          setPendingPromptFile(null);
        }}
      />

      {/* Sub Tabs */}
      <div className="grid grid-cols-3 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 max-w-md mx-auto w-full">
        {[
          { id: 'inspect', labelJa: 'ZIP内閲覧・抽出', labelEn: 'Inspect ZIP', icon: FolderOpen },
          { id: 'create', labelJa: 'ZIPアーカイブ作成', labelEn: 'Create ZIP', icon: FolderArchive },
          { id: 'rename', labelJa: '一括リネーム＆ZIP', labelEn: 'Batch Rename', icon: Archive },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition ${
                isActive
                  ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{lang === 'ja' ? tab.labelJa : tab.labelEn}</span>
            </button>
          );
        })}
      </div>

      {/* 1. Inspect Zip */}
      {activeTab === 'inspect' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h3 className="font-bold text-sm sm:text-base text-slate-800 dark:text-slate-100">
                {lang === 'ja' ? 'ZIPアーカイブの中身を解凍せずにプレビュー・個別抽出' : 'Inspect & Extract ZIP Archive'}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {lang === 'ja'
                  ? 'ディスクに解凍することなく、ZIP内のファイル名・ファイルサイズを確認して個別保存できます。'
                  : 'View files inside ZIP archives without extracting to disk.'}
              </p>
            </div>
            <input
              ref={zipInputRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  setPendingPromptFile({ file: e.target.files[0], mode: 'inspect' });
                  e.target.value = '';
                }
              }}
            />
          </div>

          {/* Select Loaded ZIP */}
          <div>
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
              {lang === 'ja' ? '確認対象のZIPファイルを選択:' : 'Select Target ZIP File:'}
            </label>
            <select
              value={selectedZipId}
              onChange={(e) => {
                const id = e.target.value;
                if (id === '__upload_new__') {
                  zipInputRef.current?.click();
                  return;
                }
                setSelectedZipId(id);
                const found = fileList.find((f) => f.id === id);
                if (found && found.file) {
                  handleSelectZip(found.file);
                }
              }}
              className="main-select"
            >
              <option value="">{lang === 'ja' ? '-- アップロードされたZIPを選択 --' : '-- Select Loaded ZIP --'}</option>
              <option value="__upload_new__">
                {lang === 'ja' ? '📁 ＋ 新しいZIPを端末からアップロード...' : '📁 + Upload New ZIP File...'}
              </option>
              {fileList
                  .filter((f) => f.format === 'zip' || f.name.toLowerCase().endsWith('.zip'))
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({(f.size / 1024).toFixed(1)} KB)
                    </option>
                  ))}
              </select>
            </div>

          {!zipFile ? (
            <div
              onClick={() => zipInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer bg-slate-50/50 transition"
            >
              <Archive className="w-10 h-10 text-slate-400 mb-2" />
              <p className="text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300">
                {lang === 'ja' ? '閲覧したいZIPファイルをドラッグまたは選択' : 'Select ZIP file to inspect'}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl border border-blue-200 dark:border-blue-900 text-xs">
                <span className="font-semibold text-blue-900 dark:text-blue-200">
                  {zipFile.name} ({(zipFile.size / 1024).toFixed(1)} KB) - {zipEntries.length} ファイル格納
                </span>
                <button
                  onClick={() => zipInputRef.current?.click()}
                  className="text-xs underline font-semibold text-blue-600 dark:text-blue-400"
                >
                  {lang === 'ja' ? '別のZIPを開く' : 'Change ZIP'}
                </button>
              </div>

              {/* Entries list */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 max-h-80 overflow-auto bg-slate-50/50 dark:bg-slate-900/50">
                {zipEntries.map((entry, idx) => (
                  <div key={idx} className="p-3 flex items-center justify-between hover:bg-slate-100/60 dark:hover:bg-slate-800/40 transition">
                    <div className="flex items-center gap-2.5 truncate">
                      <FileText className="w-4 h-4 text-amber-500 flex-shrink-0" />
                      <span className="text-xs font-mono font-medium text-slate-800 dark:text-slate-200 truncate">
                        {entry.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-[11px] text-slate-500">{(entry.size / 1024).toFixed(1)} KB</span>
                      {!entry.dir && (
                        <button
                          onClick={() => handleExtractFile(entry.name)}
                          className="p-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-blue-600 hover:text-white transition"
                          title="このファイルを保存"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2. & 3. Create ZIP & Batch Rename */}
      {(activeTab === 'create' || activeTab === 'rename') && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h3 className="font-bold text-sm sm:text-base text-slate-800 dark:text-slate-100">
                {activeTab === 'rename'
                  ? lang === 'ja'
                    ? '複数ファイルの一括リネーム＆ZIPアーカイブ出力'
                    : 'Batch File Rename & ZIP Export'
                  : lang === 'ja'
                  ? '複数ファイルからZIPアーカイブを作成'
                  : 'Create ZIP Archive'}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {lang === 'ja'
                  ? '任意のドキュメントや画像を追加して、高圧縮ZIPファイルを作成します。'
                  : 'Combine any documents and images into a compressed ZIP file.'}
              </p>
            </div>
            <input
              ref={createInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  setPendingPromptFile({ file: e.target.files[0], mode: 'create' });
                  e.target.value = '';
                }
              }}
            />
          </div>

          {/* Target File Selector Dropdown */}
          <div>
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
              {lang === 'ja' ? 'ZIPに追加するファイルを選択:' : 'Select Files to Add to ZIP:'}
            </label>
            <select
              value=""
              onChange={(e) => {
                const val = e.target.value;
                if (val === '__upload_new__') {
                  createInputRef.current?.click();
                  return;
                }
                if (val === '__all__') {
                  const existingNames = new Set(createFiles.map((c) => c.name));
                  const newItems = fileList
                    .filter((f) => f.file && !existingNames.has(f.name))
                    .map((f) => ({ id: `cf_${Date.now()}_${Math.random()}`, file: f.file!, name: f.name, size: f.size }));
                  setCreateFiles((prev) => [...prev, ...newItems]);
                  if (onShowToast) onShowToast(lang === 'ja' ? `キューから ${newItems.length} 件のファイルを追加しました` : `Added ${newItems.length} files from queue`);
                  return;
                }
                const found = fileList.find((f) => f.id === val);
                if (found && found.file) {
                  setCreateFiles((prev) => {
                    if (prev.some((item) => item.name === found.name)) return prev;
                    return [...prev, { id: `cf_${Date.now()}_${Math.random()}`, file: found.file!, name: found.name, size: found.size }];
                  });
                  if (onShowToast) onShowToast(lang === 'ja' ? `「${found.name}」を追加しました` : `Added "${found.name}"`);
                }
              }}
              className="main-select"
            >
              <option value="">{lang === 'ja' ? '-- アップロードされたファイルを選択してZIPに追加 --' : '-- Select Uploaded File to Add to ZIP --'}</option>
              <option value="__upload_new__">
                {lang === 'ja' ? '📁 ＋ 新しいファイルを端末からアップロード...' : '📁 + Upload New Files from Device...'}
              </option>
              {fileList.length > 0 && (
                <option value="__all__">
                  {lang === 'ja' ? '⚡ キュー内のすべてのファイルを追加' : '⚡ Add All Files in Queue'}
                </option>
              )}
              {fileList.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} ({(f.size / 1024).toFixed(1)} KB)
                </option>
              ))}
            </select>
          </div>

          {/* Rename rules if activeTab is rename */}
          {activeTab === 'rename' && (
            <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  接頭辞 (Prefix)
                </label>
                <input
                  type="text"
                  value={renamePrefix}
                  onChange={(e) => setRenamePrefix(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold"
                  placeholder="DOC_"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  接尾辞 (Suffix)
                </label>
                <input
                  type="text"
                  value={renameSuffix}
                  onChange={(e) => setRenameSuffix(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold"
                  placeholder="_v1"
                />
              </div>

              <div className="flex items-center pt-5">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={renameIncludeNumber}
                    onChange={(e) => setRenameIncludeNumber(e.target.checked)}
                    className="rounded text-blue-600"
                  />
                  <span>連番を付加 (_01, _02...)</span>
                </label>
              </div>
            </div>
          )}

          {/* Files queue */}
          {createFiles.length === 0 ? (
            <div
              onClick={() => createInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer bg-slate-50/50 transition"
            >
              <FolderArchive className="w-10 h-10 text-slate-400 mb-2" />
              <p className="text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300">
                {lang === 'ja' ? 'ZIPにまとめたいファイルを選択' : 'Select files to package'}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 max-h-64 overflow-auto">
                {createFiles.map((f, idx) => {
                  let renamed = f.name;
                  if (activeTab === 'rename') {
                    const ext = f.name.includes('.') ? '.' + f.name.split('.').pop() : '';
                    const base = f.name.replace(/\.[^/.]+$/, '');
                    const numStr = renameIncludeNumber ? `_${String(idx + 1).padStart(2, '0')}` : '';
                    renamed = `${renamePrefix}${base}${renameSuffix}${numStr}${ext}`;
                  }

                  return (
                    <div key={f.id} className="p-2.5 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 truncate">
                        <FileText className="w-4 h-4 text-blue-500 flex-shrink-0" />
                        <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">{f.name}</span>
                        {activeTab === 'rename' && (
                          <span className="text-slate-400 font-mono text-[11px] truncate">→ {renamed}</span>
                        )}
                      </div>
                      <button
                        onClick={() => setCreateFiles((prev) => prev.filter((item) => item.id !== f.id))}
                        className="text-slate-400 hover:text-red-500"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <input
                  type="text"
                  value={zipArchiveName}
                  onChange={(e) => setZipArchiveName(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold text-slate-800 dark:text-slate-200 w-48"
                  placeholder="Archive.zip"
                />

                <button
                  onClick={handleCreateZipArchive}
                  disabled={isCreatingZip}
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-md shadow-blue-500/20 transition"
                >
                  {isCreatingZip ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  <span>{lang === 'ja' ? 'ZIPを作成してダウンロード' : 'Create & Download ZIP'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
