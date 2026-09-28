/**
 * Export a self-contained standalone Single-File HTML Offline Pack
 * Exact implementation matching the reference code
 */
export async function downloadOfflinePack(): Promise<void> {
  const htmlContent = "<!DOCTYPE html>\n" + document.documentElement.outerHTML;
  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Universal_Document_PDF_Studio_Pro_Offline.html';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

