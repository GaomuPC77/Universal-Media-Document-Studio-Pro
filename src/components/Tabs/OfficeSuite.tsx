import React, { useState, useRef, useEffect } from 'react';
import {
  Briefcase,
  FileText,
  Table as TableIcon,
  Upload,
  Download,
  Eye,
  RefreshCw,
  Sparkles,
  ArrowRightLeft,
  CheckCircle2,
} from 'lucide-react';
import { docxToHtml, docxToText, createDocxFromText, parseSpreadsheet, exportSpreadsheet, textToPdf, spreadsheetToPdf } from '../../utils/officeUtils';
import { extractPdfText } from '../../utils/pdfUtils';
import { saveProcessedFile } from '../../utils/historyDb';

interface OfficeSuiteProps {
  lang: 'ja' | 'en';
  sharedFile?: File | null;
}

export const OfficeSuite: React.FC<OfficeSuiteProps> = ({ lang, sharedFile }) => {
  const [activeTool, setActiveTool] = useState<'word-pdf' | 'excel-pdf' | 'pdf-office' | 'text-docx'>('word-pdf');

  // Word <-> PDF state
  const [wordFile, setWordFile] = useState<File | null>(null);
  const [wordPreviewHtml, setWordPreviewHtml] = useState<string>('');
  const [isProcessingWord, setIsProcessingWord] = useState(false);

  // Excel <-> PDF state
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [excelSheets, setExcelSheets] = useState<{ [name: string]: any[][] }>({});
  const [activeSheet, setActiveSheet] = useState<string>('');
  const [isProcessingExcel, setIsProcessingExcel] = useState(false);

  // PDF -> Office state
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [isProcessingPdfToOffice, setIsProcessingPdfToOffice] = useState(false);

  // Auto load shared file
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
    }
  }, [sharedFile]);

  // Text/MD -> Word DOCX
  const [markdownInput, setMarkdownInput] = useState<string>(
    `# 業務報告書 (Business Report)\n\n## 1. 概要\n本書はクライアントサイドで生成されたWordドキュメントのサンプルです。\n\n## 2. 主要実績\n- PDFとOfficeドキュメントの安全な相互変換\n- サーバー通信ゼロ・完全プライベート処理\n- 高速なブラウザ内レンダリング\n\n## 3. まとめ\n今後も機能拡張を継続してまいります。`
  );
  const [isGeneratingDocx, setIsGeneratingDocx] = useState(false);

  const wordInputRef = useRef<HTMLInputElement>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);
  const pdfToOfficeInputRef = useRef<HTMLInputElement>(null);

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
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Word to PDF failed:', e);
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
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}_${activeSheet}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Excel to PDF failed:', e);
    } finally {
      setIsProcessingExcel(false);
    }
  };

  // Convert PDF to Word (DOCX)
  const handlePdfToDocx = async () => {
    if (!pdfFile) return;
    setIsProcessingPdfToOffice(true);
    try {
      const text = await extractPdfText(pdfFile);
      const baseName = pdfFile.name.replace(/\.pdf$/i, '');
      const docxBlob = await createDocxFromText(text, { title: baseName });

      const url = URL.createObjectURL(docxBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('PDF to Docx failed:', e);
    } finally {
      setIsProcessingPdfToOffice(false);
    }
  };

  // Convert PDF to Excel (XLSX)
  const handlePdfToXlsx = async () => {
    if (!pdfFile) return;
    setIsProcessingPdfToOffice(true);
    try {
      const text = await extractPdfText(pdfFile);
      const baseName = pdfFile.name.replace(/\.pdf$/i, '');
      const lines = text.split('\n').filter((l) => l.trim().length > 0);
      const rows = lines.map((line) => line.split(/\s{2,}|\t/).map((c) => c.trim()));
      const xlsxBlob = exportSpreadsheet(rows, 'xlsx', baseName);

      const url = URL.createObjectURL(xlsxBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('PDF to XLSX failed:', e);
    } finally {
      setIsProcessingPdfToOffice(false);
    }
  };

  // Generate DOCX from Markdown input
  const handleGenerateDocxFromMd = async () => {
    setIsGeneratingDocx(true);
    try {
      const blob = await createDocxFromText(markdownInput, { title: 'Exported Document' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Document_${new Date().toISOString().slice(0, 10)}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Docx generation failed:', e);
    } finally {
      setIsGeneratingDocx(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto">
      {/* Sub Tabs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
        {[
          { id: 'word-pdf', labelJa: 'Word (.docx) ⇔ PDF', labelEn: 'Word ⇔ PDF', icon: FileText },
          { id: 'excel-pdf', labelJa: 'Excel / CSV ⇔ PDF', labelEn: 'Excel / CSV ⇔ PDF', icon: TableIcon },
          { id: 'pdf-office', labelJa: 'PDF → Word / Excel', labelEn: 'PDF → Office', icon: ArrowRightLeft },
          { id: 'text-docx', labelJa: 'Markdown → Word作成', labelEn: 'Markdown to Word', icon: Sparkles },
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

      {/* 1. Word <-> PDF */}
      {activeTool === 'word-pdf' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h3 className="font-bold text-sm sm:text-base text-slate-800 dark:text-slate-100">
                {lang === 'ja' ? 'Word (.docx) ファイルをPDFに高速変換' : 'Word (.docx) to PDF Converter'}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {lang === 'ja' ? 'Word文書のレイアウトを保ちながらブラウザ内だけでPDFを生成します。' : 'Convert Word docx into clean PDF directly in browser.'}
              </p>
            </div>

            <button
              onClick={() => wordInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-xs"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{lang === 'ja' ? 'Wordファイルを選択' : 'Select Word file'}</span>
            </button>
            <input
              ref={wordInputRef}
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) handleSelectWord(e.target.files[0]);
              }}
            />
          </div>

          {wordFile && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl border border-blue-200 dark:border-blue-900 text-xs text-blue-800 dark:text-blue-300">
                <span className="font-semibold">{wordFile.name} ({(wordFile.size / 1024).toFixed(1)} KB)</span>
                <button
                  onClick={handleWordToPdf}
                  disabled={isProcessingWord}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-xs transition"
                >
                  {isProcessingWord ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                  <span>{lang === 'ja' ? 'PDFを生成してダウンロード' : 'Convert & Download PDF'}</span>
                </button>
              </div>

              {/* Word preview */}
              <div className="p-6 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 max-h-96 overflow-auto">
                <div
                  className="prose dark:prose-invert max-w-none text-xs sm:text-sm text-slate-800 dark:text-slate-200"
                  dangerouslySetInnerHTML={{ __html: wordPreviewHtml || '<p>Loading preview...</p>' }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2. Excel / CSV <-> PDF */}
      {activeTool === 'excel-pdf' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h3 className="font-bold text-sm sm:text-base text-slate-800 dark:text-slate-100">
                {lang === 'ja' ? 'Excel (.xlsx) / CSV を見やすいPDF帳票に変換' : 'Excel / CSV to PDF Table'}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {lang === 'ja' ? 'スプレッドシート表データを自動でグリッド線・ヘッダー付きのPDFに出力します。' : 'Render spreadsheet tables into formatted PDF grid tables.'}
              </p>
            </div>

            <button
              onClick={() => excelInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-xs"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{lang === 'ja' ? 'Excel/CSVを選択' : 'Select Spreadsheet'}</span>
            </button>
            <input
              ref={excelInputRef}
              type="file"
              accept=".xlsx,.xls,.csv,.tsv"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) handleSelectExcel(e.target.files[0]);
              }}
            />
          </div>

          {excelFile && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl border border-emerald-200 dark:border-emerald-900 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-emerald-900 dark:text-emerald-200">{excelFile.name}</span>
                  {Object.keys(excelSheets).length > 1 && (
                    <select
                      value={activeSheet}
                      onChange={(e) => setActiveSheet(e.target.value)}
                      className="px-2 py-1 rounded bg-white dark:bg-slate-800 border border-emerald-300 dark:border-emerald-700 font-bold"
                    >
                      {Object.keys(excelSheets).map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  )}
                </div>

                <button
                  onClick={handleExcelToPdf}
                  disabled={isProcessingExcel}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-xs transition"
                >
                  {isProcessingExcel ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                  <span>{lang === 'ja' ? 'PDF帳票として保存' : 'Export Table to PDF'}</span>
                </button>
              </div>

              {/* Table preview */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl max-h-80 overflow-auto bg-white dark:bg-slate-900">
                <table className="w-full border-collapse text-xs text-left">
                  <tbody>
                    {(excelSheets[activeSheet] || []).slice(0, 50).map((row, rIdx) => (
                      <tr
                        key={rIdx}
                        className={
                          rIdx === 0
                            ? 'bg-slate-100 dark:bg-slate-800 font-bold sticky top-0 border-b border-slate-200 dark:border-slate-700'
                            : 'border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50'
                        }
                      >
                        {row.map((cell: any, cIdx: number) => (
                          <td key={cIdx} className="px-3 py-2 border-r border-slate-100 dark:border-slate-800 truncate max-w-xs">
                            {cell !== undefined && cell !== null ? String(cell) : ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 3. PDF -> Office (Word / Excel) */}
      {activeTool === 'pdf-office' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col gap-5">
          <div>
            <h3 className="font-bold text-sm sm:text-base text-slate-800 dark:text-slate-100">
              {lang === 'ja' ? 'PDFからWord (.docx)・Excel (.xlsx) への逆変換' : 'Convert PDF to Word (.docx) or Excel (.xlsx)'}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {lang === 'ja'
                ? 'PDFからテキスト構造や表データを解析し、編集可能なWord文書やExcelシートとして出力します。'
                : 'Extract structured paragraphs and data matrices from PDF into editable Office files.'}
            </p>
          </div>

          {!pdfFile ? (
            <div
              onClick={() => pdfToOfficeInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer bg-slate-50/50 transition"
            >
              <input
                ref={pdfToOfficeInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) setPdfFile(e.target.files[0]);
                }}
              />
              <FileText className="w-10 h-10 text-slate-400 mb-2" />
              <p className="text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300">
                {lang === 'ja' ? '変換したいPDFファイルを選択' : 'Select PDF to convert to Office'}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl border border-blue-200 dark:border-blue-900 text-xs">
                <span className="font-semibold text-blue-900 dark:text-blue-200">{pdfFile.name}</span>
                <button
                  onClick={() => pdfToOfficeInputRef.current?.click()}
                  className="text-xs underline font-semibold text-blue-600 dark:text-blue-400"
                >
                  {lang === 'ja' ? '別のファイルを選択' : 'Change File'}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
                {/* PDF to Word Card */}
                <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex flex-col justify-between gap-4">
                  <div>
                    <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-950 text-blue-600 flex items-center justify-center mb-2">
                      <FileText className="w-5 h-5" />
                    </div>
                    <h4 className="font-bold text-sm text-slate-800 dark:text-slate-100">PDF → Word (.docx)</h4>
                    <p className="text-xs text-slate-500 mt-1">
                      {lang === 'ja' ? '見出し、段落、箇条書きを構造化してWord文書を生成' : 'Generate structured Word docx with headings & lists'}
                    </p>
                  </div>
                  <button
                    onClick={handlePdfToDocx}
                    disabled={isProcessingPdfToOffice}
                    className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs transition"
                  >
                    {lang === 'ja' ? 'Word文書 (.docx) に変換' : 'Convert to Word (.docx)'}
                  </button>
                </div>

                {/* PDF to Excel Card */}
                <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex flex-col justify-between gap-4">
                  <div>
                    <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-950 text-emerald-600 flex items-center justify-center mb-2">
                      <TableIcon className="w-5 h-5" />
                    </div>
                    <h4 className="font-bold text-sm text-slate-800 dark:text-slate-100">PDF → Excel (.xlsx)</h4>
                    <p className="text-xs text-slate-500 mt-1">
                      {lang === 'ja' ? 'PDF内の表・数値を解析してExcelスプレッドシートを生成' : 'Extract tabular text into structured Excel sheet'}
                    </p>
                  </div>
                  <button
                    onClick={handlePdfToXlsx}
                    disabled={isProcessingPdfToOffice}
                    className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition"
                  >
                    {lang === 'ja' ? 'Excel表 (.xlsx) に変換' : 'Convert to Excel (.xlsx)'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 4. Text / Markdown -> Word DOCX */}
      {activeTool === 'text-docx' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col gap-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-sm sm:text-base text-slate-800 dark:text-slate-100">
                {lang === 'ja' ? 'Markdown / テキストからWord (.docx) を自動組版作成' : 'Generate Styled Word (.docx) from Markdown'}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {lang === 'ja'
                  ? '# 見出し、リスト、段落を自動認識し、スタイリングされたWordファイルを即座に出力します。'
                  : 'Automatically format Markdown headings and bullet points into a styled Word docx.'}
              </p>
            </div>

            <button
              onClick={handleGenerateDocxFromMd}
              disabled={isGeneratingDocx}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition"
            >
              {isGeneratingDocx ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              <span>{lang === 'ja' ? 'Wordファイルをダウンロード' : 'Export .docx'}</span>
            </button>
          </div>

          <textarea
            value={markdownInput}
            onChange={(e) => setMarkdownInput(e.target.value)}
            rows={12}
            className="w-full p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono text-xs sm:text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-blue-500 transition"
            placeholder="Markdownまたはテキストを入力..."
          />
        </div>
      )}
    </div>
  );
};
