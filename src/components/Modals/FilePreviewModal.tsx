import React, { useState, useEffect, useRef } from 'react';
import { X, Download, FileText, ZoomIn, ZoomOut, RotateCw, Copy, Check, Eye, Code, ExternalLink } from 'lucide-react';
import { FileItem } from '../../types';
import { docxToHtml } from '../../utils/officeUtils';
import { parseSpreadsheet } from '../../utils/officeUtils';
import { inspectZip, ZipEntryInfo } from '../../utils/zipUtils';
import { extractPdfText } from '../../utils/pdfUtils';

interface FilePreviewModalProps {
  item: FileItem | null;
  onClose: () => void;
  lang: 'ja' | 'en';
}

export const FilePreviewModal: React.FC<FilePreviewModalProps> = ({ item, onClose, lang }) => {
  const [loading, setLoading] = useState(true);
  const [htmlContent, setHtmlContent] = useState<string>('');
  const [htmlViewMode, setHtmlViewMode] = useState<'rendered' | 'source'>('rendered');
  const [textContent, setTextContent] = useState<string>('');
  const [spreadsheetData, setSpreadsheetData] = useState<{ [sheet: string]: any[][] }>({});
  const [activeSheet, setActiveSheet] = useState<string>('');
  const [zipEntries, setZipEntries] = useState<ZipEntryInfo[]>([]);
  const [copied, setCopied] = useState(false);
  const [htmlBlobUrl, setHtmlBlobUrl] = useState<string>('');

  useEffect(() => {
    if (!item) return;

    let isMounted = true;
    setLoading(true);
    setHtmlContent('');
    setTextContent('');
    setSpreadsheetData({});
    setZipEntries([]);
    if (htmlBlobUrl) {
      URL.revokeObjectURL(htmlBlobUrl);
      setHtmlBlobUrl('');
    }

    const loadPreview = async () => {
      try {
        const ext = item.name.split('.').pop()?.toLowerCase() || '';

        if (ext === 'html' || ext === 'htm') {
          const text = await item.file.text();
          if (isMounted) {
            setHtmlContent(text);
            setTextContent(text);
            const blob = new Blob([text], { type: 'text/html;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            setHtmlBlobUrl(url);
          }
        } else if (ext === 'docx') {
          const html = await docxToHtml(item.file);
          if (isMounted) {
            setHtmlContent(html);
          }
        } else if (['xlsx', 'xls', 'csv', 'tsv'].includes(ext)) {
          const data = await parseSpreadsheet(item.file);
          if (isMounted) {
            setSpreadsheetData(data.sheets);
            if (data.sheetNames.length > 0) {
              setActiveSheet(data.sheetNames[0]);
            }
          }
        } else if (ext === 'pdf') {
          const text = await extractPdfText(item.file);
          if (isMounted) setTextContent(text);
        } else if (['txt', 'md', 'json', 'xml', 'rtf', 'js', 'ts', 'css', 'py', 'sh', 'sql'].includes(ext)) {
          const text = await item.file.text();
          if (isMounted) {
            setTextContent(text);
          }
        } else if (ext === 'zip') {
          const entries = await inspectZip(item.file);
          if (isMounted) setZipEntries(entries);
        }
      } catch (err) {
        console.error('Preview error:', err);
        if (isMounted) {
          setTextContent(lang === 'ja' ? 'プレビューの生成に失敗しました。' : 'Failed to generate preview.');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadPreview();

    return () => {
      isMounted = false;
    };
  }, [item, lang]);

  // Clean up blob url on unmount
  useEffect(() => {
    return () => {
      if (htmlBlobUrl) {
        URL.revokeObjectURL(htmlBlobUrl);
      }
    };
  }, [htmlBlobUrl]);

  if (!item) return null;

  const ext = item.name.split('.').pop()?.toLowerCase() || '';
  const isImage = ['png', 'jpg', 'jpeg', 'webp', 'svg', 'bmp', 'gif', 'ico'].includes(ext);
  const isAudio = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(ext);
  const isVideo = ['mp4', 'webm', 'mov', 'avi', 'mkv', 'flv', 'wmv'].includes(ext);
  const isPdf = ext === 'pdf';
  const isHtml = ext === 'html' || ext === 'htm';

  const handleCopy = () => {
    const textToCopy = textContent || htmlContent;
    if (textToCopy) {
      navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadDirect = () => {
    const blob = item.resultBlob || item.file;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = item.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box max-w-4xl h-[88vh] flex flex-col p-0 overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400">
              <FileText className="w-5 h-5" />
            </div>
            <div className="truncate">
              <h3 className="text-sm sm:text-base font-bold text-slate-800 dark:text-slate-100 truncate">
                {item.name}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {(item.size / 1024).toFixed(1)} KB • {ext.toUpperCase()}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* HTML View Mode Switcher */}
            {isHtml && (
              <div className="flex items-center bg-slate-200 dark:bg-slate-800 rounded-lg p-0.5 text-xs font-semibold">
                <button
                  onClick={() => setHtmlViewMode('rendered')}
                  className={`px-2.5 py-1 rounded-md flex items-center gap-1 transition ${
                    htmlViewMode === 'rendered'
                      ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>{lang === 'ja' ? 'ウェブ表示' : 'Page View'}</span>
                </button>
                <button
                  onClick={() => setHtmlViewMode('source')}
                  className={`px-2.5 py-1 rounded-md flex items-center gap-1 transition ${
                    htmlViewMode === 'source'
                      ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <Code className="w-3.5 h-3.5" />
                  <span>{lang === 'ja' ? 'ソース' : 'Source'}</span>
                </button>
              </div>
            )}

            {(textContent || htmlContent) && (
              <button
                onClick={handleCopy}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? (lang === 'ja' ? 'コピー完了' : 'Copied') : lang === 'ja' ? 'コピー' : 'Copy'}</span>
              </button>
            )}

            <button
              onClick={handleDownloadDirect}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{lang === 'ja' ? '保存' : 'Save'}</span>
            </button>

            <button
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              aria-label="閉じる"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-auto p-4 sm:p-6 bg-slate-100/50 dark:bg-slate-950/50 flex flex-col">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-500">
              <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm font-medium">{lang === 'ja' ? 'プレビューをレンダリング中...' : 'Rendering preview...'}</p>
            </div>
          ) : isImage ? (
            <div className="flex items-center justify-center h-full">
              <img
                src={item.previewUrl || URL.createObjectURL(item.file)}
                alt={item.name}
                className="max-h-full max-w-full object-contain rounded-lg shadow-md"
              />
            </div>
          ) : isAudio ? (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-md flex flex-col items-center gap-4 max-w-md w-full">
                <FileText className="w-12 h-12 text-blue-500" />
                <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{item.name}</p>
                <audio
                  controls
                  autoPlay
                  src={URL.createObjectURL(item.file)}
                  className="w-full"
                />
              </div>
            </div>
          ) : isVideo ? (
            <div className="flex items-center justify-center h-full">
              <video
                controls
                autoPlay
                src={URL.createObjectURL(item.file)}
                className="max-h-full max-w-full rounded-lg shadow-md bg-black"
              />
            </div>
          ) : isHtml ? (
            htmlViewMode === 'rendered' ? (
              <div className="flex-1 w-full h-full min-h-[400px] flex flex-col bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                <div className="px-3 py-2 bg-slate-100 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs text-slate-500">
                  <div className="flex items-center gap-1.5 font-mono">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-400 inline-block"></span>
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block"></span>
                    <span className="w-2.5 h-2.5 rounded-full bg-green-400 inline-block"></span>
                    <span className="ml-2 font-semibold text-slate-600 dark:text-slate-300 truncate">HTML Sandbox Preview ({item.name})</span>
                  </div>
                  {htmlBlobUrl && (
                    <a
                      href={htmlBlobUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 font-semibold"
                    >
                      <span>{lang === 'ja' ? '別タブで開く' : 'Open in Tab'}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                <iframe
                  title="HTML Preview Sandbox"
                  srcDoc={htmlContent}
                  sandbox="allow-same-origin allow-scripts"
                  className="w-full flex-1 border-0 bg-white"
                />
              </div>
            ) : (
              <pre className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-mono whitespace-pre-wrap overflow-auto flex-1 text-slate-800 dark:text-slate-200">
                {htmlContent}
              </pre>
            )
          ) : isPdf ? (
            <div className="h-full flex flex-col gap-4">
              <div className="p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-lg text-xs text-blue-700 dark:text-blue-300">
                {lang === 'ja'
                  ? 'PDFのテキスト内容を抽出して表示しています。「PDF スイート」タブで全ページのビジュアルサムネイル編集が可能です。'
                  : 'Displaying extracted PDF text. Visual page editing is available in the PDF Toolkit tab.'}
              </div>
              <pre className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 text-xs sm:text-sm font-mono whitespace-pre-wrap overflow-auto flex-1 text-slate-800 dark:text-slate-200">
                {textContent || (lang === 'ja' ? 'テキストが検出されませんでした。' : 'No text detected.')}
              </pre>
            </div>
          ) : htmlContent ? (
            <div
              className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 prose dark:prose-invert max-w-none text-sm text-slate-800 dark:text-slate-200 shadow-xs overflow-auto flex-1"
              dangerouslySetInnerHTML={{ __html: htmlContent }}
            />
          ) : Object.keys(spreadsheetData).length > 0 ? (
            <div className="flex flex-col h-full gap-3">
              {/* Sheet tabs */}
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {Object.keys(spreadsheetData).map((sName) => (
                  <button
                    key={sName}
                    onClick={() => setActiveSheet(sName)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                      activeSheet === sName
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50'
                    }`}
                  >
                    {sName}
                  </button>
                ))}
              </div>

              {/* Table */}
              <div className="flex-1 overflow-auto bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full border-collapse text-xs text-left">
                  <tbody>
                    {(spreadsheetData[activeSheet] || []).map((row, rIdx) => (
                      <tr
                        key={rIdx}
                        className={
                          rIdx === 0
                            ? 'bg-slate-100 dark:bg-slate-800/80 font-bold sticky top-0 border-b border-slate-200 dark:border-slate-700'
                            : 'border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/30'
                        }
                      >
                        <td className="px-3 py-2 text-slate-400 font-mono text-[10px] w-8 border-r border-slate-200 dark:border-slate-800 select-none">
                          {rIdx + 1}
                        </td>
                        {row.map((cell: any, cIdx: number) => (
                          <td
                            key={cIdx}
                            className="px-3 py-2 border-r border-slate-100 dark:border-slate-800 text-slate-700 dark:text-slate-300 truncate max-w-xs"
                          >
                            {cell !== undefined && cell !== null ? String(cell) : ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : zipEntries.length > 0 ? (
            <div className="flex flex-col h-full bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
                {lang === 'ja' ? 'ZIPアーカイブ内ファイル一覧' : 'ZIP Archive Contents'} ({zipEntries.length} items)
              </h4>
              <div className="flex-1 overflow-auto divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {zipEntries.map((entry, idx) => (
                  <div key={idx} className="py-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-2 truncate">
                      <FileText className="w-4 h-4 text-amber-500 flex-shrink-0" />
                      <span className="font-mono text-slate-800 dark:text-slate-200 truncate">{entry.name}</span>
                    </div>
                    <div className="flex items-center gap-4 text-slate-400 text-[11px] flex-shrink-0">
                      <span>{(entry.size / 1024).toFixed(1)} KB</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <pre className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-mono whitespace-pre-wrap text-slate-800 dark:text-slate-200">
              {textContent || (lang === 'ja' ? 'プレビュー表示可能なコンテンツがありません。' : 'No previewable content.')}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
};
