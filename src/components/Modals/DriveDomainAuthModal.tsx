import React, { useState } from 'react';
import {
  X,
  Copy,
  Check,
  ExternalLink,
  ShieldAlert,
  Key,
  Globe,
  ArrowRight,
  RefreshCw,
  Info,
} from 'lucide-react';
import { setManualAccessToken, fetchDriveUserInfo } from '../../utils/googleDrive';
import firebaseConfig from '../../../firebase-applet-config.json';

interface DriveDomainAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang: 'ja' | 'en';
  onRetryConnect?: () => void;
  onConnectedSuccess?: () => void;
  initialDomain?: string;
}

export const DriveDomainAuthModal: React.FC<DriveDomainAuthModalProps> = ({
  isOpen,
  onClose,
  lang,
  onRetryConnect,
  onConnectedSuccess,
  initialDomain,
}) => {
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://universal-media-document-studio-pro.vercel.app';
  const currentHost = initialDomain || (typeof window !== 'undefined' ? window.location.hostname : 'universal-media-document-studio-pro.vercel.app');
  const [copiedOrigin, setCopiedOrigin] = useState(false);
  const [copiedHost, setCopiedHost] = useState(false);
  const [activeTab, setActiveTab] = useState<'guide' | 'token'>('guide');
  const [manualToken, setManualToken] = useState('');
  const [isVerifyingToken, setIsVerifyingToken] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  if (!isOpen) return null;

  const projectId = firebaseConfig.projectId || 'gen-lang-client-0684708643';
  const cloudCredentialsUrl = `https://console.cloud.google.com/apis/credentials?project=${projectId}`;
  const firebaseSettingsUrl = `https://console.firebase.google.com/project/${projectId}/authentication/settings`;

  const handleCopyOrigin = () => {
    navigator.clipboard.writeText(currentOrigin);
    setCopiedOrigin(true);
    setTimeout(() => setCopiedOrigin(false), 2500);
  };

  const handleCopyHost = () => {
    navigator.clipboard.writeText(currentHost);
    setCopiedHost(true);
    setTimeout(() => setCopiedHost(false), 2500);
  };

  const handleApplyToken = async () => {
    if (!manualToken.trim()) {
      setTokenError(lang === 'ja' ? 'アクセストークンを入力してください' : 'Please enter an access token');
      return;
    }
    setIsVerifyingToken(true);
    setTokenError(null);
    try {
      const ok = await setManualAccessToken(manualToken.trim());
      if (ok) {
        if (onConnectedSuccess) onConnectedSuccess();
        onClose();
      } else {
        setTokenError(lang === 'ja' ? 'トークンを検証できませんでした' : 'Failed to verify token');
      }
    } catch (e: any) {
      setTokenError(e?.message || (lang === 'ja' ? 'トークンが無効または期限切れです' : 'Invalid or expired token'));
    } finally {
      setIsVerifyingToken(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-blue-500/5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-600 dark:text-blue-400">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm sm:text-base text-slate-800 dark:text-slate-100">
                {lang === 'ja' ? 'Google ドライブ連携のドメイン承認アシスタント' : 'Google Drive Domain Authorization Guide'}
              </h3>
              <p className="text-xs text-slate-500">
                {lang === 'ja'
                  ? 'Vercel（本番環境）からGoogleドライブと直接連携するための設定'
                  : 'Configure authorized domain for Google Cloud OAuth & Drive API'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 px-4 pt-2 gap-2 bg-slate-50/50 dark:bg-slate-900/50 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('guide')}
            className={`pb-2.5 px-3 border-b-2 flex items-center gap-1.5 transition cursor-pointer ${
              activeTab === 'guide'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>{lang === 'ja' ? 'Google Cloud承認設定 (推奨・1分)' : 'Google Cloud Domain Setup'}</span>
          </button>
          <button
            onClick={() => setActiveTab('token')}
            className={`pb-2.5 px-3 border-b-2 flex items-center gap-1.5 transition cursor-pointer ${
              activeTab === 'token'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Key className="w-3.5 h-3.5" />
            <span>{lang === 'ja' ? 'トークンで今すぐ接続 (設定変更不要)' : 'Instant Connect via Token'}</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-5 overflow-y-auto flex flex-col gap-4 text-xs leading-relaxed">
          {activeTab === 'guide' ? (
            <>
              {/* Notice Banner */}
              <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/60 rounded-xl text-blue-900 dark:text-blue-200 flex flex-col gap-1.5">
                <div className="font-bold flex items-center gap-1.5">
                  <Info className="w-4 h-4 text-blue-600 flex-shrink-0" />
                  <span>
                    {lang === 'ja'
                      ? '直接Google Cloud OAuthによる安全な連携'
                      : 'Direct Google Cloud OAuth Authentication'}
                  </span>
                </div>
                <p className="text-[11px] text-blue-800/90 dark:text-blue-300/90">
                  {lang === 'ja'
                    ? 'Firebaseの仲介画面（*.firebaseapp.com）やプロフィール共有画面を経由せず、本サイト（Vercel）とGoogleドライブを直接接続します。Google Cloud ConsoleのOAuthクライアントに本サイトのURLを1回追加するだけで、永続的に直接連携可能になります。'
                    : 'Connect directly between Vercel and Google Drive without Firebase intermediary redirects. Whitelist this origin in Google Cloud Console once.'}
                </p>
              </div>

              {/* Current Domain Box with 1-click copy */}
              <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-500 font-medium">
                    {lang === 'ja' ? '追加するURL（承認済みのJavaScript生成元）:' : 'Authorized JavaScript Origin to Add:'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
                  <span className="font-mono font-bold text-xs sm:text-sm text-blue-600 dark:text-blue-400 select-all truncate">
                    {currentOrigin}
                  </span>
                  <button
                    onClick={handleCopyOrigin}
                    className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white font-medium flex items-center gap-1 text-[11px] transition cursor-pointer whitespace-nowrap"
                  >
                    {copiedOrigin ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedOrigin ? (lang === 'ja' ? '完了' : 'Copied!') : lang === 'ja' ? 'コピー' : 'Copy'}</span>
                  </button>
                </div>
              </div>

              {/* Steps */}
              <div className="flex flex-col gap-2.5">
                <div className="font-bold text-slate-800 dark:text-slate-200">
                  {lang === 'ja' ? 'Google Cloud Console での承認手順:' : 'Google Cloud Console Setup Steps:'}
                </div>

                {/* Step 1 */}
                <div className="flex gap-2.5 items-start p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                  <div className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 font-bold flex items-center justify-center shrink-0 text-xs">
                    1
                  </div>
                  <div className="flex-1 flex flex-col gap-1">
                    <p className="font-semibold text-slate-800 dark:text-slate-100">
                      {lang === 'ja' ? 'Google Cloud 認証情報コンソールを開く' : 'Open Google Cloud Credentials'}
                    </p>
                    <a
                      href={cloudCredentialsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 font-semibold hover:underline text-xs"
                    >
                      <span>{lang === 'ja' ? 'Google Cloud 認証情報設定を開く' : 'Open Google Cloud Credentials Console'}</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="flex gap-2.5 items-start p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                  <div className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 font-bold flex items-center justify-center shrink-0 text-xs">
                    2
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-slate-800 dark:text-slate-100">
                      {lang === 'ja' ? 'OAuth 2.0 クライアント ID をクリック' : 'Click OAuth 2.0 Client ID'}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {lang === 'ja'
                        ? '一覧に表示されている Web アプリケーション用クライアント ID を選択します。'
                        : 'Select the Web application client ID from the list.'}
                    </p>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="flex gap-2.5 items-start p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                  <div className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 font-bold flex items-center justify-center shrink-0 text-xs">
                    3
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-slate-800 dark:text-slate-100">
                      {lang === 'ja' ? '「承認済みの JavaScript 生成元」に本サイトURLを追加して保存' : 'Add URL to "Authorized JavaScript origins" and Save'}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {lang === 'ja'
                        ? '「URI を追加」を押し、コピーした URL (https://universal-media-document-studio-pro.vercel.app) を貼り付けて「保存」をクリックします。'
                        : 'Click "Add URI", paste https://universal-media-document-studio-pro.vercel.app, and click Save.'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Retry button */}
              <div className="pt-2 flex items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  onClick={() => setActiveTab('token')}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium cursor-pointer"
                >
                  {lang === 'ja' ? '設定変更せずに今すぐ接続する →' : 'Connect instantly with token →'}
                </button>

                <button
                  onClick={() => {
                    if (onRetryConnect) onRetryConnect();
                    onClose();
                  }}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>{lang === 'ja' ? '再接続を試す' : 'Retry Sign-in'}</span>
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Token Input Tab */}
              <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/60 rounded-xl text-blue-900 dark:text-blue-200 flex flex-col gap-1.5">
                <div className="font-bold flex items-center gap-1.5">
                  <Key className="w-4 h-4 text-blue-600 flex-shrink-0" />
                  <span>{lang === 'ja' ? 'アクセストークンによるダイレクト接続' : 'Direct Access Token Connection'}</span>
                </div>
                <p className="text-[11px] text-blue-800/90 dark:text-blue-300/90">
                  {lang === 'ja'
                    ? 'Firebase Consoleの設定を変更することなく、Google OAuthのアクセストークンを直接入力して即座にGoogle Drive連携を開始できます。'
                    : 'Paste a Google OAuth access token to connect immediately without changing Firebase domain settings.'}
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="font-bold text-slate-700 dark:text-slate-300">
                  {lang === 'ja' ? 'Google OAuth アクセストークン (Bearer Token):' : 'Google OAuth Access Token:'}
                </label>
                <textarea
                  value={manualToken}
                  onChange={(e) => setManualToken(e.target.value)}
                  placeholder="ya29.a0..."
                  rows={3}
                  className="w-full p-2.5 font-mono text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:border-blue-500 outline-none"
                />
                {tokenError && (
                  <p className="text-[11px] text-rose-600 font-semibold mt-0.5">
                    {tokenError}
                  </p>
                )}
              </div>

              <p className="text-[11px] text-slate-500">
                {lang === 'ja'
                  ? '※ トークンはブラウザのメモリ内のみで保持され、サーバーや外部ストレージには保存されません。'
                  : 'Tokens are held exclusively in browser memory and never stored in persistent storage.'}
              </p>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  onClick={() => setActiveTab('guide')}
                  className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold"
                >
                  {lang === 'ja' ? '戻る' : 'Back'}
                </button>
                <button
                  onClick={handleApplyToken}
                  disabled={isVerifyingToken || !manualToken.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {isVerifyingToken ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>{lang === 'ja' ? '確認中...' : 'Verifying...'}</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>{lang === 'ja' ? 'トークンを適用して接続' : 'Apply & Connect'}</span>
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
