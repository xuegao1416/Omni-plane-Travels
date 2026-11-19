import type { NodeDetail } from './types';

export const MIN_SCALE = 0.3;
export const MAX_SCALE = 8.0;
export const STEP_SCALE = 1.15;
export const SURFACE_PADDING = 40;
export const DRAG_THRESHOLD = 4;

let _mermaidModule: typeof import('mermaid') | null = null;

export async function getMermaid() {
  if (!_mermaidModule) {
    _mermaidModule = await import('mermaid');
  }
  return _mermaidModule;
}

let mermaidInitialized = false;

export async function ensureMermaidInit() {
  if (mermaidInitialized) return;
  const mermaid = await getMermaid();
  mermaid.default.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme: 'base',
    deterministicIds: false,
    fontFamily: '"Noto Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif',
    flowchart: {
      htmlLabels: false,
      curve: 'basis',
    },
    themeVariables: {
      background: 'transparent',
      primaryColor: '#121a33',
      primaryTextColor: '#f1ead8',
      primaryBorderColor: '#e3c27e',
      lineColor: 'rgba(233, 207, 150, 0.45)',
      secondaryColor: '#151c33',
      tertiaryColor: '#0b0f22',
      clusterBkg: 'rgba(20, 27, 48, 0.6)',
      clusterBorder: 'rgba(233, 207, 150, 0.22)',
      edgeLabelBackground: '#0b0f22',
      textColor: '#c4bba4',
      fontSize: 'var(--font-size-md)',
    },
  } as any);
  mermaidInitialized = true;
}

export function getNodeKeyFromDomId(domId: string, nodeDetails: Record<string, NodeDetail>): string {
  const safeDomId = String(domId || '').trim();
  if (!safeDomId) return '';
  if (nodeDetails[safeDomId]) return safeDomId;
  const dataId = safeDomId.replace(/^flowchart-/, '').replace(/-\d+$/, '');
  if (nodeDetails[dataId]) return dataId;
  return '';
}
