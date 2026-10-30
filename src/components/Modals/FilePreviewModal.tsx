import React, { useState, useEffect, useRef } from 'react';
import { X, Download, FileText, ZoomIn, ZoomOut, RotateCw, Copy, Check, Eye, Code, ExternalLink, BookOpen } from 'lucide-react';
import { FileItem } from '../../types';
import { docxToHtml } from '../../utils/officeUtils';
import { parseSpreadsheet } from '../../utils/officeUtils';
import { inspectZip, ZipEntryInfo } from '../../utils/zipUtils';
import { extractPdfText } from '../../utils/pdfUtils';
import { parseMarkdownToHtml } from '../../utils/markdownUtils';

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
  const [mediaBlobUrl, setMediaBlobUrl] = useState<string>('');

  useEffect(() => {
    if (!item) return;

    let isMounted = true;
    setLoading(true);
    setHtmlContent('');
    setTextContent('');
    setSpreadsheetData({});
    setZipEntries([]);
    if (mediaBlobUrl) {
      URL.revokeObjectURL(mediaBlobUrl);
      setMediaBlobUrl('');
    }

    const loadPreview = async () => {
      try {
        const ext = item.name.split('.').pop()?.toLowerCase() || '';
        const targetBlob: Blob | undefined = item.file || item.resultBlob;

        if (!targetBlob) {
          if (isMounted) {
            setTextContent(lang === 'ja' ? 'プレビュー対象のデータがありません。' : 'No preview data available.');
          }
          return;
        }

        // Create blob url for media / sandbox
        const url = URL.createObjectURL(targetBlob);
        if (isMounted) setMediaBlobUrl(url);

        if (ext === 'html' || ext === 'htm') {
          const text = await targetBlob.text();
          if (isMounted) {
            setHtmlContent(text);
            setTextContent(text);
          }
        } else if (ext === 'md' || ext === 'markdown') {
          const text = await targetBlob.text();
          if (isMounted) {
            setTextContent(text);
            setHtmlContent(parseMarkdownToHtml(text));
          }
        } else if (ext === 'docx') {
          const fileObj = targetBlob instanceof File ? targetBlob : new File([targetBlob], item.name);
          const html = await docxToHtml(fileObj);
          if (isMounted) {
            setHtmlContent(html);
          }
        } else if (['xlsx', 'xls', 'csv', 'tsv'].includes(ext)) {
          const fileObj = targetBlob instanceof File ? targetBlob : new File([targetBlob], item.name);
          const data = await parseSpreadsheet(fileObj);
          if (isMounted) {
            setSpreadsheetData(data.sheets);
            if (data.sheetNames.length > 0) {
              setActiveSheet(data.sheetNames[0]);
            }
          }
        } else if (ext === 'pdf') {
          const fileObj = targetBlob instanceof File ? targetBlob : new File([targetBlob], item.name);
          const text = await extractPdfText(fileObj);
          if (isMounted) setTextContent(text);
        } else if (['txt', 'json', 'xml', 'rtf', 'js', 'ts', 'css', 'py', 'sh', 'sql'].includes(ext)) {
          const text = await targetBlob.text();
          if (isMounted) {
            setTextContent(text);
          }
        } else if (ext === 'zip') {
          const fileObj = targetBlob instanceof File ? targetBlob : new File([targetBlob], item.name);
          const entries = await inspectZip(fileObj);
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
      if (mediaBlobUrl) {
        URL.revokeObjectURL(mediaBlobUrl);
      }
    };
  }, [mediaBlobUrl]);

  if (!item) return null;

  const ext = item.name.split('.').pop()?.toLowerCase() || '';
  const isImage = ['png', 'jpg', 'jpeg', 'webp', 'svg', 'bmp', 'gif', 'ico'].includes(ext);
  const isAudio = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(ext);
  const isVideo = ['mp4', 'webm', 'mov', 'avi', 'mkv', 'flv', 'wmv'].includes(ext);
  const isPdf = ext === 'pdf';
  const isHtmlOrMd = ext === 'html' || ext === 'htm' || ext === 'md' || ext === 'markdown';

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
    if (!blob) return;
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
        <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm sm:text-base font-bold text-slate-800 dark:text-slate-100 truncate" title={item.name}>
                {item.name}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {(item.size / 1024).toFixed(1)} KB • {ext.toUpperCase()}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap sm:flex-nowrap">
            {/* HTML/Markdown View Mode Switcher */}
            {isHtmlOrMd && (
              <div className="flex items-center bg-slate-200 dark:bg-slate-800 rounded-lg p-0.5 text-xs font-semibold shrink-0">
                <button
                  type="button"
                  onClick={() => setHtmlViewMode('rendered')}
                  className={`px-2.5 py-1 rounded-md flex items-center gap-1 transition whitespace-nowrap shrink-0 text-xs ${
                    htmlViewMode === 'rendered'
                      ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5 shrink-0" />
                  <span className="whitespace-nowrap">{lang === 'ja' ? 'レンダリング' : 'Rendered'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setHtmlViewMode('source')}
                  className={`px-2.5 py-1 rounded-md flex items-center gap-1 transition whitespace-nowrap shrink-0 text-xs ${
                    htmlViewMode === 'source'
                      ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <Code className="w-3.5 h-3.5 shrink-0" />
                  <span className="whitespace-nowrap">{lang === 'ja' ? 'ソース' : 'Source'}</span>
                </button>
              </div>
            )}

            {(textContent || htmlContent) && (
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition whitespace-nowrap shrink-0"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" /> : <Copy className="w-3.5 h-3.5 shrink-0" />}
                <span className="whitespace-nowrap">{copied ? (lang === 'ja' ? 'コピー完了' : 'Copied') : lang === 'ja' ? 'コピー' : 'Copy'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleDownloadDirect}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5 shrink-0" />
              <span className="whitespace-nowrap">{lang === 'ja' ? '保存' : 'Save'}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition shrink-0"
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
                src={item.previewUrl || mediaBlobUrl}
                alt={item.name}
                className="max-h-full max-w-full object-contain rounded-lg shadow-md"
              />
            </div>
          ) : isAudio ? (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-md flex flex-col items-center gap-4 max-w-md w-full">
                <FileText className="w-12 h-12 text-blue-500" />
                <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{item.name}</p>
                {mediaBlobUrl && (
                  <audio
                    controls
                    autoPlay
                    src={mediaBlobUrl}
                    className="w-full"
                  />
                )}
              </div>
            </div>
          ) : isVideo ? (
            <div className="flex items-center justify-center h-full">
              {mediaBlobUrl && (
                <video
                  controls
                  autoPlay
                  src={mediaBlobUrl}
                  className="max-h-full max-w-full rounded-lg shadow-md bg-black"
                />
              )}
            </div>
          ) : isHtmlOrMd ? (
            htmlViewMode === 'rendered' ? (
              <div className="flex-1 w-full h-full min-h-[400px] flex flex-col bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                <div className="px-3 py-2 bg-slate-100 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs text-slate-500">
                  <div className="flex items-center gap-1.5 font-mono">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-400 inline-block"></span>
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block"></span>
                    <span className="w-2.5 h-2.5 rounded-full bg-green-400 inline-block"></span>
                    <span className="ml-2 font-semibold text-slate-600 dark:text-slate-300 truncate">
                      {ext === 'md' || ext === 'markdown' ? 'Markdown Rendered' : 'HTML Sandbox'} ({item.name})
                    </span>
                  </div>
                  {mediaBlobUrl && (
                    <a
                      href={mediaBlobUrl}
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
                  title="Document Preview Sandbox"
                  srcDoc={htmlContent}
                  sandbox="allow-same-origin allow-scripts"
                  className="w-full flex-1 border-0 bg-white"
                />
              </div>
            ) : (
              <pre className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-mono whitespace-pre-wrap overflow-auto flex-1 text-slate-800 dark:text-slate-200">
                {textContent || htmlContent}
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
                {Object.keys(spreadsheetData).map((sheetName) => (
                  <button
                    key={sheetName}
                    onClick={() => setActiveSheet(sheetName)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                      activeSheet === sheetName
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    {sheetName}
                  </button>
                ))}
              </div>

              {/* Table rendering */}
              <div className="flex-1 overflow-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
                {spreadsheetData[activeSheet] && spreadsheetData[activeSheet].length > 0 ? (
                  <table className="w-full text-xs text-left border-collapse">
                    <tbody>
                      {spreadsheetData[activeSheet].slice(0, 100).map((row, rIdx) => (
                        <tr key={rIdx} className={rIdx === 0 ? 'bg-slate-100 dark:bg-slate-800/60 font-bold' : 'border-b border-slate-100 dark:border-slate-800/40'}>
                          {row.map((cell, cIdx) => (
                            <td key={cIdx} className="p-2.5 border-r border-slate-100 dark:border-slate-800/40 max-w-[200px] truncate">
                              {cell !== null && cell !== undefined ? String(cell) : ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="p-8 text-center text-xs text-slate-400">
                    {lang === 'ja' ? 'シートにデータがありません' : 'No data in sheet'}
                  </div>
                )}
              </div>
            </div>
          ) : zipEntries.length > 0 ? (
            <div className="flex-1 overflow-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs p-4">
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
                {lang === 'ja' ? `ZIPアーカイブ内ファイル一覧 (${zipEntries.length}件)` : `ZIP Contents (${zipEntries.length} items)`}
              </h4>
              <div className="flex flex-col gap-1.5">
                {zipEntries.map((e, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs py-1.5 px-3 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800/60">
                    <span className="font-mono text-slate-700 dark:text-slate-300 truncate">{e.name}</span>
                    <span className="text-slate-400 shrink-0">{(e.size / 1024).toFixed(1)} KB</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <pre className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 text-xs sm:text-sm font-mono whitespace-pre-wrap overflow-auto flex-1 text-slate-800 dark:text-slate-200">
              {textContent || (lang === 'ja' ? 'プレビューを表示できません。' : 'No preview available.')}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
};
