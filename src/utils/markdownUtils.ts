/**
 * Client-Side Markdown Parser & HTML Generator
 */

export function parseMarkdownToHtml(markdown: string): string {
  if (!markdown) return '';

  let html = markdown
    // Escape HTML special characters
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

    // Headers (# H1, ## H2, ### H3, #### H4)
    .replace(/^#### (.*$)/gim, '<h4 style="font-size:1.05rem; font-weight:700; margin:16px 0 6px; color:#334155;">$1</h4>')
    .replace(/^### (.*$)/gim, '<h3 style="font-size:1.2rem; font-weight:700; margin:20px 0 8px; color:#1e293b;">$1</h3>')
    .replace(/^## (.*$)/gim, '<h2 style="font-size:1.4rem; font-weight:700; margin:24px 0 10px; color:#0f172a; border-bottom:1px solid #e2e8f0; padding-bottom:6px;">$1</h2>')
    .replace(/^# (.*$)/gim, '<h1 style="font-size:1.75rem; font-weight:800; margin:28px 0 12px; color:#0f172a; border-bottom:2px solid #cbd5e1; padding-bottom:8px;">$1</h1>')

    // Blockquotes
    .replace(/^\> (.*$)/gim, '<blockquote style="border-left:4px solid #3b82f6; padding:8px 16px; margin:12px 0; background:#f0f9ff; color:#334155; border-radius:0 6px 6px 0;">$1</blockquote>')

    // Horizontal Rule
    .replace(/^---$/gim, '<hr style="border:none; border-top:1px solid #e2e8f0; margin:20px 0;" />')

    // Bold and Italic
    .replace(/\*\*\*(.*?)\*\*\*/gim, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/gim, '<em>$1</em>')
    .replace(/~~(.*?)~~/gim, '<del>$1</del>')

    // Code Blocks (```code```)
    .replace(/```([a-z]*)\n([\s\S]*?)```/gim, '<pre style="background:#0f172a; color:#f8fafc; padding:14px 16px; border-radius:8px; overflow-x:auto; font-size:0.85rem; line-height:1.5; margin:14px 0;"><code>$2</code></pre>')

    // Inline Code (`code`)
    .replace(/`([^`]+)`/gim, '<code style="background:#f1f5f9; color:#e11d48; padding:2px 6px; border-radius:4px; font-size:0.88em; font-family:monospace;">$1</code>')

    // Links & Images
    .replace(/!\[(.*?)\]\((.*?)\)/gim, '<img alt="$1" src="$2" style="max-width:100%; border-radius:8px; margin:12px 0;" />')
    .replace(/\[(.*?)\]\((.*?)\)/gim, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:#2563eb; text-decoration:underline;">$1</a>')

    // Unordered Lists
    .replace(/^\s*[\-\*]\s+(.*$)/gim, '<li style="margin-left:20px; line-height:1.6;">$1</li>')

    // Ordered Lists
    .replace(/^\s*\d+\.\s+(.*$)/gim, '<li style="margin-left:20px; line-height:1.6; list-style-type:decimal;">$1</li>')

    // Paragraphs / Line Breaks
    .replace(/\n\n+/g, '</p><p style="margin-bottom:12px; line-height:1.7;">')
    .replace(/\n/g, '<br />');

  return `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.7;
      color: #1e293b;
      background: #ffffff;
      padding: 24px;
      max-width: 860px;
      margin: 0 auto;
    }
    p { margin-bottom: 12px; }
    ul, ol { margin-bottom: 14px; padding-left: 10px; }
    li { margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    th, td { border: 1px solid #e2e8f0; padding: 8px 12px; text-align: left; }
    th { background: #f8fafc; font-weight: 700; }
  </style>
</head>
<body>
  <p style="margin-bottom:12px; line-height:1.7;">${html}</p>
</body>
</html>`;
}
