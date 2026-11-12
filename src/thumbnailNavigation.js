const selectionSelector =
  '.active, .selected, [aria-current="true"], [aria-selected="true"], [aria-pressed="true"]';

export function nextThumbnailIndex(length, currentIndex, key) {
  if (!Number.isInteger(length) || length <= 0) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  if (!['ArrowLeft', 'ArrowRight'].includes(key)) return currentIndex;
  const delta = key === 'ArrowLeft' ? -1 : 1;
  const start = currentIndex >= 0 ? currentIndex : delta > 0 ? -1 : 0;
  return (start + delta + length) % length;
}

export function activateAdjacentThumbnail(event, container = event.currentTarget) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return false;
  if (event.altKey || event.ctrlKey || event.metaKey) return false;
  const items = [...container.querySelectorAll('button:not(:disabled)')].filter(
    (item) => item.getClientRects().length > 0,
  );
  if (!items.length) return false;
  const target = event.target.closest?.('button:not(:disabled)');
  const selected = items.findIndex((item) => item.matches(selectionSelector));
  const focused = items.indexOf(target);
  const next =
    items[nextThumbnailIndex(items.length, focused >= 0 ? focused : selected, event.key)];
  if (!next) return false;
  event.preventDefault();
  event.stopPropagation();
  next.focus({ preventScroll: true });
  next.click();
  next.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  return true;
}
