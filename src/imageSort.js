export const imageSortOptions = [
  ['newest', '最新图片优先'],
  ['oldest', '最早图片优先'],
  ['name', '名称 / 编号升序'],
];

export function sortImages(items, order = 'newest', assets = {}) {
  const timestamp = (item) => {
    const asset = assets[item.scene || item.assetId];
    return Date.parse(asset?.createdAt || item.createdAt || '') || 0;
  };
  const name = (item) => item.title || item.name || String(item.slot || '');
  return [...items].sort((a, b) => {
    if (order === 'name') return name(a).localeCompare(name(b), 'zh-CN', { numeric: true });
    const delta = timestamp(a) - timestamp(b) || (a.slot || 0) - (b.slot || 0);
    return order === 'oldest' ? delta : -delta;
  });
}
