import ReactECharts from 'echarts-for-react';

interface GraphNode {
  id: string;
  name: string;
  type?: string | null;
}

interface GraphEdge {
  source: string;
  target: string;
  type?: string | null;
}

interface GraphViewerProps {
  data: {
    nodes?: GraphNode[];
    edges?: GraphEdge[];
  };
  height?: number;
}

const NODE_COLORS: Record<string, string> = {
  pipeline: '#2f54eb',
  pump_station: '#1677ff',
  pump: '#4096ff',
  fault: '#cf1322',
  cause: '#fa541c',
  solution: '#389e0d',
  standard: '#7cb305',
  parameter: '#13c2c2',
};

export default function GraphViewer({ data, height = 320 }: GraphViewerProps) {
  const nodes = (data.nodes ?? []).map((node) => ({
    ...node,
    itemStyle: {
      color: NODE_COLORS[node.type ?? ''] ?? '#8c8c8c',
    },
    symbolSize: 42,
    label: { show: true },
  }));

  const links = (data.edges ?? []).map((edge) => ({
    ...edge,
    lineStyle: { width: 1.5, opacity: 0.8 },
    label: {
      show: Boolean(edge.type),
      formatter: edge.type,
      fontSize: 10,
    },
  }));

  return (
    <ReactECharts
      style={{ height }}
      option={{
        tooltip: {},
        series: [
          {
            type: 'graph',
            layout: 'force',
            roam: true,
            draggable: true,
            edgeSymbol: ['none', 'arrow'],
            force: {
              repulsion: 220,
              edgeLength: 120,
            },
            data: nodes,
            links,
          },
        ],
      }}
    />
  );
}
