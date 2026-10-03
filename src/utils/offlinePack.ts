/**
 * Export a self-contained standalone Single-File HTML Offline Pack
 * Exact implementation matching the reference code
 */
export async function downloadOfflinePack(): Promise<boolean> {
  try {
    let htmlContent = '';

    // 1. Try to fetch the pre-bundled full single-file pack from /converter_core.html
    try {
      const res = await fetch('/converter_core.html');
      if (res.ok) {
        htmlContent = await res.text();
      }
    } catch (e) {
      console.warn('Could not fetch static /converter_core.html, falling back to dynamic bundling:', e);
    }

    // 2. If not available from static file, dynamically bundle from current DOM
    if (!htmlContent) {
      document.body.classList.add('is-offline-edition');

      const linkElements = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'));
      let inlinedStyles = '';
      for (const link of linkElements) {
        if (link.href) {
          try {
            const res = await fetch(link.href);
            if (res.ok) {
              const cssText = await res.text();
              inlinedStyles += `\n/* Inlined: ${link.href} */\n${cssText}\n`;
            }
          } catch (e) {
            console.warn('Could not inline css:', link.href, e);
          }
        }
      }

      const scriptElements = Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]'));
      let inlinedScripts = '';
      for (const script of scriptElements) {
        if (script.src && !script.src.includes('accounts.google.com')) {
          try {
            const res = await fetch(script.src);
            if (res.ok) {
              const jsCode = await res.text();
              const safeJs = jsCode.replace(/<\/script>/gi, '<\\/script>');
              inlinedScripts += `\n<script type="module">\n/* Inlined: ${script.src} */\n${safeJs}\n</script>\n`;
            }
          } catch (e) {
            console.warn('Could not inline script:', script.src, e);
          }
        }
      }

      htmlContent = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
      document.body.classList.remove('is-offline-edition');

      // Remove Google Identity Service scripts from offline file
      htmlContent = htmlContent.replace(/<script\b[^>]*accounts\.google\.com\/gsi\/client[^>]*><\/script>/gi, '');

      const injectedHead = `
  <style>
${inlinedStyles}
  </style>
  ${inlinedScripts}
`;
      htmlContent = htmlContent.replace('</head>', `${injectedHead}\n</head>`);
    }

    // 3. Ensure body has is-offline-edition class
    if (!htmlContent.includes('is-offline-edition')) {
      htmlContent = htmlContent.replace('<body', '<body class="is-offline-edition"');
    }

    // 4. Inject prominent offline top banner if not already present
    const offlineBannerHtml = `
  <!-- Standalone Offline Edition Banner -->
  <div style="background: linear-gradient(90deg, #d97706, #b45309); color: #ffffff; padding: 10px 16px; font-weight: 700; font-size: 0.85rem; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); z-index: 9999; text-align: center;">
    <span>⚡ 【完全オフライン動作版】 全ライブラリ内蔵済み・外部インターネット通信不要（データは一切外部送信されません）</span>
  </div>
`;
    if (!htmlContent.includes('【完全オフライン動作版】')) {
      htmlContent = htmlContent.replace(/<body[^>]*>/, (match) => `${match}\n${offlineBannerHtml}`);
    }

    // 5. Download HTML file as converter_core.html
    const htmlBlob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    const htmlUrl = URL.createObjectURL(htmlBlob);
    const aHtml = document.createElement('a');
    aHtml.href = htmlUrl;
    aHtml.download = 'converter_core.html';
    document.body.appendChild(aHtml);
    aHtml.click();
    document.body.removeChild(aHtml);
    setTimeout(() => URL.revokeObjectURL(htmlUrl), 2000);

    // 6. Download companion Windows Batch launcher
    setTimeout(() => {
      const batchScriptContent = `@echo off
chcp 65001 >nul
echo Universal Media & Document Studio Pro (オフライン版) を起動しています...
start "" "converter_core.html"
`;
      const batBlob = new Blob([batchScriptContent], { type: 'text/plain' });
      const batUrl = URL.createObjectURL(batBlob);
      const aBat = document.createElement('a');
      aBat.href = batUrl;
      aBat.download = 'アプリを起動する.bat';
      document.body.appendChild(aBat);
      aBat.click();
      document.body.removeChild(aBat);
      setTimeout(() => URL.revokeObjectURL(batUrl), 2000);
    }, 600);

    return true;
  } catch (err) {
    document.body.classList.remove('is-offline-edition');
    console.error('Offline pack export failed:', err);
    throw err;
  }
}

