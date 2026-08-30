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
