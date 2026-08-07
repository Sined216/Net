import { BaseEdge, EdgeLabelRenderer, getStraightPath, useInternalNode, type EdgeProps, type Edge, type InternalNode, type Node } from '@xyflow/react';

export interface FloatingEdgeData extends Record<string, unknown> {
  sourceLabel: string;
  targetLabel: string;
  color: string;
  dashArray?: string;
  confirmed: boolean;
}

export type FloatingEdgeType = Edge<FloatingEdgeData, 'floating'>;

/** Пересечение прямой (центр intersectionNode -> центр targetNode) с
 * границей прямоугольника intersectionNode. Стандартный приём для
 * "плавающих" рёбер в React Flow: сначала прямая между центрами узлов,
 * потом обрезаем её по границе каждого узла — линия никогда не идёт
 * через чужой корпус, потому что видимая точка старта/конца — это уже
 * граница, а не фиксированный хендл где-то на узле. */
function getNodeIntersection(intersectionNode: InternalNode<Node>, targetNode: InternalNode<Node>) {
  const { width, height } = intersectionNode.measured;
  const intersectionPos = intersectionNode.internals.positionAbsolute;
  const targetPos = targetNode.internals.positionAbsolute;

  const w = (width ?? 0) / 2;
  const h = (height ?? 0) / 2;
  const x2 = intersectionPos.x + w;
  const y2 = intersectionPos.y + h;
  const x1 = targetPos.x + (targetNode.measured.width ?? 0) / 2;
  const y1 = targetPos.y + (targetNode.measured.height ?? 0) / 2;

  const xx1 = (x1 - x2) / (2 * w) - (y1 - y2) / (2 * h);
  const yy1 = (x1 - x2) / (2 * w) + (y1 - y2) / (2 * h);
  const a = 1 / (Math.abs(xx1) + Math.abs(yy1) || 1);
  const xx3 = a * xx1;
  const yy3 = a * yy1;

  return { x: w * (xx3 + yy3) + x2, y: h * (-xx3 + yy3) + y2 };
}

export function FloatingEdge({ id, source, target, data }: EdgeProps<FloatingEdgeType>) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (!sourceNode || !targetNode || !data) return null;

  const s = getNodeIntersection(sourceNode, targetNode);
  const t = getNodeIntersection(targetNode, sourceNode);
  const [path] = getStraightPath({ sourceX: s.x, sourceY: s.y, targetX: t.x, targetY: t.y });

  // подписи портов чуть отступают от каждого конца линии вдоль её направления
  const dx = t.x - s.x, dy = t.y - s.y;
  const dist = Math.hypot(dx, dy) || 1;
  const off = 16;
  const sLabel = { x: s.x + (dx / dist) * off, y: s.y + (dy / dist) * off };
  const tLabel = { x: t.x - (dx / dist) * off, y: t.y - (dy / dist) * off };

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{ stroke: data.color, strokeWidth: 2, strokeDasharray: data.dashArray, opacity: data.confirmed ? 0.9 : 0.45 }}
      />
      <EdgeLabelRenderer>
        <PortLabel x={sLabel.x} y={sLabel.y} text={data.sourceLabel} />
        <PortLabel x={tLabel.x} y={tLabel.y} text={data.targetLabel} />
      </EdgeLabelRenderer>
    </>
  );
}

function PortLabel({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <div
      style={{
        position: 'absolute',
        transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
        background: 'var(--mantine-color-body)',
        border: '1px solid var(--mantine-color-default-border)',
        borderRadius: 4,
        padding: '1px 5px',
        fontSize: 10,
        lineHeight: '14px',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
      }}
    >
      {text}
    </div>
  );
}
