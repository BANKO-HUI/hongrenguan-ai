const terminalFailureStates = new Set(['failed', 'cancelled']);
const activeGenerationStates = new Set(['pending', 'running', 'paused']);

export function buildGenerationSlots(task) {
  const total = Math.max(0, Number.parseInt(task?.total, 10) || 0);
  const results = new Map(
    (task?.results || [])
      .filter((result) => Number.isInteger(result?.slot) && result.assetId)
      .map((result) => [result.slot, result]),
  );

  return Array.from({ length: total }, (_, index) => {
    const slot = index + 1;
    const result = results.get(slot);
    const state = result
      ? 'ready'
      : task?.status === 'paused'
        ? 'paused'
        : terminalFailureStates.has(task?.status)
          ? 'failed'
          : 'generating';
    return {
      slot,
      state,
      assetId: result?.assetId || null,
      result: result || null,
    };
  });
}

export function findVisibleGenerationTask(tasks, projectId, kind) {
  const relevant = (tasks || []).filter(
    (task) => task.projectId === projectId && task.kind === kind,
  );
  const active = relevant.find((task) => activeGenerationStates.has(task.status));
  if (active) return active;
  return terminalFailureStates.has(relevant[0]?.status) ? relevant[0] : null;
}

export function mergePreviewBySource(items, preview) {
  const index = items.findIndex((item) => item.src === preview.src);
  if (index < 0) return [...items, preview];
  return items.map((item, candidate) => (candidate === index ? { ...item, ...preview } : item));
}
