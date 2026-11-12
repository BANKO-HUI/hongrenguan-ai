export const mentionName = (filename, fallback = '参考') =>
  String(filename || '')
    .replace(/\.[^.]+$/, '')
    .trim()
    .replace(/[^\w\u3400-\u9fff-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || fallback;

export function uniqueMention(filename, existing = []) {
  const base = mentionName(filename);
  let candidate = base;
  let suffix = 2;
  while (existing.includes(candidate)) candidate = `${base}-${suffix++}`;
  return candidate;
}

export function insertMentionToken(value, mention) {
  const current = String(value || '');
  const token = `@${mention}`;
  if (/(^|\s)@[^\s@]*$/.test(current))
    return current.replace(/(^|\s)@[^\s@]*$/, (_match, prefix) => `${prefix}${token} `);
  return `${current}${current && !/\s$/.test(current) ? ' ' : ''}${token} `;
}
