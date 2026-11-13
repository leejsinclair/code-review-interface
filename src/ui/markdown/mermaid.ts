// Draws one Mermaid diagram as an SVG data URL. The page CSP forbids inline styles, which Mermaid's SVG relies on,
// so the SVG is shown through `<img src="data:image/svg+xml,...">`: images keep their own styles and cannot run
// scripts. Mermaid is a large library and is loaded on first use only.

type MermaidApi = {
  initialize(config: Record<string, unknown>): void;
  render(id: string, source: string): Promise<{ svg: string }>;
};

let loaded: Promise<MermaidApi> | null = null;
let theme: 'dark' | 'default' | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function load(dark: boolean): Promise<MermaidApi> {
  loaded ??= import('mermaid').then((m) => m.default as unknown as MermaidApi);
  const api = await loaded;
  const want = dark ? 'dark' : 'default';
  if (theme !== want) {
    api.initialize({ startOnLoad: false, securityLevel: 'strict', theme: want, htmlLabels: false, flowchart: { htmlLabels: false } });
    theme = want;
  }
  return api;
}

export type Diagram = { src: string; width?: number; height?: number };

/** The diagram's natural size from its viewBox; without it an SVG image has no size of its own and fills the page. */
function naturalSize(svg: string): { width?: number; height?: number } {
  const box = /viewBox="[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)"/.exec(svg);
  const width = box === null ? NaN : Math.round(Number(box[1]));
  const height = box === null ? NaN : Math.round(Number(box[2]));
  return width > 0 && height > 0 ? { width, height } : {};
}

/** Renders `source`; rejects with Mermaid's message when the syntax is invalid. Calls run one at a time. */
export function renderMermaid(source: string, id: string, dark: boolean): Promise<Diagram> {
  const run = async (): Promise<Diagram> => {
    const api = await load(dark);
    const { svg } = await api.render(id, source);
    return { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, ...naturalSize(svg) };
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}
