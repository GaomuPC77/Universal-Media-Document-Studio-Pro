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
  Search,
  ArrowDown,
  ArrowUp,
  X,
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
import {
  convertDataFormat,
  convertTextDocument,
  DataTargetFormat,
  TextTargetFormat,
} from '../../utils/formatConversionUtils';
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
  const [activeTool, setActiveTool] = useState<'word-pdf' | 'excel-pdf' | 'pdf-office' | 'data-table' | 'text-docx'>('pdf-office');
  const [pendingPromptFile, setPendingPromptFile] = useState<{ file: File; type: 'word' | 'excel' | 'pdf' | 'data' } | null>(null);

  // Data & Table state
  const [dataTableFile, setDataTableFile] = useState<File | null>(null);
  const [selectedDataTableFileId, setSelectedDataTableFileId] = useState<string>('');
  const [dataTableInputText, setDataTableInputText] = useState<string>(
    `品名,数量,単価,小計\nノートPC,5,85000,425000\n高解像度ディスプレイ,8,32000,256000\nワイヤレスマウス,15,2400,36000\nエルゴノミックキーボード,10,12800,128000`
  );
  const [dataTargetFormat, setDataTargetFormat] = useState<DataTargetFormat>('xlsx');
  const [isProcessingDataTable, setIsProcessingDataTable] = useState(false);
  const dataTableInputRef = useRef<HTMLInputElement>(null);

  // Text -> Document target format state
  const [textTargetFormat, setTextTargetFormat] = useState<TextTargetFormat>('docx');

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
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const wordInputRef = useRef<HTMLInputElement>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);
  const textFileInputRef = useRef<HTMLInputElement>(null);
  const [selectedTextFileId, setSelectedTextFileId] = useState<string>('');

  // Text/MD -> Word DOCX
  const [markdownInput, setMarkdownInput] = useState<string>(
    `# 業務報告書 (Business Report)\n\n## 1. 概要\n本書はOfficeドキュメント変換スタジオで生成された文書です。\n\n## 2. 主要実績\n- PDFとOfficeドキュメントの高精度な相互変換\n- サーバー通信ゼロ・完全端末内ローカル処理\n- 高速なブラウザ内レンダリング\n\n## 3. まとめ\n今後も機能拡張を継続してまいります。`
  );
  const [isGeneratingDocx, setIsGeneratingDocx] = useState(false);
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const [isCaseSensitive, setIsCaseSensitive] = useState(false);

  // String find & replace handlers for document text
  const handleReplaceAllText = () => {
    if (!findQuery) return;
    const flags = isCaseSensitive ? 'g' : 'gi';
    const regex = new RegExp(findQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    const count = (markdownInput.match(regex) || []).length;
    if (count === 0) {
      if (onShowToast) onShowToast(lang === 'ja' ? '一致する文字列がありません' : 'No matches found');
      return;
    }
    const updated = markdownInput.replace(regex, replaceQuery);
    setMarkdownInput(updated);
    if (onShowToast) {
      onShowToast(lang === 'ja' ? `${count} 箇所の文字列を置換しました` : `Replaced ${count} occurrences`);
    }
  };

  const handleReplaceNextText = () => {
    if (!findQuery) return;
    const flags = isCaseSensitive ? '' : 'i';
    const regex = new RegExp(findQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    if (!regex.test(markdownInput)) {
      if (onShowToast) onShowToast(lang === 'ja' ? '一致する文字列がありません' : 'No matches found');
      return;
    }
    const updated = markdownInput.replace(regex, replaceQuery);
    setMarkdownInput(updated);
    if (onShowToast) {
      onShowToast(lang === 'ja' ? '1箇所置換しました' : 'Replaced 1 occurrence');
    }
  };

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

  // Convert & Export Data/Table (CSV ⇔ TSV ⇔ XLSX ⇔ JSON ⇔ HTML table ⇔ MD table)
  const handleConvertDataTable = async () => {
    setIsProcessingDataTable(true);
    try {
      let sourceBlob: Blob;
      let sourceExt = 'csv';
      let originalName = 'data_table';

      if (dataTableFile) {
        sourceBlob = dataTableFile;
        sourceExt = dataTableFile.name.split('.').pop()?.toLowerCase() || 'csv';
        originalName = dataTableFile.name.replace(/\.[^/.]+$/, '');
      } else {
        sourceBlob = new Blob([dataTableInputText], { type: 'text/plain;charset=utf-8' });
        sourceExt = dataTableInputText.trim().startsWith('{') || dataTableInputText.trim().startsWith('[') ? 'json' : 'csv';
      }

      const resultBlob = await convertDataFormat(sourceBlob, sourceExt, dataTargetFormat);
      const resultName = `${originalName}.${dataTargetFormat}`;

      const url = URL.createObjectURL(resultBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = resultName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      await saveProcessedFile(`data_${Date.now()}`, originalName, resultName, resultBlob, dataTargetFormat);

      if (onResultReady) {
        onResultReady({
          id: `res_data_${Date.now()}`,
          name: resultName,
          file: new File([resultBlob], resultName, { type: resultBlob.type }),
          size: resultBlob.size,
          type: resultBlob.type,
          format: dataTargetFormat as any,
          targetFormat: dataTargetFormat as any,
          status: 'done',
          progress: 100,
          resultBlob,
          resultName,
        });
      }

      notifyCompletion(lang === 'ja' ? 'データ・表の変換が完了しました' : 'Data Table Converted', resultName);
      if (onShowToast) onShowToast(lang === 'ja' ? `「${resultName}」を作成しました` : `Created "${resultName}"`);
    } catch (e: any) {
      console.error('Data table conversion failed:', e);
      alert(lang === 'ja' ? 'データ・表変換に失敗しました: ' + e.message : 'Data table conversion failed: ' + e.message);
    } finally {
      setIsProcessingDataTable(false);
    }
  };

  // Export Text / Markdown to Document (Word DOCX, HTML, Markdown, Plain Text)
  const handleExportTextDocument = async () => {
    setIsGeneratingDocx(true);
    const baseName = `Document_${new Date().toISOString().slice(0, 10)}`;
    const ext = textTargetFormat;
    const resultName = `${baseName}.${ext}`;
    try {
      const sourceBlob = new Blob([markdownInput], { type: 'text/plain;charset=utf-8' });
      const blob = await convertTextDocument(sourceBlob, 'txt', textTargetFormat, 'Exported Document');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = resultName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      await saveProcessedFile(`txt_doc_${Date.now()}`, 'text_input', resultName, blob, ext);

      if (onResultReady) {
        onResultReady({
          id: `res_txtdoc_${Date.now()}`,
          name: resultName,
          file: new File([blob], resultName, { type: blob.type }),
          size: blob.size,
          type: blob.type,
          format: ext as any,
          targetFormat: ext as any,
          status: 'done',
          progress: 100,
          resultBlob: blob,
          resultName,
        });
      }

      notifyCompletion(lang === 'ja' ? '文書の作成が完了しました' : 'Document Created', resultName);
      if (onShowToast) onShowToast(lang === 'ja' ? `「${resultName}」を作成しました` : `Created "${resultName}"`);
    } catch (e: any) {
      console.error('Document generation failed:', e);
      alert(lang === 'ja' ? '文書作成に失敗しました: ' + e.message : 'Document generation failed');
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
          } else if (type === 'data') {
            setDataTableFile(file);
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
          } else if (type === 'data') {
            setDataTableFile(file);
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
      <div className="grid grid-cols-2 sm:grid-cols-5 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
        {[
          { id: 'pdf-office', labelJa: 'PDF → Office / CSV', labelEn: 'PDF → Office', icon: ArrowRightLeft },
          { id: 'word-pdf', labelJa: 'Word (.docx) ⇔ PDF', labelEn: 'Word ⇔ PDF', icon: FileText },
          { id: 'excel-pdf', labelJa: 'Excel / CSV ⇔ PDF', labelEn: 'Excel / CSV ⇔ PDF', icon: TableIcon },
          { id: 'data-table', labelJa: 'データ・表相互変換', labelEn: 'Data / Table', icon: FileSpreadsheet },
          { id: 'text-docx', labelJa: 'テキスト → Word/HTML', labelEn: 'Text to Docs', icon: FileCode },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTool === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTool(tab.id as any)}
              className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg text-xs font-bold transition ${
                isActive
                  ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
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
            <label className="whitespace-nowrap">{lang === 'ja' ? '変換対象のPDFファイルを選択:' : 'Select Target PDF File:'}</label>
            <select
              value={selectedPdfFileId}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '__upload_new__') {
                  pdfInputRef.current?.click();
                  return;
                }
                setSelectedPdfFileId(val);
                const found = fileList.find((f) => f.id === val);
                if (found && found.file) {
                  setPdfFile(found.file);
                }
              }}
              className="main-select"
            >
              <option value="">{lang === 'ja' ? '-- アップロードされたPDFを選択 --' : '-- Select Uploaded PDF --'}</option>
              <option value="__upload_new__">
                {lang === 'ja' ? '📁 ＋ 新しいPDFを端末からアップロード...' : '📁 + Upload New PDF File...'}
              </option>
              {fileList
                .filter((f) => f.format === 'pdf' || f.name.toLowerCase().endsWith('.pdf'))
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({(f.size / 1024).toFixed(1)} KB)
                  </option>
                ))}
            </select>
            <input
              ref={pdfInputRef}
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  const file = e.target.files[0];
                  setPendingPromptFile({ file, type: 'pdf' });
                  e.target.value = '';
                }
              }}
            />
          </div>

          {/* Target Format Selector */}
          <div>
            <label>{lang === 'ja' ? '出力Officeフォーマットを選択:' : 'Select Target Office Format:'}</label>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {[
                { id: 'docx', label: 'Word (.docx)', icon: FileText, desc: lang === 'ja' ? '編集可能なWord文書' : 'Editable Word document' },
                { id: 'xlsx', label: 'Excel (.xlsx)', icon: FileSpreadsheet, desc: lang === 'ja' ? '表組みスプレッドシート' : 'Spreadsheet table' },
                { id: 'pptx', label: 'PowerPoint (.pptx)', icon: Briefcase, desc: lang === 'ja' ? 'スライドプレゼンテーション' : 'Slide presentation' },
                { id: 'csv', label: 'CSV (.csv)', icon: TableIcon, desc: lang === 'ja' ? 'カンマ区切りデータ' : 'Comma-separated values' },
                { id: 'txt', label: 'Text (.txt)', icon: FileCode, desc: lang === 'ja' ? 'プレーンテキスト' : 'Plain text extract' },
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
            <label className="whitespace-nowrap">{lang === 'ja' ? '変換対象のWord / PDFファイルを選択:' : 'Select Target Word or PDF File:'}</label>
            <select
              value={selectedWordFileId}
              onChange={(e) => {
                const id = e.target.value;
                if (id === '__upload_new__') {
                  wordInputRef.current?.click();
                  return;
                }
                setSelectedWordFileId(id);
                const found = fileList.find((f) => f.id === id);
                if (found && found.file) {
                  handleSelectWord(found.file);
                }
              }}
              className="main-select"
            >
              <option value="">{lang === 'ja' ? '-- アップロードされたWord/PDFを選択 --' : '-- Select Word/PDF --'}</option>
              <option value="__upload_new__">
                {lang === 'ja' ? '📁 ＋ 新しいWord/PDFを端末からアップロード...' : '📁 + Upload New Word/PDF File...'}
              </option>
              {fileList
                .filter((f) => ['docx', 'doc', 'pdf'].includes(f.format) || f.name.toLowerCase().endsWith('.docx'))
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({(f.size / 1024).toFixed(1)} KB)
                  </option>
                ))}
            </select>
            <input
              ref={wordInputRef}
              type="file"
              accept=".docx,.doc,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  const file = e.target.files[0];
                  setPendingPromptFile({ file, type: 'word' });
                  e.target.value = '';
                }
              }}
            />
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
            <label className="whitespace-nowrap">{lang === 'ja' ? '変換対象のエクセル / CSVファイルを選択:' : 'Select Target Spreadsheet / CSV File:'}</label>
            <select
              value={selectedExcelFileId}
              onChange={(e) => {
                const id = e.target.value;
                if (id === '__upload_new__') {
                  excelInputRef.current?.click();
                  return;
                }
                setSelectedExcelFileId(id);
                const found = fileList.find((f) => f.id === id);
                if (found && found.file) {
                  handleSelectExcel(found.file);
                }
              }}
              className="main-select"
            >
              <option value="">{lang === 'ja' ? '-- アップロードされたExcel/CSVを選択 --' : '-- Select Excel/CSV --'}</option>
              <option value="__upload_new__">
                {lang === 'ja' ? '📁 ＋ 新しいExcel/CSVを端末からアップロード...' : '📁 + Upload New Excel/CSV File...'}
              </option>
              {fileList
                .filter((f) => ['xlsx', 'xls', 'csv', 'tsv'].includes(f.format))
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({(f.size / 1024).toFixed(1)} KB)
                  </option>
                ))}
            </select>
            <input
              ref={excelInputRef}
              type="file"
              accept=".xlsx,.xls,.csv,.tsv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  const file = e.target.files[0];
                  setPendingPromptFile({ file, type: 'excel' });
                  e.target.value = '';
                }
              }}
            />
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

      {/* 4. Data / Table Conversion (CSV ⇔ TSV ⇔ XLSX ⇔ JSON ⇔ HTML table ⇔ MD table) */}
      {activeTool === 'data-table' && (
        <div className="card flex flex-col gap-4">
          <div className="section-title">
            <span className="flex items-center gap-2">
              <TableIcon className="w-4 h-4 text-emerald-600" />
              <span>{lang === 'ja' ? 'データ・表フォーマット相互変換' : 'Data & Table Format Conversion'}</span>
            </span>
          </div>

          <p className="text-xs text-slate-500">
            {lang === 'ja'
              ? 'CSV、TSV、Excel (.xlsx)、JSON、HTML表、Markdown表を相互に直接変換・エクスポートします。すべて端末内ローカル処理で安全です。'
              : 'Directly convert and export between CSV, TSV, Excel (.xlsx), JSON, HTML tables, and Markdown tables 100% locally.'}
          </p>

          {/* Select Loaded File */}
          <div>
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
              {lang === 'ja' ? '変換元のデータファイルを選択 (任意):' : 'Select Source Data File (Optional):'}
            </label>
            <select
              value={selectedDataTableFileId}
              onChange={async (e) => {
                const val = e.target.value;
                if (val === '__upload_new__') {
                  dataTableInputRef.current?.click();
                  return;
                }
                setSelectedDataTableFileId(val);
                const found = fileList.find((f) => f.id === val);
                if (found && found.file) {
                  setDataTableFile(found.file);
                  try {
                    const txt = await found.file.text();
                    setDataTableInputText(txt.slice(0, 10000));
                  } catch {}
                }
              }}
              className="main-select"
            >
              <option value="">{lang === 'ja' ? '-- アップロードされたデータファイルを選択または下記に直接入力 --' : '-- Select Loaded Data File or Type Below --'}</option>
              <option value="__upload_new__">
                {lang === 'ja' ? '📁 ＋ 新しいデータファイルを端末からアップロード...' : '📁 + Upload New Data File...'}
              </option>
              {fileList
                .filter((f) =>
                  ['csv', 'tsv', 'xlsx', 'xls', 'json'].includes(f.format?.toLowerCase() || '') ||
                  /\.(csv|tsv|xlsx?|json)$/i.test(f.name)
                )
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({(f.size / 1024).toFixed(1)} KB)
                  </option>
                ))}
            </select>
            <input
              ref={dataTableInputRef}
              type="file"
              accept=".csv,.tsv,.xlsx,.xls,.json,text/csv,text/tab-separated-values,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  const file = e.target.files[0];
                  setPendingPromptFile({ file, type: 'data' });
                  e.target.value = '';
                }
              }}
            />
          </div>

          {/* Target Data Format Selector */}
          <div>
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
              {lang === 'ja' ? '出力データ形式を選択:' : 'Select Target Data Format:'}
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
              {[
                { id: 'csv', label: 'CSV (.csv)', desc: lang === 'ja' ? 'カンマ区切り' : 'Comma separated' },
                { id: 'tsv', label: 'TSV (.tsv)', desc: lang === 'ja' ? 'タブ区切り' : 'Tab separated' },
                { id: 'xlsx', label: 'Excel (.xlsx)', desc: lang === 'ja' ? 'Excelブック' : 'Excel workbook' },
                { id: 'json', label: 'JSON (.json)', desc: lang === 'ja' ? '構造化データ' : 'JSON records' },
                { id: 'html', label: 'HTML Table', desc: lang === 'ja' ? 'WEB表組み' : 'Web table' },
                { id: 'md', label: 'Markdown Table', desc: lang === 'ja' ? 'MD記法表' : 'Markdown table' },
              ].map((fmt) => (
                <button
                  key={fmt.id}
                  onClick={() => setDataTargetFormat(fmt.id as DataTargetFormat)}
                  className={`p-2.5 rounded-xl border text-left flex flex-col gap-0.5 transition ${
                    dataTargetFormat === fmt.id
                      ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-2 ring-emerald-500/20'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs">{fmt.label}</span>
                    {dataTargetFormat === fmt.id && <Check className="w-3.5 h-3.5 text-emerald-600" />}
                  </div>
                  <div className="text-[10px] text-slate-400">{fmt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Textarea for Data */}
          <div>
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
              {lang === 'ja' ? 'データ内容のプレビュー・編集 (CSV, TSV, JSON, MD表):' : 'Data Input / Live Preview:'}
            </label>
            <textarea
              value={dataTableInputText}
              onChange={(e) => {
                setDataTableInputText(e.target.value);
                setDataTableFile(null);
                setSelectedDataTableFileId('');
              }}
              rows={7}
              className="w-full p-3 font-mono text-xs leading-relaxed rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100"
              placeholder="品名,数量,単価..."
            />
          </div>

          <button
            onClick={handleConvertDataTable}
            disabled={isProcessingDataTable || (!dataTableFile && !dataTableInputText.trim())}
            className="btn btn-primary flex items-center justify-center gap-2 py-3"
          >
            {isProcessingDataTable ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>{lang === 'ja' ? 'データ変換中...' : 'Converting Data...'}</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>
                  {lang === 'ja'
                    ? `${dataTargetFormat.toUpperCase()} 形式に変換して保存`
                    : `Convert & Export as ${dataTargetFormat.toUpperCase()}`}
                </span>
              </>
            )}
          </button>
        </div>
      )}

      {/* 5. Text/MD -> Word / HTML / MD / TXT */}
      {activeTool === 'text-docx' && (
        <div className="card flex flex-col gap-4">
          <div className="section-title flex items-center justify-between">
            <span className="flex items-center gap-2">
              <FileCode className="w-4 h-4 text-purple-600" />
              <span>{lang === 'ja' ? 'テキスト / Markdown から各種文書フォーマットへ変換' : 'Convert Text / Markdown to Documents'}</span>
            </span>
            <button
              type="button"
              onClick={() => setShowFindReplace((prev) => !prev)}
              className={`px-2.5 py-1 text-xs rounded-md border flex items-center gap-1 font-semibold transition ${
                showFindReplace
                  ? 'bg-blue-50 dark:bg-blue-950 border-blue-400 text-blue-600 dark:text-blue-400'
                  : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-blue-400'
              }`}
              title={lang === 'ja' ? '文書内の文字列を検索・置換' : 'Find & Replace in text'}
            >
              <Search className="w-3.5 h-3.5" />
              <span>{lang === 'ja' ? '検索・置換' : 'Find / Replace'}</span>
            </button>
          </div>

          <p className="text-xs text-slate-500">
            {lang === 'ja'
              ? 'プレーンテキストやMarkdownを入力または読み込み、Word (.docx)、HTML文書、Markdownファイル、またはクリーンテキストに出力します。'
              : 'Write or load text/Markdown, and export as Word (.docx), HTML document, Markdown, or clean text.'}
          </p>

          {/* Target Text/Markdown Selector Dropdown */}
          <div>
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
              {lang === 'ja' ? '読み込み済みテキスト/Markdownファイルを選択:' : 'Select Target Text/Markdown File:'}
            </label>
            <select
              value={selectedTextFileId}
              onChange={async (e) => {
                const id = e.target.value;
                if (id === '__upload_new__') {
                  textFileInputRef.current?.click();
                  return;
                }
                setSelectedTextFileId(id);
                const found = fileList.find((f) => f.id === id);
                if (found && found.file) {
                  try {
                    const txt = await found.file.text();
                    setMarkdownInput(txt);
                    if (onShowToast) onShowToast(lang === 'ja' ? `「${found.name}」を読み込みました` : `Loaded "${found.name}"`);
                  } catch {
                    if (onShowToast) onShowToast(lang === 'ja' ? 'ファイルの読み込みに失敗しました' : 'Failed to read file');
                  }
                }
              }}
              className="main-select"
            >
              <option value="">{lang === 'ja' ? '-- アップロードされたText/Markdownを選択 --' : '-- Select Uploaded Text/Markdown --'}</option>
              <option value="__upload_new__">
                {lang === 'ja' ? '📁 ＋ 新しいText/Markdownを端末からアップロード...' : '📁 + Upload New Text/MD File...'}
              </option>
              {fileList
                .filter((f) => ['txt', 'md', 'markdown', 'json', 'csv', 'html', 'js', 'css'].includes(f.format) || /\.(txt|md|markdown)$/i.test(f.name))
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({(f.size / 1024).toFixed(1)} KB)
                  </option>
                ))}
            </select>
            <input
              ref={textFileInputRef}
              type="file"
              accept=".txt,.md,.markdown,text/plain,text/markdown"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  const file = e.target.files[0];
                  file.text().then((txt) => {
                    setMarkdownInput(txt);
                    if (onAddFiles) onAddFiles([file]);
                    if (onShowToast) onShowToast(lang === 'ja' ? `「${file.name}」を読み込みました` : `Loaded "${file.name}"`);
                  });
                  e.target.value = '';
                }
              }}
            />
          </div>

          {/* Target Document Format Selection */}
          <div>
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
              {lang === 'ja' ? '出力文書フォーマットを選択:' : 'Select Target Document Format:'}
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { id: 'docx', label: 'Word (.docx)', desc: lang === 'ja' ? 'Microsoft Word' : 'Word Document' },
                { id: 'html', label: 'HTML (.html)', desc: lang === 'ja' ? 'Web文書' : 'HTML Document' },
                { id: 'md', label: 'Markdown (.md)', desc: lang === 'ja' ? 'MDドキュメント' : 'Markdown File' },
                { id: 'txt', label: 'Text (.txt)', desc: lang === 'ja' ? 'プレーンテキスト' : 'Plain Text' },
              ].map((fmt) => (
                <button
                  key={fmt.id}
                  onClick={() => setTextTargetFormat(fmt.id as TextTargetFormat)}
                  className={`p-3 rounded-xl border text-left flex flex-col gap-0.5 transition ${
                    textTargetFormat === fmt.id
                      ? 'border-purple-500 bg-purple-50/50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 ring-2 ring-purple-500/20'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs">{fmt.label}</span>
                    {textTargetFormat === fmt.id && <Check className="w-3.5 h-3.5 text-purple-600" />}
                  </div>
                  <div className="text-[10px] text-slate-400">{fmt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Interactive Find & Replace Bar */}
          {showFindReplace && (
            <div className="p-3 bg-blue-50/70 dark:bg-slate-900 rounded-xl border border-blue-200 dark:border-slate-700 flex flex-col gap-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-1 min-w-0 w-full sm:w-auto">
                  <input
                    type="text"
                    value={findQuery}
                    onChange={(e) => setFindQuery(e.target.value)}
                    placeholder={lang === 'ja' ? '検索する文字列...' : 'Find text...'}
                    className="flex-1 min-w-0 px-2.5 py-1 text-xs rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
                    autoFocus
                  />
                  <label className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer select-none whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={isCaseSensitive}
                      onChange={(e) => setIsCaseSensitive(e.target.checked)}
                      className="rounded border-slate-300 text-blue-600 cursor-pointer"
                    />
                    <span>{lang === 'ja' ? '大文字小文字区別' : 'Match Case'}</span>
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => setShowFindReplace(false)}
                  className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={replaceQuery}
                  onChange={(e) => setReplaceQuery(e.target.value)}
                  placeholder={lang === 'ja' ? '置換後の文字列...' : 'Replace with...'}
                  className="flex-1 min-w-0 sm:min-w-[180px] px-2.5 py-1 text-xs rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
                />
                <button
                  type="button"
                  onClick={handleReplaceNextText}
                  disabled={!findQuery}
                  className="px-2.5 py-1 rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:border-blue-400 disabled:opacity-40 whitespace-nowrap"
                >
                  {lang === 'ja' ? '1件置換' : 'Replace One'}
                </button>
                <button
                  type="button"
                  onClick={handleReplaceAllText}
                  disabled={!findQuery}
                  className="px-2.5 py-1 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-40 whitespace-nowrap"
                >
                  {lang === 'ja' ? 'すべて置換' : 'Replace All'}
                </button>
              </div>
            </div>
          )}

          <textarea
            value={markdownInput}
            onChange={(e) => setMarkdownInput(e.target.value)}
            rows={8}
            className="w-full p-4 font-mono text-xs leading-relaxed rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100"
            placeholder="# タイトル..."
          />

          <button
            onClick={handleExportTextDocument}
            disabled={isGeneratingDocx || !markdownInput.trim()}
            className="btn btn-primary flex items-center justify-center gap-2 py-3"
          >
            {isGeneratingDocx ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>{lang === 'ja' ? '文書を構築中...' : 'Creating Document...'}</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>
                  {lang === 'ja'
                    ? `${textTargetFormat.toUpperCase()} 文書として保存`
                    : `Export as ${textTargetFormat.toUpperCase()}`}
                </span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};
