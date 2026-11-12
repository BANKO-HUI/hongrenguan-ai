let token;
async function session() {
  const response = await fetch('/api/session');
  if (!response.ok) throw new Error('工作台服务不可用，请运行 npm run dev');
  token = (await response.json()).token;
}
export async function request(
  route,
  { method = 'GET', body, form, binary = false } = {},
  retry = true,
) {
  if (!token) await session();
  let response;
  try {
    response = await fetch(`/api${route}`, {
      method,
      headers: {
        'X-Badmark-Token': token,
        ...(!form && body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: form || (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new Error('与本地工作台失去连接，数据仍保存在本机。请检查服务后重试。');
  }
  if (response.status === 401 && retry) {
    await session();
    return request(route, { method, body, form, binary }, false);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `请求失败 (${response.status})`);
  }
  return binary ? response.blob() : response.json();
}
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const assetUrl = (id) => (id ? `/api/files/${id}` : undefined);
export const isActive = (t) => ['pending', 'running', 'paused'].includes(t.status);
export const modelLabel = (model) => {
  const label = String(model?.displayName || model?.id || '').trim();
  return label.replace(/\bGPT\b[\s-]*/gi, '').trim() || 'AI 模型';
};
export const taskNames = {
  analysis: '趋势解析',
  series: '系列生成',
  white: '白底处理',
  refine: '单图精修',
  restyle: '改款中心',
  viral: '爆款裂变',
};
export const statusNames = {
  pending: '排队中',
  running: '正在执行',
  paused: '已暂停',
  completed: '已完成',
  failed: '执行失败',
  cancelled: '已结束',
};
