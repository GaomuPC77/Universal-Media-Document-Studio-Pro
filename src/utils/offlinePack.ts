import JSZip from 'jszip';

export type TargetDeviceOS = 'windows' | 'mac' | 'linux' | 'ios' | 'android' | 'universal';

export interface DeviceOSOption {
  id: TargetDeviceOS;
  nameJa: string;
  nameEn: string;
  badgeJa: string;
  badgeEn: string;
  descriptionJa: string;
  descriptionEn: string;
  iconType: 'windows' | 'apple' | 'linux' | 'smartphone' | 'tablet' | 'globe';
  includedFiles: string[];
}

export const DEVICE_OS_OPTIONS: DeviceOSOption[] = [
  {
    id: 'windows',
    nameJa: 'Windows (PC)',
    nameEn: 'Windows PC',
    badgeJa: '推奨 (.bat 起動)',
    badgeEn: 'Recommended (.bat)',
    descriptionJa: 'ダブルクリックするだけでブラウザが起動する「アプリを起動する.bat」と完全内蔵HTML、起動トラブル対処ガイドを同梱。',
    descriptionEn: 'Includes Windows one-click batch launcher, complete standalone HTML, and troubleshooting README.',
    iconType: 'windows',
    includedFiles: ['converter_core.html', 'アプリを起動する.bat', 'Windows利用手順_トラブル対策.txt'],
  },
  {
    id: 'mac',
    nameJa: 'macOS (MacBook / iMac)',
    nameEn: 'macOS',
    badgeJa: 'Mac最適化 (.command 起動)',
    badgeEn: 'Mac Optimized (.command)',
    descriptionJa: 'macOS標準ターミナルとChrome/Safariと連携して起動できる「アプリを起動する.command」とHTML、Gatekeeper設定ガイドを同梱。',
    descriptionEn: 'Includes macOS double-clickable .command script, standalone HTML, and Gatekeeper permissions guide.',
    iconType: 'apple',
    includedFiles: ['converter_core.html', 'アプリを起動する.command', 'macOS利用手順_権限設定.txt'],
  },
  {
    id: 'linux',
    nameJa: 'Linux (Ubuntu / Debian / Arch)',
    nameEn: 'Linux',
    badgeJa: 'シェルスクリプト同梱',
    badgeEn: 'Shell Script included',
    descriptionJa: 'xdg-open対応のシェルスクリプト「launch_app.sh」とオフラインHTMLパッケージを同梱。',
    descriptionEn: 'Includes xdg-open shell launcher script (launch_app.sh) and complete standalone HTML.',
    iconType: 'linux',
    includedFiles: ['converter_core.html', 'launch_app.sh', 'Linux利用手順.txt'],
  },
  {
    id: 'ios',
    nameJa: 'iPhone / iPad (iOS / iPadOS)',
    nameEn: 'iPhone / iPad (iOS)',
    badgeJa: 'ホーム画面追加・全画面対応',
    badgeEn: 'PWA Home Screen Ready',
    descriptionJa: 'Safariの「ホーム画面に追加」でネイティブアプリのように全画面かつ完全オフラインで動作する専用単一HTMLと手順書を同梱。',
    descriptionEn: 'Optimized for Safari "Add to Home Screen" to run as a full-screen standalone offline app on iOS.',
    iconType: 'tablet',
    includedFiles: ['UMC_Offline_Studio.html', 'iOS_ホーム画面への追加方法.txt'],
  },
  {
    id: 'android',
    nameJa: 'Android (スマートフォン / タブレット)',
    nameEn: 'Android Mobile & Tablet',
    badgeJa: 'PWA・Chrome完全対応',
    badgeEn: 'Chrome PWA Compatible',
    descriptionJa: 'Chromeから「ホーム画面に追加」またはローカルファイル保存で機内モードでも即座に使える専用パッケージと利用ガイド。',
    descriptionEn: 'Optimized for mobile Chrome offline storage and Home Screen shortcut installation.',
    iconType: 'smartphone',
    includedFiles: ['UMC_Offline_Studio.html', 'Android_オフライン利用方法.txt'],
  },
  {
    id: 'universal',
    nameJa: 'すべてのOS・端末共通 (単一HTMLファイル直接取得)',
    nameEn: 'Universal Single-File HTML',
    badgeJa: '単一ファイル直接保存',
    badgeEn: 'Direct Standalone HTML',
    descriptionJa: 'すべてのライブラリを1ファイルに完全に内蔵した「converter_core.html」を直接保存。どの端末・ブラウザでも即座に開けます。',
    descriptionEn: 'Directly download the monolithic single-file converter_core.html. Opens in any web browser without extraction.',
    iconType: 'globe',
    includedFiles: ['converter_core.html'],
  },
];

/**
 * Detect current OS of the user's browser
 */
export function detectCurrentOS(): TargetDeviceOS {
  if (typeof navigator === 'undefined') return 'universal';
  const ua = (navigator.userAgent || '').toLowerCase();
  const platform = ((navigator as any).userAgentData?.platform || navigator.platform || '').toLowerCase();

  if (/iphone|ipad|ipod/i.test(ua)) {
    return 'ios';
  }
  if (/android/i.test(ua)) {
    return 'android';
  }
  if (/win/i.test(platform) || /windows/i.test(ua)) {
    return 'windows';
  }
  if (/mac/i.test(platform) || /macintosh|mac os x/i.test(ua)) {
    return 'mac';
  }
  if (/linux/i.test(platform) || /linux/i.test(ua)) {
    return 'linux';
  }
  return 'universal';
}

/**
 * Fetch or build the monolithic offline HTML content
 */
export async function getOfflineHtmlContent(): Promise<string> {
  let htmlContent = '';

  // 1. Try to fetch pre-bundled single-file from public /converter_core.html
  try {
    const res = await fetch(`/converter_core.html?t=${Date.now()}`);
    if (res.ok) {
      const text = await res.text();
      // Ensure it is a valid HTML file and not a 404 router response
      if (text.includes('<!DOCTYPE html>') && text.includes('Universal Document')) {
        htmlContent = text;
      }
    }
  } catch (e) {
    console.warn('Could not fetch static /converter_core.html:', e);
  }

  // 2. Try fetching from /dist/index.html if available
  if (!htmlContent) {
    try {
      const res = await fetch('/dist/index.html');
      if (res.ok) {
        const text = await res.text();
        if (text.includes('<!DOCTYPE html>')) {
          htmlContent = text;
        }
      }
    } catch (e) {}
  }

  // 3. Fallback to current document if pre-bundled is somehow unavailable
  if (!htmlContent) {
    htmlContent = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
  }

  if (!htmlContent.includes('is-offline-edition')) {
    htmlContent = htmlContent.replace('<body', '<body class="is-offline-edition"');
  }

  const offlineBannerHtml = `
  <!-- Standalone Offline Edition Banner -->
  <div style="background: linear-gradient(90deg, #1e293b, #0f172a); color: #ffffff; padding: 9px 16px; font-weight: 600; font-size: 0.82rem; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); z-index: 9999; text-align: center;">
    <span>【スタンドアロン版】 全機能内蔵（すべてのデータはお使いの端末内で処理されます）</span>
  </div>
`;
  if (!htmlContent.includes('【スタンドアロン版】') && !htmlContent.includes('【完全オフライン動作版】')) {
    htmlContent = htmlContent.replace(/<body[^>]*>/, (match) => `${match}\n${offlineBannerHtml}`);
  }

  return htmlContent;
}

/**
 * Generate a device/OS-tailored Offline Pack Package
 */
export async function generateOfflinePackForOS(
  os: TargetDeviceOS,
  selectedFiles?: string[]
): Promise<{ blob: Blob; fileName: string; isZip: boolean }> {
  const htmlContent = await getOfflineHtmlContent();

  const isIncluded = (name: string) => !selectedFiles || selectedFiles.includes(name);

  if (os === 'universal' || (selectedFiles && selectedFiles.length === 1 && (selectedFiles[0] === 'converter_core.html' || selectedFiles[0] === 'UMC_Offline_Studio.html'))) {
    const singleName = selectedFiles && selectedFiles.length === 1 ? selectedFiles[0] : 'converter_core.html';
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    return {
      blob,
      fileName: singleName,
      isZip: false,
    };
  }

  const zip = new JSZip();

  if (os === 'windows') {
    if (isIncluded('converter_core.html')) {
      zip.file('converter_core.html', htmlContent);
    }

    if (isIncluded('アプリを起動する.bat')) {
      const batContent = `@echo off
chcp 65001 >nul
title Universal Media & Document Studio Pro
echo ========================================================
echo   Universal Media & Document Studio Pro
echo   ブラウザでオフライン版を起動しています...
echo ========================================================
start "" "%~dp0converter_core.html"
exit
`;
      zip.file('アプリを起動する.bat', batContent);
    }

    if (isIncluded('Windows利用手順_トラブル対策.txt')) {
      const readmeContent = `【Universal Media & Document Studio Pro - Windows用オフラインパック】

■ 起動方法:
1. ダウンロードしたZIPファイルを右クリックし「すべて展開」で任意のフォルダ（デスクトップ等）に解凍してください。
2. 解凍されたフォルダ内の「アプリを起動する.bat」をダブルクリックしてください。
3. お使いの既定ブラウザ（Google Chrome, Microsoft Edge等）が開き、オフライン版が起動します。
   ※ インターネット未接続（機内モード）でも動作します。

■ Windows SmartScreenやセキュリティ警告が出た場合:
「WindowsによってPCが保護されました」と青い画面が表示された場合:
1. 「詳細情報」リンクをクリックします。
2. 画面下部に表示される「実行」ボタンをクリックしてください。
※ 本ツールはお使いのローカルブラウザ内で動作し、個人情報やファイルの外部送信は一切行いません。

■ お問い合わせ:
gaomu.pc77.gmail.com
`;
      zip.file('Windows利用手順_トラブル対策.txt', readmeContent);
    }

    const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    return {
      blob: zipBlob,
      fileName: 'UMC_OfflinePack_Windows.zip',
      isZip: true,
    };
  }

  if (os === 'mac') {
    if (isIncluded('converter_core.html')) {
      zip.file('converter_core.html', htmlContent);
    }

    if (isIncluded('アプリを起動する.command')) {
      const commandContent = `#!/bin/bash
DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"
echo "Universal Media & Document Studio Pro を起動しています..."
open "$DIR/converter_core.html"
`;
      zip.file('アプリを起動する.command', commandContent);
    }

    if (isIncluded('macOS利用手順_権限設定.txt')) {
      const readmeContent = `【Universal Media & Document Studio Pro - macOS用オフラインパック】

■ 起動方法:
1. ZIPファイルを展開し、同じフォルダに配置してください。
2. 「アプリを起動する.command」をダブルクリックするか、「converter_core.html」をSafariまたはChromeにドラッグ＆ドロップして開いてください。

■ .command 実行時に「開発元が未確認のため開けません」と警告される場合:
1. 「アプリを起動する.command」を [Control] キーを押しながらクリック（右クリック）します。
2. コンテキストメニューから「開く」を選択し、確認ダイアログで「開く」をクリックしてください。
3. または、ターミナルで以下を実行して実行権限を付与してください:
   chmod +x アプリを起動する.command

■ お問い合わせ:
gaomu.pc77.gmail.com
`;
      zip.file('macOS利用手順_権限設定.txt', readmeContent);
    }

    const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    return {
      blob: zipBlob,
      fileName: 'UMC_OfflinePack_macOS.zip',
      isZip: true,
    };
  }

  if (os === 'linux') {
    if (isIncluded('converter_core.html')) {
      zip.file('converter_core.html', htmlContent);
    }

    if (isIncluded('launch_app.sh')) {
      const shContent = `#!/bin/sh
SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
echo "Launching Universal Media & Document Studio Pro..."
if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$SCRIPT_DIR/converter_core.html"
elif command -v google-chrome >/dev/null 2>&1; then
    google-chrome "$SCRIPT_DIR/converter_core.html"
elif command -v firefox >/dev/null 2>&1; then
    firefox "$SCRIPT_DIR/converter_core.html"
else
    echo "Please open converter_core.html in your preferred browser."
fi
`;
      zip.file('launch_app.sh', shContent);
    }

    if (isIncluded('Linux利用手順.txt')) {
      const readmeContent = `[Universal Media & Document Studio Pro - Linux Offline Pack]

How to Run:
1. Extract the ZIP archive: unzip UMC_OfflinePack_Linux.zip
2. Make the script executable: chmod +x launch_app.sh
3. Run the script: ./launch_app.sh
   (Or open converter_core.html directly in Firefox, Chrome, or Chromium)

Contact: gaomu.pc77.gmail.com
`;
      zip.file('Linux利用手順.txt', readmeContent);
    }

    const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    return {
      blob: zipBlob,
      fileName: 'UMC_OfflinePack_Linux.zip',
      isZip: true,
    };
  }

  if (os === 'ios') {
    if (isIncluded('UMC_Offline_Studio.html')) {
      zip.file('UMC_Offline_Studio.html', htmlContent);
    }

    if (isIncluded('iOS_ホーム画面への追加方法.txt')) {
      const readmeContent = `【Universal Media & Document Studio Pro - iPhone / iPad (iOS) ご利用手順】

■ オフラインで常に利用可能にする方法（PWAホーム画面追加）:
1. 「UMC_Offline_Studio.html」ファイルを iPhone/iPad の「ファイル」アプリに保存します。
2. ファイルをタップして Safari で開きます。
3. 画面下部（iPadは上部）の共有アイコン（四角から矢印が上に出ているアイコン）をタップします。
4. メニューから「ホーム画面に追加」を選択します。
5. ホーム画面に専用アイコンが追加され、電波のないオフライン環境（機内モード）でも単独アプリとして起動します。

※ データやファイルはすべてお使いの端末内で処理され、外部通信は一切発生しません。

■ お問い合わせ:
gaomu.pc77.gmail.com
`;
      zip.file('iOS_ホーム画面への追加方法.txt', readmeContent);
    }

    const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    return {
      blob: zipBlob,
      fileName: 'UMC_OfflinePack_iOS.zip',
      isZip: true,
    };
  }

  if (os === 'android') {
    if (isIncluded('UMC_Offline_Studio.html')) {
      zip.file('UMC_Offline_Studio.html', htmlContent);
    }

    if (isIncluded('Android_オフライン利用方法.txt')) {
      const readmeContent = `【Universal Media & Document Studio Pro - Android端末 ご利用手順】

■ オフラインで常に利用可能にする方法:
1. 「UMC_Offline_Studio.html」を端末の「ダウンロード」フォルダ等に保存します。
2. Chromeブラウザで開きます。
3. 右上の「︙（メニュー）」をタップし、「ホーム画面に追加」または「アプリをインストール」を選択します。
4. ホーム画面にアイコンが追加され、オフラインでも即座に全機能が利用可能になります。

■ お問い合わせ:
gaomu.pc77.gmail.com
`;
      zip.file('Android_オフライン利用方法.txt', readmeContent);
    }

    const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    return {
      blob: zipBlob,
      fileName: 'UMC_OfflinePack_Android.zip',
      isZip: true,
    };
  }

  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  return {
    blob,
    fileName: 'converter_core.html',
    isZip: false,
  };
}

/**
 * Legacy download handler with fallback
 */
export async function downloadOfflinePack(): Promise<boolean> {
  const { blob, fileName } = await generateOfflinePackForOS('windows');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}
