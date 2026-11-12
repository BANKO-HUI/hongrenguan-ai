export const clampZoom = (value) => Math.min(4, Math.max(1, value));

export function zoomOffsetAtPoint({ currentZoom, nextZoom, offset, pointer }) {
  if (nextZoom === 1) return { x: 0, y: 0 };
  const ratio = nextZoom / currentZoom;
  return {
    x: pointer.x - (pointer.x - offset.x) * ratio,
    y: pointer.y - (pointer.y - offset.y) * ratio,
  };
}
