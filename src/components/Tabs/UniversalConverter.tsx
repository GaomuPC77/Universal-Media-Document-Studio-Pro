import React, { useState, useEffect } from 'react';
import {
  FileText,
  Download,
  Settings,
  RefreshCw,
  Layers,
  ArrowRightLeft,
} from 'lucide-react';
import { FileItem, DocumentFormat } from '../../types';
import { extractPdfText, convertPdfToImages, imagesToPdf } from '../../utils/pdfUtils';
import {
  docxToHtml,
  docxToText,
  createDocxFromText,
  parseSpreadsheet,
  exportSpreadsheet,
  textToPdf,
  spreadsheetToPdf,
  pdfToDocx,
  pdfToXlsx,
  pdfToPptx,
  pdfToCsv,
} from '../../utils/officeUtils';
import { createZipArchive } from '../../utils/zipUtils';
import { saveProcessedFile } from '../../utils/historyDb';
import { notifyCompletion } from '../../utils/notification';

interface UniversalConverterProps {
  lang: 'ja' | 'en';
  fileList: FileItem[];
  setFileList: React.Dispatch<React.SetStateAction<FileItem[]>>;
  onAddFiles: (files: FileList | File[]) => void;
  onPreview: (item: FileItem) => void;
  onSaveToDrive: (item: FileItem) => void;
  onOpenDrivePicker?: () => void;
  onOpenHistory?: () => void;
  onProgressUpdate?: (percent: number, statusText: string) => void;
}

export const UniversalConverter: React.FC<UniversalConverterProps> = ({
  lang,
  fileList,
  setFileList,
  onProgressUpdate,
}) => {
  const [isProcessingAll, setIsProcessingAll] = useState(false);
  const [selectedTargetId, setSelectedTargetId] = useState<string>('all');
  const [selectedGlobalFormat, setSelectedGlobalFormat] = useState<DocumentFormat>('pdf');
  const [qualityPreset, setQualityPreset] = useState<'fast' | 'balanced' | 'high'>('fast');
  const [renameMode, setRenameMode] = useState<'none' | 'affix' | 'custom'>('none');
  const [renamePrefix, setRenamePrefix] = useState<string>('');
  const [renameSuffix, setRenameSuffix] = useState<string>('');
  const [renameCustomName, setRenameCustomName] = useState<string>('');
  const [chkCompress, setChkCompress] = useState<boolean>(true);

  // Core Conversion Engine for a single item
  const processItem = async (item: FileItem): Promise<FileItem> => {
    if (!item.file) {
      return { ...item, status: 'error', error: 'File object missing' };
    }

    const { format, targetFormat, file, name } = item;
    const baseName = name.substring(0, name.lastIndexOf('.')) || name;

    try {
      let resultBlob: Blob | undefined;
      let resultName = `${baseName}.${targetFormat}`;

      // PDF Input conversions
      if (format === 'pdf') {
        if (targetFormat === 'docx') {
          resultBlob = await pdfToDocx(file, { title: baseName });
        } else if (targetFormat === 'xlsx' || targetFormat === 'xls') {
          resultBlob = await pdfToXlsx(file, baseName);
        } else if (targetFormat === 'pptx' || targetFormat === 'ppt') {
          resultBlob = await pdfToPptx(file, { title: baseName });
        } else if (targetFormat === 'csv' || targetFormat === 'tsv') {
          resultBlob = await pdfToCsv(file);
        } else if (targetFormat === 'txt') {
          const text = await extractPdfText(file);
          resultBlob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        } else if (targetFormat === 'html') {
          const text = await extractPdfText(file);
          const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${baseName}</title></head><body><pre style="white-space:pre-wrap;font-family:sans-serif;padding:24px;line-height:1.7;">${text}</pre></body></html>`;
          resultBlob = new Blob([html], { type: 'text/html;charset=utf-8' });
        } else if (targetFormat === 'md') {
          const text = await extractPdfText(file);
          resultBlob = new Blob([`# ${baseName}\n\n${text}`], { type: 'text/markdown;charset=utf-8' });
        } else if (['png', 'jpg', 'jpeg', 'webp'].includes(targetFormat)) {
          const images = await convertPdfToImages(file, { format: targetFormat as any });
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
        } else {
          resultBlob = file;
        }
      } else if (format === 'docx' && targetFormat === 'pdf') {
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
        resultBlob = exportSpreadsheet(firstSheet, targetFormat as any);
      } else if ((format === 'csv' || format === 'tsv') && (targetFormat === 'xlsx' || targetFormat === 'xls')) {
        const data = await parseSpreadsheet(file);
        const firstSheet = data.sheets[data.sheetNames[0]] || [];
        resultBlob = exportSpreadsheet(firstSheet, 'xlsx');
      } else if ((format === 'csv' || format === 'tsv') && targetFormat === 'pdf') {
        const data = await parseSpreadsheet(file);
        const firstSheet = data.sheets[data.sheetNames[0]] || [];
        const pdfBytes = await spreadsheetToPdf(firstSheet, baseName);
        resultBlob = new Blob([pdfBytes], { type: 'application/pdf' });
      } else if (['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(format) && targetFormat === 'pdf') {
        const fileBuf = await file.arrayBuffer();
        const pdfBytes = await imagesToPdf(
          [{ name: file.name, data: fileBuf, type: file.type || 'image/png' }],
          { pageSize: 'A4', orientation: 'auto', margin: 20 }
        );
        resultBlob = new Blob([pdfBytes], { type: 'application/pdf' });
      } else if (targetFormat === 'zip') {
        resultBlob = await createZipArchive([{ name: file.name, content: file }]);
        resultName = `${baseName}.zip`;
      } else {
        const text = await file.text();
        if (targetFormat === 'pdf') {
          const pdfBytes = await textToPdf(text, { title: baseName });
          resultBlob = new Blob([pdfBytes], { type: 'application/pdf' });
        } else if (targetFormat === 'docx') {
          resultBlob = await createDocxFromText(text, { title: baseName });
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
    if (onProgressUpdate) onProgressUpdate(5, lang === 'ja' ? '変換処理中...' : 'Processing...');

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
      if (onProgressUpdate) {
        onProgressUpdate(pct, lang === 'ja' ? `変換中 (${completed}/${total}): ${pct}%` : `Converting (${completed}/${total}): ${pct}%`);
      }
      setFileList([...updatedList]);
    }

    if (onProgressUpdate) {
      onProgressUpdate(100, lang === 'ja' ? 'すべての変換が完了しました！' : 'All conversions completed!');
    }
    setIsProcessingAll(false);

    // Trigger completion notification and sound chime
    notifyCompletion(
      lang === 'ja' ? '変換が完了しました！' : 'Conversion Completed!',
      lang === 'ja'
        ? `全 ${total} 件のファイル変換が正常に完了しました。`
        : `Successfully converted ${total} files.`
    );
  };

  return (
    <div className="w-full flex flex-col gap-4">
      {/* 2. Conversion Options Card */}
      <div className="card">
        {/* Target Select */}
        <label htmlFor="convertTargetSelect">
          {lang === 'ja' ? '2. 変換処理する対象ファイルを選択:' : '2. Select Target Files to Convert:'}
        </label>
        <select
          id="convertTargetSelect"
          value={selectedTargetId}
          onChange={(e) => setSelectedTargetId(e.target.value)}
          className="main-select"
        >
          <option value="all">
            {lang === 'ja' ? '-- 読み込んだすべてのファイルを一括変換 --' : '-- Convert All Loaded Files in Batch --'}
          </option>
          {fileList.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} (.{f.format})
            </option>
          ))}
        </select>

        {/* Output Format Select */}
        <label htmlFor="outputFormat">
          {lang === 'ja' ? '3. 変換後の出力形式を選択:' : '3. Select Target Output Format:'}
        </label>
        <select
          id="outputFormat"
          value={selectedGlobalFormat}
          onChange={(e) => setSelectedGlobalFormat(e.target.value as DocumentFormat)}
          className="main-select"
        >
          <optgroup label={lang === 'ja' ? 'ドキュメント・Office形式' : 'Document & Office Formats'}>
            <option value="pdf">PDF (.pdf) - 汎用ドキュメント形式</option>
            <option value="docx">Word (.docx) - Microsoft Word 文書</option>
            <option value="xlsx">Excel (.xlsx) - スプレッドシート</option>
            <option value="pptx">PowerPoint (.pptx) - プレゼンテーション</option>
            <option value="csv">CSV (.csv) - カンマ区切りテキスト</option>
            <option value="txt">Text (.txt) - プレーンテキスト</option>
            <option value="md">Markdown (.md) - マークダウン文書</option>
            <option value="html">HTML (.html) - Webページ</option>
          </optgroup>
          <optgroup label={lang === 'ja' ? '画像フォーマット' : 'Image Formats'}>
            <option value="png">PNG (.png) - 高画質透過画像</option>
            <option value="jpg">JPG (.jpg) - 高圧縮写真画像</option>
            <option value="webp">WebP (.webp) - 高効率Web画像</option>
          </optgroup>
          <optgroup label={lang === 'ja' ? 'メディア・アーカイブ' : 'Media & Archive'}>
            <option value="mp4">MP4 (.mp4) - 高互換動画</option>
            <option value="mp3">MP3 (.mp3) - 標準音声</option>
            <option value="zip">ZIP (.zip) - アーカイブ一括圧縮</option>
          </optgroup>
        </select>

        {/* Options Box */}
        <label>{lang === 'ja' ? '4. 変換オプション:' : '4. Conversion Options:'}</label>
        <div className="converter-settings">
          <div className="setting-section">
            <div className="label-row">
              <span className="label-text">{lang === 'ja' ? 'エンコード品質・プリセット:' : 'Quality Preset:'}</span>
            </div>
            <select
              id="qualityPreset"
              value={qualityPreset}
              onChange={(e) => setQualityPreset(e.target.value as any)}
              className="select-field"
            >
              <option value="fast">{lang === 'ja' ? '高速処理 (推奨)' : 'Fast (Recommended)'}</option>
              <option value="balanced">{lang === 'ja' ? '標準バランス' : 'Standard Balanced'}</option>
              <option value="high">{lang === 'ja' ? '高画質・最高品質' : 'High Quality'}</option>
            </select>
          </div>

          <div className="setting-section">
            <div className="label-row">
              <span className="label-text">{lang === 'ja' ? 'ファイル名変更（リネーム）:' : 'File Renaming:'}</span>
            </div>
            <select
              id="renameMode"
              value={renameMode}
              onChange={(e) => setRenameMode(e.target.value as any)}
              className="select-field"
              style={{ marginBottom: '6px' }}
            >
              <option value="none">{lang === 'ja' ? '変更しない (元の名前を維持)' : 'Keep original name'}</option>
              <option value="affix">{lang === 'ja' ? '前後に文字列を追加 (接頭辞 / 接尾辞)' : 'Add Prefix / Suffix'}</option>
              <option value="custom">{lang === 'ja' ? '指定の名前に一括変更 (連番付き)' : 'Batch custom name with numbering'}</option>
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
              <RefreshCw className="w-4 h-4 animate-spin inline mr-1.5" />
              <span>{lang === 'ja' ? '変換処理中...' : 'Processing Conversions...'}</span>
            </>
          ) : (
            <span id="btnText">{lang === 'ja' ? '変換処理を開始する' : 'Start Conversion'}</span>
          )}
        </button>
      </div>
    </div>
  );
};
