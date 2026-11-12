export function computeScrollRailMetrics({
  clientWidth,
  scrollWidth,
  scrollLeft,
  trackWidth,
  minThumbWidth = 32,
}) {
  const viewportWidth = Math.max(0, Number(clientWidth) || 0);
  const contentWidth = Math.max(viewportWidth, Number(scrollWidth) || 0);
  const railWidth = Math.max(0, Number(trackWidth) || 0);
  const maxScroll = Math.max(0, contentWidth - viewportWidth);
  const scrollable = maxScroll > 1 && railWidth > 0;
  const thumbWidth = scrollable
    ? Math.min(railWidth, Math.max(minThumbWidth, (railWidth * viewportWidth) / contentWidth))
    : railWidth;
  const maxThumbLeft = Math.max(0, railWidth - thumbWidth);
  const currentScroll = Math.min(maxScroll, Math.max(0, Number(scrollLeft) || 0));
  const thumbLeft = scrollable ? (currentScroll / maxScroll) * maxThumbLeft : 0;

  return { scrollable, maxScroll, currentScroll, thumbWidth, thumbLeft };
}

export function scrollLeftFromRailPointer({
  clientX,
  trackLeft,
  trackWidth,
  thumbWidth,
  grabOffset,
  maxScroll,
}) {
  const travel = Math.max(0, trackWidth - thumbWidth);
  if (!travel || !maxScroll) return 0;
  const thumbLeft = Math.min(
    travel,
    Math.max(0, clientX - trackLeft - Math.min(thumbWidth, Math.max(0, grabOffset))),
  );
  return (thumbLeft / travel) * maxScroll;
}
