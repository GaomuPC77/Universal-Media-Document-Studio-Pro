import React, { useState, useRef, useEffect } from 'react';
import {
  Briefcase,
  FileText,
  Table as TableIcon,
  Upload,
  Download,
  Eye,
  RefreshCw,
  ArrowRightLeft,
  CheckCircle2,
  FileSpreadsheet,
  FileCode,
  Check,
} from 'lucide-react';
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
import { extractPdfText } from '../../utils/pdfUtils';
import { saveProcessedFile } from '../../utils/historyDb';
import { FileItem } from '../../types';
import { notifyCompletion } from '../../utils/notification';
import { AddToQueuePromptModal } from '../Modals/AddToQueuePromptModal';

interface OfficeSuiteProps {
  lang: 'ja' | 'en';
  fileList?: FileItem[];
  sharedFile?: File | null;
  onResultReady?: (item: FileItem) => void;
  onShowToast?: (msg: string) => void;
  onAddFiles?: (files: File[]) => void;
}

export const OfficeSuite: React.FC<OfficeSuiteProps> = ({
  lang,
  fileList = [],
  sharedFile,
  onResultReady,
  onShowToast,
  onAddFiles,
}) => {
  const [activeTool, setActiveTool] = useState<'word-pdf' | 'excel-pdf' | 'pdf-office' | 'text-docx'>('pdf-office');
  const [pendingPromptFile, setPendingPromptFile] = useState<{ file: File; type: 'word' | 'excel' | 'pdf' } | null>(null);

  // Word <-> PDF state
  const [selectedWordFileId, setSelectedWordFileId] = useState<string>('');
  const [wordFile, setWordFile] = useState<File | null>(null);
  const [wordPreviewHtml, setWordPreviewHtml] = useState<string>('');
  const [isProcessingWord, setIsProcessingWord] = useState(false);

  // Excel <-> PDF state
  const [selectedExcelFileId, setSelectedExcelFileId] = useState<string>('');
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [excelSheets, setExcelSheets] = useState<{ [name: string]: any[][] }>({});
  const [activeSheet, setActiveSheet] = useState<string>('');
  const [isProcessingExcel, setIsProcessingExcel] = useState(false);

  // PDF -> Office state
  const [selectedPdfFileId, setSelectedPdfFileId] = useState<string>('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfTargetFormat, setPdfTargetFormat] = useState<'docx' | 'xlsx' | 'pptx' | 'csv' | 'txt'>('docx');
  const [isProcessingPdfToOffice, setIsProcessingPdfToOffice] = useState(false);

  // Text/MD -> Word DOCX
  const [markdownInput, setMarkdownInput] = useState<string>(
    `# 業務報告書 (Business Report)\n\n## 1. 概要\n本書はOfficeドキュメント変換スタジオで生成された文書です。\n\n## 2. 主要実績\n- PDFとOfficeドキュメントの高精度な相互変換\n- サーバー通信ゼロ・完全端末内ローカル処理\n- 高速なブラウザ内レンダリング\n\n## 3. まとめ\n今後も機能拡張を継続してまいります。`
  );
  const [isGeneratingDocx, setIsGeneratingDocx] = useState(false);

  // Auto load shared file or uploaded files
  useEffect(() => {
    if (sharedFile) {
      const ext = sharedFile.name.split('.').pop()?.toLowerCase();
      if (ext === 'docx') {
        setActiveTool('word-pdf');
        handleSelectWord(sharedFile);
      } else if (['xlsx', 'xls', 'csv'].includes(ext || '')) {
        setActiveTool('excel-pdf');
        handleSelectExcel(sharedFile);
      } else if (ext === 'pdf') {
        setActiveTool('pdf-office');
        setPdfFile(sharedFile);
      }
    } else if (fileList.length > 0) {
      // Auto select matching files if none selected yet
      if (!pdfFile) {
        const foundPdf = fileList.find((f) => f.format === 'pdf' && f.file);
        if (foundPdf && foundPdf.file) {
          setSelectedPdfFileId(foundPdf.id);
          setPdfFile(foundPdf.file);
        }
      }
      if (!wordFile) {
        const foundWord = fileList.find((f) => f.format === 'docx' && f.file);
        if (foundWord && foundWord.file) {
          setSelectedWordFileId(foundWord.id);
          handleSelectWord(foundWord.file);
        }
      }
      if (!excelFile) {
        const foundExcel = fileList.find((f) => ['xlsx', 'xls', 'csv'].includes(f.format) && f.file);
        if (foundExcel && foundExcel.file) {
          setSelectedExcelFileId(foundExcel.id);
          handleSelectExcel(foundExcel.file);
        }
      }
    }
  }, [sharedFile, fileList]);

  // Handle Word file selection
  const handleSelectWord = async (file: File) => {
    setWordFile(file);
    setIsProcessingWord(true);
    try {
      const html = await docxToHtml(file);
      setWordPreviewHtml(html);
    } catch (e) {
      console.error('Failed to parse docx:', e);
    } finally {
      setIsProcessingWord(false);
    }
  };

  // Convert DOCX to PDF
  const handleWordToPdf = async () => {
    if (!wordFile) return;
    setIsProcessingWord(true);
    try {
      const text = await docxToText(wordFile);
      const baseName = wordFile.name.replace(/\.docx$/i, '');
      const pdfBytes = await textToPdf(text, { title: baseName });
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const resultName = `${baseName}.pdf`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = resultName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      await saveProcessedFile(`office_${Date.now()}`, wordFile.name, resultName, blob, 'pdf');

      if (onResultReady) {
        onResultReady({
          id: `res_word_${Date.now()}`,
          name: resultName,
          file: new File([blob], resultName, { type: 'application/pdf' }),
          size: blob.size,
          type: 'application/pdf',
          format: 'pdf',
          targetFormat: 'pdf',
          status: 'done',
          progress: 100,
          resultBlob: blob,
          resultName,
        });
      }

      notifyCompletion(lang === 'ja' ? 'WordからPDFへの変換が完了しました' : 'Word to PDF Converted', resultName);
      if (onShowToast) onShowToast(lang === 'ja' ? `「${resultName}」を作成しました` : `Created "${resultName}"`);
    } catch (e: any) {
      console.error('Word to PDF failed:', e);
      alert(lang === 'ja' ? 'WordからPDFへの変換に失敗しました: ' + e.message : 'Word to PDF failed');
    } finally {
      setIsProcessingWord(false);
    }
  };

  // Handle Excel file selection
  const handleSelectExcel = async (file: File) => {
    setExcelFile(file);
    setIsProcessingExcel(true);
    try {
      const parsed = await parseSpreadsheet(file);
      setExcelSheets(parsed.sheets);
      if (parsed.sheetNames.length > 0) {
        setActiveSheet(parsed.sheetNames[0]);
      }
    } catch (e) {
      console.error('Failed to parse spreadsheet:', e);
    } finally {
      setIsProcessingExcel(false);
    }
  };

  // Convert Excel / CSV to PDF
  const handleExcelToPdf = async () => {
    if (!excelFile || !activeSheet || !excelSheets[activeSheet]) return;
    setIsProcessingExcel(true);
    try {
      const data = excelSheets[activeSheet];
      const baseName = excelFile.name.substring(0, excelFile.name.lastIndexOf('.')) || excelFile.name;
      const pdfBytes = await spreadsheetToPdf(data, `${baseName} - ${activeSheet}`);
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const resultName = `${baseName}_${activeSheet}.pdf`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = resultName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      await saveProcessedFile(`office_${Date.now()}`, excelFile.name, resultName, blob, 'pdf');

      if (onResultReady) {
        onResultReady({
          id: `res_excel_${Date.now()}`,
          name: resultName,
          file: new File([blob], resultName, { type: 'application/pdf' }),
          size: blob.size,
          type: 'application/pdf',
          format: 'pdf',
          targetFormat: 'pdf',
          status: 'done',
          progress: 100,
          resultBlob: blob,
          resultName,
        });
      }

      notifyCompletion(lang === 'ja' ? 'ExcelからPDFへの変換が完了しました' : 'Excel to PDF Converted', resultName);
      if (onShowToast) onShowToast(lang === 'ja' ? `「${resultName}」を作成しました` : `Created "${resultName}"`);
    } catch (e: any) {
      console.error('Excel to PDF failed:', e);
      alert(lang === 'ja' ? 'ExcelからPDFへの変換に失敗しました: ' + e.message : 'Excel to PDF failed');
    } finally {
      setIsProcessingExcel(false);
    }
  };

  // Convert PDF to Office formats (DOCX, XLSX, CSV, TXT)
  const handlePdfToOffice = async () => {
    if (!pdfFile) {
      if (onShowToast) onShowToast(lang === 'ja' ? 'PDFファイルを選択してください' : 'Please select a PDF file');
      return;
    }

    setIsProcessingPdfToOffice(true);
    const baseName = pdfFile.name.replace(/\.pdf$/i, '') || 'document';
    const resultName = `${baseName}.${pdfTargetFormat}`;

    try {
      let resultBlob: Blob;

      if (pdfTargetFormat === 'docx') {
        resultBlob = await pdfToDocx(pdfFile, { title: baseName });
      } else if (pdfTargetFormat === 'xlsx') {
        resultBlob = await pdfToXlsx(pdfFile, baseName);
      } else if (pdfTargetFormat === 'pptx') {
        resultBlob = await pdfToPptx(pdfFile, { title: baseName });
      } else if (pdfTargetFormat === 'csv') {
        resultBlob = await pdfToCsv(pdfFile);
      } else {
        const text = await extractPdfText(pdfFile);
        resultBlob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      }

      // Download
      const url = URL.createObjectURL(resultBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = resultName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Save to history
      await saveProcessedFile(`pdf_office_${Date.now()}`, pdfFile.name, resultName, resultBlob, pdfTargetFormat);

      // Add to main file list
      if (onResultReady) {
        onResultReady({
          id: `res_pdfoffice_${Date.now()}`,
          name: resultName,
          file: new File([resultBlob], resultName, { type: resultBlob.type }),
          size: resultBlob.size,
          type: resultBlob.type,
          format: pdfTargetFormat as any,
          targetFormat: pdfTargetFormat as any,
          status: 'done',
          progress: 100,
          resultBlob,
          resultName,
        });
      }

      notifyCompletion(
        lang === 'ja' ? 'PDFからOffice形式への変換が完了しました' : 'PDF to Office Converted',
        resultName
      );
      if (onShowToast) {
        onShowToast(lang === 'ja' ? `「${resultName}」を作成・保存しました` : `Created and saved "${resultName}"`);
      }
    } catch (e: any) {
      console.error('PDF to Office conversion failed:', e);
      alert(lang === 'ja' ? 'PDFからOfficeファイルへの変換に失敗しました: ' + e.message : 'PDF to Office failed: ' + e.message);
    } finally {
      setIsProcessingPdfToOffice(false);
    }
  };

  // Generate DOCX from Markdown input
  const handleGenerateDocxFromMd = async () => {
    setIsGeneratingDocx(true);
    const resultName = `Document_${new Date().toISOString().slice(0, 10)}.docx`;
    try {
      const blob = await createDocxFromText(markdownInput, { title: 'Exported Document' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = resultName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      await saveProcessedFile(`md_docx_${Date.now()}`, 'markdown_input', resultName, blob, 'docx');

      if (onResultReady) {
        onResultReady({
          id: `res_mddocx_${Date.now()}`,
          name: resultName,
          file: new File([blob], resultName, { type: blob.type }),
          size: blob.size,
          type: blob.type,
          format: 'docx',
          targetFormat: 'docx',
          status: 'done',
          progress: 100,
          resultBlob: blob,
          resultName,
        });
      }

      notifyCompletion(lang === 'ja' ? 'Word文書の作成が完了しました' : 'Word Document Created', resultName);
      if (onShowToast) onShowToast(lang === 'ja' ? `「${resultName}」を作成しました` : `Created "${resultName}"`);
    } catch (e: any) {
      console.error('Docx generation failed:', e);
      alert(lang === 'ja' ? 'Word作成に失敗しました: ' + e.message : 'Word generation failed');
    } finally {
      setIsGeneratingDocx(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* Add To Queue Confirmation Modal */}
      <AddToQueuePromptModal
        file={pendingPromptFile?.file || null}
        isOpen={!!pendingPromptFile}
        lang={lang}
        onConfirmAddToQueue={() => {
          if (!pendingPromptFile) return;
          const { file, type } = pendingPromptFile;
          if (onAddFiles) {
            onAddFiles([file]);
          } else if (onResultReady) {
            const ext = file.name.split('.').pop()?.toLowerCase() || 'docx';
            onResultReady({
              id: `file_${Date.now()}`,
              name: file.name,
              size: file.size,
              type: file.type,
              format: ext as any,
              targetFormat: ext === 'pdf' ? 'docx' : 'pdf',
              status: 'idle',
              progress: 0,
              file,
            });
          }
          if (type === 'word') {
            handleSelectWord(file);
          } else if (type === 'excel') {
            handleSelectExcel(file);
          } else {
            setPdfFile(file);
          }
          if (onShowToast) {
            onShowToast(lang === 'ja' ? '変換・処理ステータス（全体キュー）に追加しました' : 'Added to global status queue');
          }
          setPendingPromptFile(null);
        }}
        onUseLocalOnly={() => {
          if (!pendingPromptFile) return;
          const { file, type } = pendingPromptFile;
          if (type === 'word') {
            handleSelectWord(file);
          } else if (type === 'excel') {
            handleSelectExcel(file);
          } else {
            setPdfFile(file);
          }
          if (onShowToast) {
            onShowToast(lang === 'ja' ? 'このタブのみに読み込みました' : 'Loaded into this tab only');
          }
          setPendingPromptFile(null);
        }}
      />

      {/* Sub Tabs Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
        {[
          { id: 'pdf-office', labelJa: 'PDF → Word / Excel', labelEn: 'PDF → Office', icon: ArrowRightLeft },
          { id: 'word-pdf', labelJa: 'Word (.docx) ⇔ PDF', labelEn: 'Word ⇔ PDF', icon: FileText },
          { id: 'excel-pdf', labelJa: 'Excel / CSV ⇔ PDF', labelEn: 'Excel / CSV ⇔ PDF', icon: TableIcon },
          { id: 'text-docx', labelJa: 'Markdown → Word作成', labelEn: 'Markdown to Word', icon: FileCode },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTool === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTool(tab.id as any)}
              className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold transition ${
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

      {/* 1. PDF -> Office (Word / Excel / CSV / TXT) */}
      {activeTool === 'pdf-office' && (
        <div className="card flex flex-col gap-4">
          <div className="section-title">
            <span className="flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-blue-600" />
              <span>{lang === 'ja' ? 'PDFからWord / Excel / CSV形式へ変換' : 'PDF to Word / Excel / CSV Conversion'}</span>
            </span>
          </div>

          <p className="text-xs text-slate-500">
            {lang === 'ja'
              ? '読み込んだPDFファイルのテキストおよび表組（テーブル構造）を解析し、編集可能なMicrosoft Word (.docx) や Excel (.xlsx) / CSV に変換します。'
              : 'Extract and convert text and tabular data from PDF into editable Word (.docx) and Excel (.xlsx) files.'}
          </p>

          {/* Select Loaded PDF */}
          <div>
            <label>{lang === 'ja' ? '変換対象のPDFファイルを選択:' : 'Select Target PDF File:'}</label>
            <select
              value={selectedPdfFileId}
              onChange={(e) => {
                const id = e.target.value;
                setSelectedPdfFileId(id);
                const found = fileList.find((f) => f.id === id);
                if (found && found.file) {
                  setPdfFile(found.file);
                }
              }}
              className="main-select"
            >
              <option value="">{lang === 'ja' ? '-- アップロードされたPDFを選択 --' : '-- Select Loaded PDF --'}</option>
              {fileList
                .filter((f) => f.format === 'pdf' || f.name.toLowerCase().endsWith('.pdf'))
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({(f.size / 1024).toFixed(1)} KB)
                  </option>
                ))}
            </select>
          </div>

          {/* Target Format Selector */}
          <div>
            <label>{lang === 'ja' ? '出力Officeフォーマットを選択:' : 'Select Target Office Format:'}</label>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {[
                { id: 'docx', label: 'Word (.docx)', icon: FileText, desc: '編集可能なWord文書' },
                { id: 'xlsx', label: 'Excel (.xlsx)', icon: FileSpreadsheet, desc: '表組みスプレッドシート' },
                { id: 'pptx', label: 'PowerPoint (.pptx)', icon: Briefcase, desc: 'スライドプレゼンテーション' },
                { id: 'csv', label: 'CSV (.csv)', icon: TableIcon, desc: 'カンマ区切りデータ' },
                { id: 'txt', label: 'Text (.txt)', icon: FileCode, desc: 'プレーンテキスト' },
              ].map((fmt) => (
                <button
                  key={fmt.id}
                  onClick={() => setPdfTargetFormat(fmt.id as any)}
                  className={`p-3 rounded-xl border text-left flex flex-col gap-1 transition ${
                    pdfTargetFormat === fmt.id
                      ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 ring-2 ring-blue-500/20'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <fmt.icon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    {pdfTargetFormat === fmt.id && <Check className="w-3.5 h-3.5 text-blue-600" />}
                  </div>
                  <div className="font-bold text-xs">{fmt.label}</div>
                  <div className="text-[11px] text-slate-400">{fmt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Action Button */}
          <button
            onClick={handlePdfToOffice}
            disabled={!pdfFile || isProcessingPdfToOffice}
            className="btn btn-primary flex items-center justify-center gap-2 py-3 mt-2"
          >
            {isProcessingPdfToOffice ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>{lang === 'ja' ? '変換処理中...' : 'Converting PDF...'}</span>
              </>
            ) : (
              <>
                <ArrowRightLeft className="w-4 h-4" />
                <span>
                  {lang === 'ja'
                    ? `PDFから ${pdfTargetFormat.toUpperCase()} への変換を実行`
                    : `Convert PDF to ${pdfTargetFormat.toUpperCase()}`}
                </span>
              </>
            )}
          </button>
        </div>
      )}

      {/* 2. Word <-> PDF */}
      {activeTool === 'word-pdf' && (
        <div className="card flex flex-col gap-4">
          <div className="section-title">
            <span className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-blue-600" />
              <span>{lang === 'ja' ? 'Word (.docx) ⇔ PDF 相互変換' : 'Word (.docx) ⇔ PDF Conversion'}</span>
            </span>
          </div>

          <div>
            <label>{lang === 'ja' ? '対象のWord / PDFファイルを選択:' : 'Select Target Word or PDF File:'}</label>
            <select
              value={selectedWordFileId}
              onChange={(e) => {
                const id = e.target.value;
                setSelectedWordFileId(id);
                const found = fileList.find((f) => f.id === id);
                if (found && found.file) {
                  handleSelectWord(found.file);
                }
              }}
              className="main-select"
            >
              <option value="">{lang === 'ja' ? '-- アップロードされたWord/PDFを選択 --' : '-- Select Word/PDF --'}</option>
              {fileList
                .filter((f) => ['docx', 'pdf'].includes(f.format) || f.name.toLowerCase().endsWith('.docx'))
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({(f.size / 1024).toFixed(1)} KB)
                  </option>
                ))}
            </select>
          </div>

          {wordPreviewHtml && (
            <div className="p-4 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 max-h-60 overflow-auto text-xs leading-relaxed">
              <div className="font-bold text-slate-500 mb-2">{lang === 'ja' ? 'Word文書プレビュー:' : 'Word Document Preview:'}</div>
              <div dangerouslySetInnerHTML={{ __html: wordPreviewHtml }} />
            </div>
          )}

          <button
            onClick={handleWordToPdf}
            disabled={!wordFile || isProcessingWord}
            className="btn btn-primary flex items-center justify-center gap-2 py-3 mt-2"
          >
            {isProcessingWord ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>{lang === 'ja' ? 'PDFを生成中...' : 'Generating PDF...'}</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>{lang === 'ja' ? 'WordからPDFに変換して保存' : 'Convert Word to PDF'}</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* 3. Excel <-> PDF */}
      {activeTool === 'excel-pdf' && (
        <div className="card flex flex-col gap-4">
          <div className="section-title">
            <span className="flex items-center gap-2">
              <TableIcon className="w-4 h-4 text-emerald-600" />
              <span>{lang === 'ja' ? 'Excel / CSV ⇔ PDF 相互変換' : 'Excel / CSV ⇔ PDF Conversion'}</span>
            </span>
          </div>

          <div>
            <label>{lang === 'ja' ? '対象のスプレッドシートファイルを選択:' : 'Select Target Spreadsheet:'}</label>
            <select
              value={selectedExcelFileId}
              onChange={(e) => {
                const id = e.target.value;
                setSelectedExcelFileId(id);
                const found = fileList.find((f) => f.id === id);
                if (found && found.file) {
                  handleSelectExcel(found.file);
                }
              }}
              className="main-select"
            >
              <option value="">{lang === 'ja' ? '-- アップロードされたExcel/CSVを選択 --' : '-- Select Excel/CSV --'}</option>
              {fileList
                .filter((f) => ['xlsx', 'xls', 'csv', 'tsv'].includes(f.format))
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({(f.size / 1024).toFixed(1)} KB)
                  </option>
                ))}
            </select>
          </div>

          {Object.keys(excelSheets).length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="text-xs font-semibold text-slate-500">{lang === 'ja' ? 'シート選択:' : 'Select Sheet:'}</div>
              <div className="flex items-center gap-2 overflow-x-auto">
                {Object.keys(excelSheets).map((sheetName) => (
                  <button
                    key={sheetName}
                    onClick={() => setActiveSheet(sheetName)}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold ${
                      activeSheet === sheetName
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600'
                    }`}
                  >
                    {sheetName}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={handleExcelToPdf}
            disabled={!excelFile || isProcessingExcel}
            className="btn btn-primary flex items-center justify-center gap-2 py-3 mt-2"
          >
            {isProcessingExcel ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>{lang === 'ja' ? 'PDFテーブルを生成中...' : 'Generating PDF Table...'}</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>{lang === 'ja' ? 'スプレッドシートからPDFに変換して保存' : 'Convert Spreadsheet to PDF'}</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* 4. Text/MD -> Word DOCX */}
      {activeTool === 'text-docx' && (
        <div className="card flex flex-col gap-4">
          <div className="section-title">
            <span className="flex items-center gap-2">
              <FileCode className="w-4 h-4 text-purple-600" />
              <span>{lang === 'ja' ? 'テキスト / Markdown から Word (.docx) 文書を作成' : 'Create Word (.docx) from Markdown/Text'}</span>
            </span>
          </div>

          <textarea
            value={markdownInput}
            onChange={(e) => setMarkdownInput(e.target.value)}
            rows={8}
            className="w-full p-4 font-mono text-xs leading-relaxed rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100"
            placeholder="# タイトル..."
          />

          <button
            onClick={handleGenerateDocxFromMd}
            disabled={isGeneratingDocx || !markdownInput.trim()}
            className="btn btn-primary flex items-center justify-center gap-2 py-3"
          >
            {isGeneratingDocx ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>{lang === 'ja' ? 'Word文書を構築中...' : 'Creating Word Document...'}</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>{lang === 'ja' ? 'Word (.docx) として保存' : 'Export as Word (.docx)'}</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};
