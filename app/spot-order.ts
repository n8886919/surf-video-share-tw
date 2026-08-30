export function mergeSpotOrder(defaultIds: readonly string[], savedIds: readonly string[]): string[] {
  const available = new Set(defaultIds);
  const result: string[] = [];
  for (const id of savedIds) {
    if (available.has(id) && !result.includes(id)) result.push(id);
  }
  for (const id of defaultIds) {
    if (!result.includes(id)) result.push(id);
  }
  return result;
}

export function moveSpotId(order: readonly string[], draggedId: string, targetId: string): string[] {
  const from = order.indexOf(draggedId);
  const to = order.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return [...order];
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, draggedId);
  return next;
}

export interface SpotOrderPosition {
  id: string;
  centerX: number;
}

export function spotReorderTarget(
  order: readonly string[],
  draggedId: string,
  pointerX: number,
  direction: -1 | 0 | 1,
  positions: readonly SpotOrderPosition[],
  hysteresis = 8,
): string | null {
  const draggedIndex = order.indexOf(draggedId);
  if (draggedIndex < 0 || direction === 0 || !Number.isFinite(pointerX)) return null;
  const neighborId = order[draggedIndex + direction];
  if (!neighborId) return null;
  const neighbor = positions.find((position) => position.id === neighborId);
  if (!neighbor || !Number.isFinite(neighbor.centerX)) return null;
  if (direction > 0 && pointerX >= neighbor.centerX + hysteresis) return neighborId;
  if (direction < 0 && pointerX <= neighbor.centerX - hysteresis) return neighborId;
  return null;
}
