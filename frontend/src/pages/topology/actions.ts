import { createContext, useContext } from 'react';

/** Что можно сделать с устройством и с группой прямо на схеме.
 *
 * Узлы React Flow пересобираются на каждое изменение данных, поэтому
 * передавать обработчики через `data` узла нельзя: в них застыло бы
 * состояние того рендера, на котором узел собрали. Контекст читается в
 * момент клика и всегда актуален.
 */
export interface TopologyActions {
  edit: (deviceId: number) => void;
  copy: (deviceId: number) => void;
  remove: (deviceId: number) => void;
  /** Положить устройство в группу или вынуть из неё. */
  regroup: (deviceId: number) => void;

  editGroup: (groupId: number) => void;
  addSubgroup: (groupId: number) => void;
  removeGroup: (groupId: number) => void;
  /** Рамку растянули за угол: размеры приходят в координатах родителя. */
  resizeGroup: (groupId: number, size: { x: number; y: number; width: number; height: number }) => void;
}

export const TopologyActionsContext = createContext<TopologyActions | null>(null);

export function useTopologyActions(): TopologyActions | null {
  return useContext(TopologyActionsContext);
}
