// Markdown preview rendering. The source is untrusted repository content: it is converted with `marked`, then
// sanitized with DOMPurify before it reaches the DOM. Mermaid blocks are not drawn here; they are replaced by a
// placeholder and returned so the component can draw them (see `mermaid.ts`).

import DOMPurify from 'dompurify';
import { Marked } from 'marked';

export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(path);
}

export type RenderedMarkdown = { html: string; mermaid: string[] };

const PURIFY = DOMPurify(window);
// Relative repo links and remote images cannot work here (and the CSP blocks remote images): keep the text only.
PURIFY.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    const href = node.getAttribute('href') ?? '';
    if (/^https?:\/\//i.test(href)) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    } else {
      node.removeAttribute('href');
    }
  } else if (node.tagName === 'IMG') {
    const src = node.getAttribute('src') ?? '';
    if (!src.startsWith('data:image/')) {
      const alt = node.getAttribute('alt') ?? '';
      node.replaceWith(document.createTextNode(alt === '' ? '[image]' : `[image: ${alt}]`));
    }
  }
});

export function renderMarkdown(source: string): RenderedMarkdown {
  const mermaid: string[] = [];
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    renderer: {
      code({ text, lang }) {
        if ((lang ?? '').trim().split(/\s+/)[0] === 'mermaid') {
          mermaid.push(text);
          return `<div class="md-mermaid" data-mermaid-index="${mermaid.length - 1}"></div>`;
        }
        const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<pre><code>${escaped}</code></pre>`;
      },
    },
  });
  const raw = marked.parse(source, { async: false });
  const html = PURIFY.sanitize(raw, {
    FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'input', 'object', 'embed'],
    FORBID_ATTR: ['style'],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ['data-mermaid-index', 'target'],
  });
  return { html, mermaid };
}
