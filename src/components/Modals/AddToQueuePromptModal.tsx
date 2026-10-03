import React from 'react';
import { Layers, Plus } from 'lucide-react';

interface AddToQueuePromptModalProps {
  file: File | null;
  isOpen: boolean;
  onConfirmAddToQueue: () => void;
  onUseLocalOnly: () => void;
  lang: 'ja' | 'en';
}

export const AddToQueuePromptModal: React.FC<AddToQueuePromptModalProps> = ({
  file,
  isOpen,
  onConfirmAddToQueue,
  onUseLocalOnly,
  lang,
}) => {
  if (!isOpen || !file) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl flex flex-col gap-4 animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-bold text-sm sm:text-base text-slate-800 dark:text-slate-100">
              {lang === 'ja' ? 'キューへの追加確認' : 'Add to Status Queue?'}
            </h4>
            <p className="text-xs text-slate-500 mt-0.5 line-clamp-1 font-mono">
              {file.name} ({(file.size / 1024).toFixed(1)} KB)
            </p>
          </div>
        </div>

        <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          {lang === 'ja'
            ? 'アップロードしたファイルを「変換・処理ステータス（全体キュー）」にも追加しますか？追加すると、他のタブや一括ダウンロードでも利用できるようになります。'
            : 'Would you like to add this uploaded file to the global Conversion/Processing Status queue as well?'}
        </p>

        <div className="flex items-center justify-end gap-2.5 pt-2">
          <button
            onClick={onUseLocalOnly}
            className="px-4 py-2 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
          >
            {lang === 'ja' ? 'このタブのみで使用' : 'Use in this tab only'}
          </button>
          <button
            onClick={onConfirmAddToQueue}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-sm flex items-center gap-1.5 transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{lang === 'ja' ? '全体キューにも追加' : 'Add to Global Queue'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
