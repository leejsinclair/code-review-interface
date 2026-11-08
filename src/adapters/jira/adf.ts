// Atlassian Document Format to plain text (research R15, FR-004). A small node walker: blocks are
// separated by a blank line, list items become "- " or "1. " lines, code keeps its lines, mentions
// keep their display text, and a link's address follows its text. Nothing is ever turned into HTML.

type Node = { type?: unknown; text?: unknown; attrs?: Record<string, unknown>; marks?: unknown; content?: unknown };

const children = (node: Node): Node[] => (Array.isArray(node.content) ? (node.content as Node[]) : []);
const attr = (node: Node, name: string): string => {
  const value = node.attrs?.[name];
  return typeof value === 'string' ? value : '';
};

function linkHref(node: Node): string {
  if (!Array.isArray(node.marks)) return '';
  for (const mark of node.marks as Node[]) {
    if (mark?.type === 'link') return attr(mark, 'href');
  }
  return '';
}

function inline(node: Node): string {
  switch (node.type) {
    case 'text': {
      const text = typeof node.text === 'string' ? node.text : '';
      const href = linkHref(node);
      return href !== '' && href !== text ? `${text} (${href})` : text;
    }
    case 'hardBreak':
      return '\n';
    case 'mention':
      return attr(node, 'text');
    case 'emoji':
      return attr(node, 'text') || attr(node, 'shortName');
    case 'inlineCard':
    case 'blockCard':
      return attr(node, 'url');
    case 'date': {
      const time = Number(attr(node, 'timestamp'));
      return Number.isFinite(time) && time > 0 ? new Date(time).toISOString().slice(0, 10) : '';
    }
    case 'status':
      return attr(node, 'text');
    default:
      return children(node).map(inline).join('') || (typeof node.text === 'string' ? node.text : '');
  }
}

function list(node: Node, ordered: boolean): string {
  const start = Number(node.attrs?.order ?? 1);
  return children(node)
    .map((item, i) => {
      const body = children(item).map(block).filter((t) => t !== '').join('\n');
      const marker = ordered ? `${(Number.isFinite(start) ? start : 1) + i}. ` : '- ';
      return marker + body.split('\n').join('\n  ');
    })
    .join('\n');
}

function blocks(nodes: Node[]): string {
  return nodes
    .map(block)
    .filter((t) => t !== '')
    .join('\n\n');
}

function block(node: Node): string {
  switch (node.type) {
    case 'paragraph':
    case 'heading':
    case 'codeBlock':
      return children(node).map(inline).join('');
    case 'bulletList':
      return list(node, false);
    case 'orderedList':
      return list(node, true);
    case 'rule':
      return '---';
    case 'table':
      return children(node)
        .map((row) => children(row).map((cell) => blocks(children(cell)).replace(/\n+/g, ' ')).join(' | '))
        .join('\n');
    case 'doc':
    case 'blockquote':
    case 'panel':
    case 'expand':
    case 'nestedExpand':
    case 'layoutSection':
    case 'layoutColumn':
      return blocks(children(node));
    default:
      return inline(node);
  }
}

/** The plain text of an ADF document; empty for null or anything that is not a document. */
export function adfToText(document: unknown): string {
  if (typeof document === 'string') return document;
  if (document === null || typeof document !== 'object') return '';
  return block(document as Node).trim();
}
