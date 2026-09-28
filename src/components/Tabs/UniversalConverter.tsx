import React, { useState, useRef, useEffect } from 'react';
import {
  FileText,
  Download,
  Trash2,
  Eye,
  CheckCircle2,
  AlertCircle,
  HardDrive,
  RefreshCw,
  FolderArchive,
  Settings,
  Sparkles,
  History,
  Bell,
  Check,
} from 'lucide-react';
import { FileItem, DocumentFormat } from '../../types';
import { extractPdfText, convertPdfToImages, imagesToPdf } from '../../utils/pdfUtils';
import { docxToHtml, docxToText, createDocxFromText, parseSpreadsheet, exportSpreadsheet, textToPdf, spreadsheetToPdf } from '../../utils/officeUtils';
import { createZipArchive } from '../../utils/zipUtils';
import { saveProcessedFile, getAllHistory, HistoryItem } from '../../utils/historyDb';
import { notifyCompletion, getNotificationPermission, requestNotificationPermission } from '../../utils/notification';

interface UniversalConverterProps {
  lang: 'ja' | 'en';
  fileList: FileItem[];
  setFileList: React.Dispatch<React.SetStateAction<FileItem[]>>;
  onAddFiles: (files: FileList | File[]) => void;
  onPreview: (item: FileItem) => void;
  onSaveToDrive: (item: FileItem) => void;
  onOpenDrivePicker?: () => void;
  onOpenHistory?: () => void;
}

export const UniversalConverter: React.FC<UniversalConverterProps> = ({
  lang,
  fileList,
  setFileList,
  onAddFiles,
  onPreview,
  onSaveToDrive,
  onOpenDrivePicker,
  onOpenHistory,
}) => {
  const [historyFiles, setHistoryFiles] = useState<HistoryItem[]>([]);
  const [isProcessingAll, setIsProcessingAll] = useState(false);

  const [selectedTargetId, setSelectedTargetId] = useState<string>('all');
  const [selectedGlobalFormat, setSelectedGlobalFormat] = useState<DocumentFormat>('pdf');
  const [qualityPreset, setQualityPreset] = useState<'fast' | 'balanced' | 'high'>('fast');
  const [renameMode, setRenameMode] = useState<'none' | 'affix' | 'custom'>('none');
  const [renamePrefix, setRenamePrefix] = useState<string>('');
  const [renameSuffix, setRenameSuffix] = useState<string>('');
  const [renameCustomName, setRenameCustomName] = useState<string>('');
  const [chkCompress, setChkCompress] = useState<boolean>(true);

  const [overallProgress, setOverallProgress] = useState<number>(0);
  const [overallStatusText, setOverallStatusText] = useState<string>(lang === 'ja' ? '待機中' : 'Idle');
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>(getNotificationPermission());

  const handleToggleNotification = async () => {
    const res = await requestNotificationPermission();
    setNotifPermission(res);
  };

  const loadHistoryFiles = async () => {
    const list = await getAllHistory();
    setHistoryFiles(list);
  };

  useEffect(() => {
    loadHistoryFiles();
  }, []);

  const getFormatFromExt = (fileName: string): DocumentFormat => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    if (['png', 'jpg', 'jpeg', 'webp', 'svg', 'bmp', 'ico', 'gif', 'mp4', 'webm', 'mov', 'mp3', 'wav', 'm4a', 'aac', 'ogg'].includes(ext)) {
      return ext as DocumentFormat;
    }
    if (['pdf', 'docx', 'xlsx', 'xls', 'csv', 'tsv', 'txt', 'md', 'html', 'json', 'xml', 'rtf', 'zip'].includes(ext)) {
      return ext as DocumentFormat;
    }
    return 'txt';
  };

  const handleAddFromHistory = (h: HistoryItem) => {
    const fileObj = new File([h.data], h.fileName, {
      type: h.format === 'pdf' ? 'application/pdf' : 'application/octet-stream',
    });
    const format = getFormatFromExt(h.fileName);
    const newItem: FileItem = {
      id: `hist_${h.id}_${Date.now()}`,
      name: h.fileName,
      size: h.data.byteLength,
      type: fileObj.type,
      format,
      targetFormat: format === 'pdf' ? 'docx' : 'pdf',
      status: 'idle',
      progress: 0,
      file: fileObj,
    };
    setFileList((prev) => {
      if (prev.some((f) => f.name === h.fileName && f.size === h.data.byteLength)) return prev;
      return [newItem, ...prev];
    });
  };

  const removeItem = (id: string) => {
    setFileList((prev) => prev.filter((item) => item.id !== id));
  };

  const clearAll = () => {
    setFileList([]);
    setOverallProgress(0);
    setOverallStatusText(lang === 'ja' ? '待機中' : 'Idle');
  };

  // Core Conversion Engine for single item
  const processItem = async (item: FileItem): Promise<FileItem> => {
    if (!item.file) {
      return { ...item, status: 'error', error: 'File object missing' };
    }

    const { format, targetFormat, file, name } = item;
    const baseName = name.substring(0, name.lastIndexOf('.')) || name;

    try {
      let resultBlob: Blob | undefined;
      let resultName = `${baseName}.${targetFormat}`;

      if (format === 'docx' && targetFormat === 'pdf') {
        const text = await docxToText(file);
        const pdfBytes = await textToPdf(text, { title: baseName });
        resultBlob = new Blob([pdfBytes], { type: 'application/pdf' });
      } else if (format === 'docx' && (targetFormat === 'html' || targetFormat === 'md' || targetFormat === 'txt')) {
        if (targetFormat === 'html') {
          const html = await docxToHtml(file);
          resultBlob = new Blob([html], { type: 'text/html;charset=utf-8' });
        } else {
          const text = await docxToText(file);
          resultBlob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        }
      } else if ((format === 'xlsx' || format === 'xls') && targetFormat === 'pdf') {
        const data = await parseSpreadsheet(file);
        const firstSheet = data.sheets[data.sheetNames[0]] || [];
        const pdfBytes = await spreadsheetToPdf(firstSheet, baseName);
        resultBlob = new Blob([pdfBytes], { type: 'application/pdf' });
      } else if ((format === 'xlsx' || format === 'xls') && (targetFormat === 'csv' || targetFormat === 'tsv' || targetFormat === 'json')) {
        const data = await parseSpreadsheet(file);
        const firstSheet = data.sheets[data.sheetNames[0]] || [];
        const convertedBlob = await exportSpreadsheet(firstSheet, targetFormat as any);
        resultBlob = convertedBlob;
      } else if ((format === 'csv' || format === 'tsv') && targetFormat === 'xlsx') {
        const data = await parseSpreadsheet(file);
        const firstSheet = data.sheets[data.sheetNames[0]] || [];
        const convertedBlob = await exportSpreadsheet(firstSheet, 'xlsx');
        resultBlob = convertedBlob;
      } else if ((format === 'csv' || format === 'tsv') && targetFormat === 'pdf') {
        const data = await parseSpreadsheet(file);
        const firstSheet = data.sheets[data.sheetNames[0]] || [];
        const pdfBytes = await spreadsheetToPdf(firstSheet, baseName);
        resultBlob = new Blob([pdfBytes], { type: 'application/pdf' });
      } else if (format === 'pdf' && ['png', 'jpg', 'jpeg', 'webp'].includes(targetFormat)) {
        const images = await convertPdfToImages(file, targetFormat as any);
        if (images.length === 1) {
          resultBlob = images[0].blob;
          resultName = `${baseName}.${targetFormat}`;
        } else if (images.length > 1) {
          const entries = images.map((img) => ({
            name: `${baseName}_p${img.pageNumber}.${targetFormat}`,
            content: img.blob,
          }));
          resultBlob = await createZipArchive(entries);
          resultName = `${baseName}_pages.zip`;
        }
      } else if (['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(format) && targetFormat === 'pdf') {
        const fileBuf = await file.arrayBuffer();
        const pdfBytes = await imagesToPdf(
          [{ name: file.name, data: fileBuf, type: file.type || 'image/png' }],
          { pageSize: 'A4', orientation: 'auto', margin: 20 }
        );
        resultBlob = new Blob([pdfBytes], { type: 'application/pdf' });
      } else if (format === 'pdf' && targetFormat === 'txt') {
        const text = await extractPdfText(file);
        resultBlob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      } else if (format === 'pdf' && targetFormat === 'docx') {
        const text = await extractPdfText(file);
        const docxBlob = await createDocxFromText(text || `${baseName} content`);
        resultBlob = docxBlob;
      } else if (targetFormat === 'zip') {
        resultBlob = await createZipArchive([{ name: file.name, content: file }]);
        resultName = `${baseName}.zip`;
      } else {
        const text = await file.text();
        if (targetFormat === 'pdf') {
          const pdfBytes = await textToPdf(text, { title: baseName });
          resultBlob = new Blob([pdfBytes], { type: 'application/pdf' });
        } else if (targetFormat === 'docx') {
          resultBlob = await createDocxFromText(text);
        } else {
          resultBlob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        }
      }

      if (renameMode === 'affix') {
        resultName = `${renamePrefix}${baseName}${renameSuffix}.${targetFormat}`;
      } else if (renameMode === 'custom') {
        resultName = `${renameCustomName || 'converted'}_01.${targetFormat}`;
      }

      return {
        ...item,
        status: 'done',
        progress: 100,
        resultBlob,
        resultName,
      };
    } catch (err: any) {
      console.error(`Conversion error for ${item.name}:`, err);
      return {
        ...item,
        status: 'error',
        error: err.message || 'Conversion failed',
      };
    }
  };

  // Convert selected or all files
  const handleStartConversion = async () => {
    if (fileList.length === 0) return;

    let targets: FileItem[] = [];
    if (selectedTargetId === 'all') {
      targets = fileList.map((f) => ({ ...f, targetFormat: selectedGlobalFormat }));
    } else {
      targets = fileList.map((f) => (f.id === selectedTargetId ? { ...f, targetFormat: selectedGlobalFormat } : f));
    }

    setIsProcessingAll(true);
    setOverallProgress(5);
    setOverallStatusText(lang === 'ja' ? '変換処理中...' : 'Processing...');

    const total = targets.length;
    let completed = 0;

    const updatedList: FileItem[] = [...fileList];

    for (let i = 0; i < total; i++) {
      const item = targets[i];
      const targetIdx = updatedList.findIndex((f) => f.id === item.id);
      if (targetIdx === -1) continue;

      updatedList[targetIdx] = { ...updatedList[targetIdx], status: 'processing', progress: 30 };
      setFileList([...updatedList]);

      const updated = await processItem({ ...item, targetFormat: selectedGlobalFormat });
      updatedList[targetIdx] = updated;

      if (updated.resultBlob && updated.status === 'done') {
        const buf = await updated.resultBlob.arrayBuffer();
        await saveProcessedFile(
          item.id,
          item.name,
          updated.resultName || item.name,
          buf,
          selectedGlobalFormat
        );
      }

      completed++;
      const pct = Math.round((completed / total) * 100);
      setOverallProgress(pct);
      setOverallStatusText(lang === 'ja' ? `変換中 (${completed}/${total}): ${pct}%` : `Converting (${completed}/${total}): ${pct}%`);
      setFileList([...updatedList]);
    }

    setOverallProgress(100);
    setOverallStatusText(lang === 'ja' ? '全ての変換が完了しました！' : 'All conversions completed!');
    setIsProcessingAll(false);
    loadHistoryFiles();

    // Trigger completion notification and sound chime
    notifyCompletion(
      lang === 'ja' ? '変換が完了しました！' : 'Conversion Completed!',
      lang === 'ja'
        ? `全 ${completed} 件のファイル変換が正常に完了しました。クリックして確認・保存できます。`
        : `Successfully converted ${completed} files. Click to review and download.`
    );
  };

  const handleDownload = (item: FileItem) => {
    if (!item.resultBlob) return;
    const url = URL.createObjectURL(item.resultBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = item.resultName || item.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadAllZip = async () => {
    const doneItems = fileList.filter((item) => item.status === 'done' && item.resultBlob);
    if (doneItems.length === 0) return;

    setOverallStatusText(lang === 'ja' ? 'ZIPアーカイブを作成中...' : 'Creating ZIP package...');
    try {
      const entries = doneItems.map((item) => ({
        name: item.resultName || item.name,
        content: item.resultBlob!,
      }));
      const zipBlob = await createZipArchive(entries);
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `converted_files_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setOverallStatusText(lang === 'ja' ? 'ZIPダウンロードを開始しました' : 'ZIP Download Started!');
    } catch (e: any) {
      console.error('ZIP Error:', e);
    }
  };

  const doneCount = fileList.filter((f) => f.status === 'done').length;

  return (
    <div className="w-full flex flex-col gap-5">
      {/* 2. Target, Format, Options Card */}
      <div className="card">
        <label>{lang === 'ja' ? '2. 変換処理する対象ファイルを選択:' : '2. Select Target Files:'}</label>
        <select
          id="convertTargetSelect"
          value={selectedTargetId}
          onChange={(e) => {
            const val = e.target.value;
            if (val.startsWith('pick_hist_')) {
              const histId = val.replace('pick_hist_', '');
              const histFound = historyFiles.find((h) => h.id === histId);
              if (histFound) handleAddFromHistory(histFound);
            } else {
              setSelectedTargetId(val);
            }
          }}
          className="main-select"
        >
          <option value="all">
            {lang === 'ja' ? '-- 読み込んだ全てのファイルを一括変換 --' : '-- Convert All Loaded Files --'}
          </option>
          {fileList.length > 0 && (
            <optgroup label={lang === 'ja' ? '【読み込み中のファイル】' : '【Loaded Files】'}>
              {fileList.map((f) => (
                <option key={f.id} value={f.id}>
                  [{f.status === 'done' ? (lang === 'ja' ? '完了' : 'Done') : (lang === 'ja' ? '待機中' : 'Pending')}] {f.name}
                </option>
              ))}
            </optgroup>
          )}
          {historyFiles.length > 0 && (
            <optgroup label={lang === 'ja' ? '【過去の処理ファイル・履歴から追加して変換】' : '【From Past History Storage】'}>
              {historyFiles.map((h) => (
                <option key={`hist_${h.id}`} value={`pick_hist_${h.id}`}>
                  [履歴] {h.fileName} (.{h.format})
                </option>
              ))}
            </optgroup>
          )}
        </select>

        <label>{lang === 'ja' ? '3. 変換後の出力形式を選択:' : '3. Select Output Format:'}</label>
        <select
          id="outputFormat"
          value={selectedGlobalFormat}
          onChange={(e) => setSelectedGlobalFormat(e.target.value as DocumentFormat)}
          className="main-select"
        >
          <optgroup label={lang === 'ja' ? 'ドキュメント・PDF' : 'Documents & PDF'}>
            <option value="pdf">PDF (.pdf) - 汎用高精度PDF</option>
            <option value="docx">DOCX (.docx) - Microsoft Word 文書</option>
            <option value="txt">TXT (.txt) - プレーンテキスト</option>
            <option value="md">Markdown (.md) - マークダウン形式</option>
            <option value="html">HTML (.html) - ウェブページ形式</option>
          </optgroup>
          <optgroup label={lang === 'ja' ? '表計算・データ' : 'Spreadsheets & Data'}>
            <option value="xlsx">XLSX (.xlsx) - Excel ワークブック</option>
            <option value="csv">CSV (.csv) - カンマ区切りテキスト</option>
            <option value="tsv">TSV (.tsv) - タブ区切りテキスト</option>
            <option value="json">JSON (.json) - 構造化データ</option>
          </optgroup>
          <optgroup label={lang === 'ja' ? '画像フォーマット' : 'Images'}>
            <option value="png">PNG (.png) - 可逆圧縮高画質画像</option>
            <option value="jpg">JPG (.jpg) - 高圧縮写真画像</option>
            <option value="webp">WebP (.webp) - 高効率Web画像</option>
          </optgroup>
          <optgroup label={lang === 'ja' ? '動画・音声フォーマット' : 'Video & Audio'}>
            <option value="mp4">MP4 (.mp4) - H.264/AAC 高速汎用動画</option>
            <option value="webm">WebM (.webm) - VP8/Vorbis Web向け形式</option>
            <option value="mp3">MP3 (.mp3) - 標準音声</option>
            <option value="wav">WAV (.wav) - 高音質非圧縮</option>
          </optgroup>
          <optgroup label={lang === 'ja' ? 'アーカイブ' : 'Archive'}>
            <option value="zip">ZIP (.zip) - 圧縮アーカイブ</option>
          </optgroup>
        </select>

        <label>{lang === 'ja' ? '4. 変換オプション:' : '4. Conversion Options:'}</label>
        <div className="converter-settings">
          <div className="setting-section">
            <div className="label-row">
              <span className="label-text">{lang === 'ja' ? 'エンコード・変換品質プリセット:' : 'Quality & Preset:'}</span>
            </div>
            <select
              id="qualityPreset"
              value={qualityPreset}
              onChange={(e) => setQualityPreset(e.target.value as any)}
              className="select-field"
            >
              <option value="fast">{lang === 'ja' ? '高速エンコード (推奨: ultrafast / 低遅延)' : 'Fast (ultrafast / low latency)'}</option>
              <option value="balanced">{lang === 'ja' ? '標準バランス (superfast / バランス)' : 'Balanced (superfast / medium)'}</option>
              <option value="high">{lang === 'ja' ? '高画質・最高品質 (veryfast / 320k)' : 'High Quality (veryfast / high-res)'}</option>
            </select>
          </div>

          <div className="setting-section">
            <div className="label-row">
              <span className="label-text">{lang === 'ja' ? 'ファイル名変更（リネーム）:' : 'Rename Options:'}</span>
            </div>
            <select
              id="renameMode"
              value={renameMode}
              onChange={(e) => setRenameMode(e.target.value as any)}
              className="select-field"
              style={{ marginBottom: '6px' }}
            >
              <option value="none">{lang === 'ja' ? '変更しない (元の名前を維持)' : 'Do Not Rename (Keep Original)'}</option>
              <option value="affix">{lang === 'ja' ? '前後に文字列を追加 (接頭辞 / 接尾辞)' : 'Add Prefix / Suffix'}</option>
              <option value="custom">{lang === 'ja' ? '指定の名前に一括変更 (連番付き)' : 'Batch Rename (Numbered)'}</option>
            </select>

            {renameMode === 'affix' && (
              <div id="renameAffixBox" className="rename-inputs">
                <input
                  type="text"
                  id="renamePrefix"
                  placeholder={lang === 'ja' ? '先頭に付加 (例: converted_)' : 'Prefix (e.g. converted_)'}
                  value={renamePrefix}
                  onChange={(e) => setRenamePrefix(e.target.value)}
                />
                <input
                  type="text"
                  id="renameSuffix"
                  placeholder={lang === 'ja' ? '末尾に付加 (例: _doc)' : 'Suffix (e.g. _doc)'}
                  value={renameSuffix}
                  onChange={(e) => setRenameSuffix(e.target.value)}
                />
              </div>
            )}

            {renameMode === 'custom' && (
              <div id="renameCustomBox" className="rename-inputs">
                <input
                  type="text"
                  id="renameCustomName"
                  placeholder={lang === 'ja' ? 'ファイル名 (例: document)' : 'File Name (e.g. document)'}
                  value={renameCustomName}
                  onChange={(e) => setRenameCustomName(e.target.value)}
                />
                <span style={{ fontSize: '0.8rem', color: 'var(--text-sub)', whiteSpace: 'nowrap' }}>_01, _02...</span>
              </div>
            )}
          </div>

          <div className="setting-section">
            <div className="label-row">
              <span className="label-text">{lang === 'ja' ? '詳細最適化:' : 'Optimization:'}</span>
            </div>
            <label className="checkbox-row" htmlFor="chkCompress">
              <input
                type="checkbox"
                id="chkCompress"
                checked={chkCompress}
                onChange={(e) => setChkCompress(e.target.checked)}
                className="checkbox-field"
              />
              <span className="checkbox-label">
                {lang === 'ja' ? 'ファイルサイズ最適化・余白削除を適用 (自動最適化)' : 'Optimize file size and trim extra whitespace'}
              </span>
            </label>
          </div>
        </div>

        <button
          id="startConversionBtn"
          onClick={handleStartConversion}
          disabled={fileList.length === 0 || isProcessingAll}
          className="btn btn-primary"
        >
          {isProcessingAll ? (
            <>
              <span className="spinner"></span>
              <span>{lang === 'ja' ? '変換処理中...' : 'Processing Conversions...'}</span>
            </>
          ) : (
            <span id="btnText">{lang === 'ja' ? '変換処理を開始する' : 'Start Conversion'}</span>
          )}
        </button>
      </div>

      {/* 3. Status & File List Card */}
      <div className="card">
        <div className="section-title">
          <span>{lang === 'ja' ? '変換・処理ステータス' : 'Conversion Status'}</span>
          <span id="counterLabel" style={{ fontSize: '0.85rem', color: 'var(--text-sub)' }}>
            {doneCount} / {fileList.length}
          </span>
        </div>

        {/* Detailed Progress Bar Section */}
        <div className="progress-section">
          <div className="progress-header">
            <span id="progressStatusText">{overallStatusText}</span>
            <span id="progressPercentText">{overallProgress}%</span>
          </div>
          <div className="progress-bar-bg">
            <div className="progress-bar-fill" id="progressBar" style={{ width: `${overallProgress}%` }}></div>
          </div>
        </div>

        {/* Background Status Bar */}
        <div className="bg-status-bar" id="bgStatusBar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginTop: '12px', padding: '10px 14px', background: 'var(--item-bg)', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '0.8rem', color: 'var(--text-sub)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }}></span>
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
              {lang === 'ja' ? 'ファイルがまだ追加されていません。上の「1. 処理するファイルの読み込み」から追加してください。' : 'No files added yet. Add files from section 1 above.'}
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
                      形式: .{item.format} → .{item.targetFormat} |{' '}
                      <span className="file-status" style={{ fontWeight: item.status === 'done' ? 700 : 500, color: item.status === 'done' ? 'var(--success-color)' : item.status === 'error' ? 'var(--danger-color)' : 'var(--text-sub)' }}>
                        {item.status === 'done' ? (lang === 'ja' ? '完了' : 'Done') : item.status === 'processing' ? (lang === 'ja' ? '処理中' : 'Processing') : item.status === 'error' ? (lang === 'ja' ? 'エラー' : 'Error') : (lang === 'ja' ? '待機中' : 'Pending')}
                      </span>
                    </div>
                  </div>

                  <div className="file-actions">
                    <button
                      onClick={() => onPreview(item)}
                      className="btn-sm"
                    >
                      {lang === 'ja' ? 'プレビュー' : 'Preview'}
                    </button>

                    <button
                      onClick={() => handleDownload(item)}
                      disabled={item.status !== 'done'}
                      className="btn-sm btn-success"
                    >
                      {lang === 'ja' ? '保存' : 'Save'}
                    </button>

                    <button
                      onClick={() => onSaveToDrive(item)}
                      disabled={item.status !== 'done'}
                      className="btn-sm"
                      style={{ background: '#0284c7', color: '#fff', border: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                      title="Google Driveに保存"
                    >
                      <HardDrive className="w-3 h-3" />
                      <span>Drive</span>
                    </button>

                    <button
                      onClick={() => removeItem(item.id)}
                      className="btn-sm btn-danger"
                    >
                      {lang === 'ja' ? '削除' : 'Delete'}
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div style={{ display: 'flex', gap: '10px', marginTop: '16px', flexWrap: 'wrap' }}>
          <button
            id="downloadAllBtn"
            onClick={handleDownloadAllZip}
            disabled={doneCount === 0}
            className="btn"
            style={{ flex: 1, minWidth: '200px', marginTop: 0 }}
          >
            {lang === 'ja' ? '変換済みファイルを一括ZIPダウンロード' : 'Download All Converted Files as ZIP'}
          </button>

          <button
            id="saveAllToDriveBtn"
            onClick={async () => {
              const doneItems = fileList.filter((item) => item.status === 'done' && item.resultBlob);
              if (doneItems.length === 0) return;
              for (const item of doneItems) {
                await onSaveToDrive(item);
              }
            }}
            disabled={doneCount === 0}
            className="btn btn-drive-action"
            style={{ flex: 1, minWidth: '200px', marginTop: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
          >
            <HardDrive className="w-4 h-4" />
            <span id="saveAllToDriveBtnText">{lang === 'ja' ? 'Google Driveへ一括保存' : 'Save All to Google Drive'}</span>
          </button>
        </div>

        <div className="card-footer">
          <button id="clearListBtn" onClick={clearAll} className="clear-link">
            {lang === 'ja' ? 'リストを一括クリア' : 'Clear List'}
          </button>
          <button id="clearCacheBtn" onClick={clearAll} className="clear-link">
            {lang === 'ja' ? 'キャッシュを消去' : 'Clear Cache'}
          </button>
        </div>
      </div>
    </div>
  );
};
