export interface NodeDetail {
  title: string;
  typeLabel?: string;
  summary?: string;
  fields?: Array<{ label: string; value: string }>;
  rawLabel?: string;
}

export interface MermaidGraphPanelProps {
  graphDefinition: string;
  nodeDetails?: Record<string, NodeDetail>;
  title?: string;
  subtitle?: string;
  highlightNodeId?: string;
  onNodeClick?: (nodeId: string, detail: NodeDetail | undefined) => void;
  className?: string;
  style?: React.CSSProperties;
}
