import React, { useState, useRef, useEffect } from 'react';
import { GitCompare, Upload, FileText, ArrowRight, Download, CheckCircle2 } from 'lucide-react';
import { compareTextLines, DiffResult } from '../../utils/diffUtils';
import { extractPdfText } from '../../utils/pdfUtils';
import { docxToText } from '../../utils/officeUtils';

interface DiffSuiteProps {
  lang: 'ja' | 'en';
  sharedFile?: File | null;
}

export const DiffSuite: React.FC<DiffSuiteProps> = ({ lang, sharedFile }) => {
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
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col gap-6 max-w-5xl mx-auto">
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
              onChange={async (e) => {
                if (e.target.files && e.target.files[0]) {
                  const text = await loadTextFromFile(e.target.files[0]);
                  setOldText(text);
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
              onChange={async (e) => {
                if (e.target.files && e.target.files[0]) {
                  const text = await loadTextFromFile(e.target.files[0]);
                  setNewText(text);
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
          {/* Summary Badges */}
          <div className="flex items-center gap-3 text-xs font-bold">
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
