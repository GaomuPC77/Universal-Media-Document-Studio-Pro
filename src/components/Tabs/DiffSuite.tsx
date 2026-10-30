import React, { useState, useRef, useEffect } from 'react';
import { GitCompare, Upload, FileText, ArrowRight, Download, CheckCircle2, RefreshCw } from 'lucide-react';
import { compareTextLines, DiffResult } from '../../utils/diffUtils';
import { extractPdfText } from '../../utils/pdfUtils';
import { docxToText } from '../../utils/officeUtils';
import { saveProcessedFile } from '../../utils/historyDb';
import { FileItem } from '../../types';
import { notifyCompletion } from '../../utils/notification';
import { AddToQueuePromptModal } from '../Modals/AddToQueuePromptModal';

interface DiffSuiteProps {
  lang: 'ja' | 'en';
  sharedFile?: File | null;
  fileList?: FileItem[];
  onResultReady?: (item: FileItem) => void;
  onShowToast?: (msg: string) => void;
  onAddFiles?: (files: File[]) => void;
}

export const DiffSuite: React.FC<DiffSuiteProps> = ({
  lang,
  sharedFile,
  fileList = [],
  onResultReady,
  onShowToast,
  onAddFiles,
}) => {
  const [oldFileId, setOldFileId] = useState<string>('');
  const [newFileId, setNewFileId] = useState<string>('');
  const [pendingPromptFile, setPendingPromptFile] = useState<{ file: File; target: 'old' | 'new' } | null>(null);
  const [oldText, setOldText] = useState<string>(
    `第1条（目的）\n甲は乙に対し、本契約に基づき業務を委託するものとする。\n\n第2条（委託料）\n委託料は月額100,000円（税別）とし、月末締めの翌月末払いとする。\n\n第3条（期間）\n本契約の有効期間は2026年4月1日から1年間とする。`
  );

  const [newText, setNewText] = useState<string>(
    `第1条（目的）\n甲は乙に対し、本契約に基づきシステム開発業務を委託するものとする。\n\n第2条（委託料）\n委託料は月額120,000円（税別）とし、月末締めの翌月25日払いとする。\n\n第3条（期間）\n本契約の有効期間は2026年4月1日から2年間とする。\n\n第4条（秘密保持）\n甲及び乙は知り得た機密情報を第三者に開示してはならない。`
  );

  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);

  const fileInputOldRef = useRef<HTMLInputElement>(null);
  const fileInputNewRef = useRef<HTMLInputElement>(null);

  // Auto load shared file into new revision text
  useEffect(() => {
    if (sharedFile) {
      loadTextFromFile(sharedFile).then((txt) => {
        if (txt) {
          setNewText(txt);
          const res = compareTextLines(oldText, txt);
          setDiffResult(res);
        }
      });
    }
  }, [sharedFile]);

  // Load text from file (PDF, Docx, or Text)
  const loadTextFromFile = async (file: File): Promise<string> => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (ext === 'pdf') {
      return await extractPdfText(file);
    }
    if (ext === 'docx') {
      return await docxToText(file);
    }
    return await file.text();
  };

  const handleComputeDiff = () => {
    const res = compareTextLines(oldText, newText);
    setDiffResult(res);
    if (onShowToast) onShowToast(lang === 'ja' ? '差分を解析しました' : 'Diff computed');
  };

  const handleExportDiffHtml = async () => {
    if (!diffResult) return;
    const reportHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Document Diff Report</title>
  <style>
    body { font-family: sans-serif; padding: 24px; background: #f8fafc; color: #0f172a; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 6px; font-weight: bold; font-size: 12px; margin-right: 8px; }
    .added { background: #dcfce7; color: #166534; }
    .removed { background: #fee2e2; color: #991b1b; }
    .line { display: flex; padding: 4px 8px; font-family: monospace; font-size: 13px; border-bottom: 1px solid #e2e8f0; }
    .line.add { background: #dcfce7; }
    .line.rem { background: #fee2e2; text-decoration: line-through; }
  </style>
</head>
<body>
  <h2>ドキュメント差分比較レポート (Document Diff Report)</h2>
  <div style="margin-bottom: 16px;">
    <span class="badge added">+${diffResult.addedCount} lines added</span>
    <span class="badge removed">-${diffResult.removedCount} lines removed</span>
    <span>${diffResult.unchangedCount} lines unchanged</span>
  </div>
  <div style="background: white; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden;">
    ${diffResult.changes
      .map(
        (c) =>
          `<div class="line ${c.type === 'added' ? 'add' : c.type === 'removed' ? 'rem' : ''}">
            <span style="width: 24px;">${c.type === 'added' ? '+' : c.type === 'removed' ? '-' : ' '}</span>
            <span>${c.value.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span>
          </div>`
      )
      .join('')}
  </div>
</body>
</html>`;

    const blob = new Blob([reportHtml], { type: 'text/html;charset=utf-8' });
    const resultName = `Diff_Report_${new Date().toISOString().slice(0, 10)}.html`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = resultName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    await saveProcessedFile(`diff_${Date.now()}`, 'diff_compare', resultName, blob, 'html');
    if (onResultReady) {
      onResultReady({
        id: `res_diff_${Date.now()}`,
        name: resultName,
        file: new File([blob], resultName, { type: 'text/html' }),
        size: blob.size,
        type: 'text/html',
        format: 'html',
        targetFormat: 'html',
        status: 'done',
        progress: 100,
        resultBlob: blob,
        resultName,
      });
    }

    notifyCompletion(lang === 'ja' ? '差分レポートを出力しました' : 'Diff Report Exported', resultName);
    if (onShowToast) onShowToast(lang === 'ja' ? `「${resultName}」を作成しました` : `Saved "${resultName}"`);
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col gap-6 max-w-5xl mx-auto">
      {/* Add To Queue Confirmation Modal */}
      <AddToQueuePromptModal
        file={pendingPromptFile?.file || null}
        isOpen={!!pendingPromptFile}
        lang={lang}
        onConfirmAddToQueue={async () => {
          if (!pendingPromptFile) return;
          const { file, target } = pendingPromptFile;
          if (onAddFiles) {
            onAddFiles([file]);
          }
          const text = await loadTextFromFile(file);
          if (target === 'old') {
            setOldText(text);
          } else {
            setNewText(text);
          }
          if (onShowToast) {
            onShowToast(lang === 'ja' ? '変換・処理ステータス（全体キュー）に追加しました' : 'Added to global status queue');
          }
          setPendingPromptFile(null);
        }}
        onUseLocalOnly={async () => {
          if (!pendingPromptFile) return;
          const { file, target } = pendingPromptFile;
          const text = await loadTextFromFile(file);
          if (target === 'old') {
            setOldText(text);
          } else {
            setNewText(text);
          }
          if (onShowToast) {
            onShowToast(lang === 'ja' ? 'このタブのみに読み込みました' : 'Loaded into this tab only');
          }
          setPendingPromptFile(null);
        }}
      />

      <div>
        <h3 className="font-bold text-sm sm:text-base text-slate-800 dark:text-slate-100">
          {lang === 'ja' ? 'ドキュメント・テキスト差分比較ツール (Diff Studio)' : 'Document & Text Diff Comparison'}
        </h3>
        <p className="text-xs text-slate-500 mt-0.5">
          {lang === 'ja'
            ? '2つの契約書・ドキュメント（PDF, Word, TXT, Markdown）の変更点を瞬時に行単位・文字単位で比較します。'
            : 'Compare two documents (PDF, Word, TXT, MD) line-by-line with visual highlights.'}
        </p>
      </div>

      {/* Select from loaded files */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700">
        <div>
          <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
            {lang === 'ja' ? '変更前の文書を選択:' : 'Select Original Document:'}
          </label>
          <select
            value={oldFileId}
            onChange={async (e) => {
              const id = e.target.value;
              if (id === '__upload_new__') {
                fileInputOldRef.current?.click();
                return;
              }
              setOldFileId(id);
              const found = fileList.find((f) => f.id === id);
              if (found && found.file) {
                const txt = await loadTextFromFile(found.file);
                setOldText(txt);
              }
            }}
            className="main-select text-xs mb-0"
          >
            <option value="">{lang === 'ja' ? '-- アップロードされた文書を選択 --' : '-- Select Uploaded Document --'}</option>
            <option value="__upload_new__">
              {lang === 'ja' ? '📁 ＋ 新しい文書を端末からアップロード...' : '📁 + Upload New Document File...'}
            </option>
            {fileList
              .filter((f) =>
                ['txt', 'md', 'markdown', 'html', 'htm', 'csv', 'tsv', 'json', 'docx', 'doc', 'pdf', 'xml', 'js', 'ts', 'css'].includes(f.format?.toLowerCase() || '') ||
                /\.(txt|md|markdown|html?|csv|tsv|json|docx?|pdf|xml|js|ts|css)$/i.test(f.name)
              )
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
          </select>
        </div>

        <div>
          <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
            {lang === 'ja' ? '変更後の文書を選択:' : 'Select Modified Document:'}
          </label>
          <select
            value={newFileId}
            onChange={async (e) => {
              const id = e.target.value;
              if (id === '__upload_new__') {
                fileInputNewRef.current?.click();
                return;
              }
              setNewFileId(id);
              const found = fileList.find((f) => f.id === id);
              if (found && found.file) {
                const txt = await loadTextFromFile(found.file);
                setNewText(txt);
              }
            }}
            className="main-select text-xs mb-0"
          >
            <option value="">{lang === 'ja' ? '-- アップロードされた文書を選択 --' : '-- Select Uploaded Document --'}</option>
            <option value="__upload_new__">
              {lang === 'ja' ? '📁 ＋ 新しい文書を端末からアップロード...' : '📁 + Upload New Document File...'}
            </option>
            {fileList
              .filter((f) =>
                ['txt', 'md', 'markdown', 'html', 'htm', 'csv', 'tsv', 'json', 'docx', 'doc', 'pdf', 'xml', 'js', 'ts', 'css'].includes(f.format?.toLowerCase() || '') ||
                /\.(txt|md|markdown|html?|csv|tsv|json|docx?|pdf|xml|js|ts|css)$/i.test(f.name)
              )
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
          </select>
        </div>
      </div>

      {/* Inputs Side-by-side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Old version */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
              {lang === 'ja' ? '変更前 (元の文書)' : 'Original (Old)'}
            </span>
            <button
              onClick={() => fileInputOldRef.current?.click()}
              className="text-xs text-blue-600 dark:text-blue-400 font-semibold underline"
            >
              {lang === 'ja' ? 'ファイルから読込' : 'Load from file'}
            </button>
            <input
              ref={fileInputOldRef}
              type="file"
              accept=".pdf,.docx,.txt,.md,.json,.html"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  setPendingPromptFile({ file: e.target.files[0], target: 'old' });
                  e.target.value = '';
                }
              }}
            />
          </div>
          <textarea
            value={oldText}
            onChange={(e) => setOldText(e.target.value)}
            rows={8}
            className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono text-xs text-slate-800 dark:text-slate-200 outline-none focus:border-blue-500"
          />
        </div>

        {/* New version */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
              {lang === 'ja' ? '変更後 (新しい文書)' : 'Modified (New)'}
            </span>
            <button
              onClick={() => fileInputNewRef.current?.click()}
              className="text-xs text-blue-600 dark:text-blue-400 font-semibold underline"
            >
              {lang === 'ja' ? 'ファイルから読込' : 'Load from file'}
            </button>
            <input
              ref={fileInputNewRef}
              type="file"
              accept=".pdf,.docx,.txt,.md,.json,.html"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  setPendingPromptFile({ file: e.target.files[0], target: 'new' });
                  e.target.value = '';
                }
              }}
            />
          </div>
          <textarea
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            rows={8}
            className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono text-xs text-slate-800 dark:text-slate-200 outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* Compare Action */}
      <div className="flex justify-center">
        <button
          onClick={handleComputeDiff}
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-md shadow-blue-500/20 transition"
        >
          <GitCompare className="w-4 h-4" />
          <span>{lang === 'ja' ? '差分を比較して表示' : 'Compare Documents'}</span>
        </button>
      </div>

      {/* Results View */}
      {diffResult && (
        <div className="flex flex-col gap-3 pt-3 border-t border-slate-200 dark:border-slate-800 animate-fade-in">
          {/* Summary Badges & Export Button */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-bold">
            <div className="flex items-center gap-3">
              <span className="px-2.5 py-1 rounded-md bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                +{diffResult.addedCount} {lang === 'ja' ? '行追加' : 'lines added'}
              </span>
              <span className="px-2.5 py-1 rounded-md bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">
                -{diffResult.removedCount} {lang === 'ja' ? '行削除' : 'lines removed'}
              </span>
              <span className="text-slate-500">
                {diffResult.unchangedCount} {lang === 'ja' ? '行変更なし' : 'lines unchanged'}
              </span>
            </div>

            <button
              onClick={handleExportDiffHtml}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{lang === 'ja' ? 'HTML差分レポートを保存' : 'Export HTML Report'}</span>
            </button>
          </div>

          {/* Diff Lines Table */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-slate-50 dark:bg-slate-950 font-mono text-xs max-h-96 overflow-auto">
            {diffResult.changes.map((c, idx) => (
              <div
                key={idx}
                className={`flex items-start px-3 py-1.5 border-b border-slate-200/50 dark:border-slate-800/50 ${
                  c.type === 'added'
                    ? 'bg-emerald-500/15 text-emerald-900 dark:text-emerald-200 font-semibold'
                    : c.type === 'removed'
                    ? 'bg-red-500/15 text-red-900 dark:text-red-200 line-through font-semibold'
                    : 'text-slate-700 dark:text-slate-300'
                }`}
              >
                <span className="w-6 flex-shrink-0 select-none font-bold">
                  {c.type === 'added' ? '+' : c.type === 'removed' ? '-' : ' '}
                </span>
                <span className="w-12 text-slate-400 text-[11px] flex-shrink-0 select-none">
                  {c.lineNumberOld || c.lineNumberNew || ''}
                </span>
                <span className="whitespace-pre-wrap flex-1">{c.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
