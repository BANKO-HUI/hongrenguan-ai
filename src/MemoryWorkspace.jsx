import React, { useEffect, useMemo, useState } from 'react';
import { Archive, Brain, Check, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { request } from './api.js';

const categories = {
  brand: '品牌规则',
  aesthetic: '审美方向',
  color: '色彩偏好',
  silhouette: '廓形比例',
  material: '面料工艺',
  styling: '造型场景',
  workflow: '工作习惯',
  constraint: '禁止项',
};
const polarities = {
  rule: '固定规则',
  positive: '喜欢',
  negative: '避免',
};
const sourceLabels = {
  manual: '手动保存',
  'chat-explicit': '对话确认',
  'look-feedback': '成片反馈',
};

const emptyDraft = (project) => ({
  title: '',
  text: '',
  scope: project ? 'project' : 'global',
  projectId: project?.id || null,
  category: 'aesthetic',
  polarity: 'rule',
});

export function MemoryWorkspace({ data, project, act, safe, embedded = false }) {
  const [draft, setDraft] = useState(() => emptyDraft(project));
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState('active');
  const entries = data.memory?.entries || [];
  const visible = useMemo(
    () =>
      entries
        .filter((entry) => entry.status === filter)
        .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt))),
    [entries, filter],
  );
  useEffect(() => {
    if (draft.scope === 'project' && !project)
      setDraft((current) => ({ ...current, scope: 'global', projectId: null }));
  }, [project, draft.scope]);

  const submit = async (event) => {
    event.preventDefault();
    const body = {
      ...draft,
      projectId: draft.scope === 'project' ? project?.id : null,
    };
    await act(
      () => request('/memory', { method: 'POST', body }),
      draft.scope === 'project' ? '已记住当前项目规则' : '已记住全局偏好',
    );
    setDraft(emptyDraft(project));
  };
  const saveEdit = async (entry) => {
    const { id: _id, ...changes } = editing;
    await act(
      () =>
        request(`/memory/${entry.id}`, {
          method: 'PATCH',
          body: { ...changes, expectedRevision: entry.revision || 0 },
        }),
      '记忆已更新',
    );
    setEditing(null);
  };
  const projectName = (id) => data.projects.find((item) => item.id === id)?.name || '历史项目';

  return (
    <section className={`${embedded ? '' : 'page-scroll '}memory-workspace ${embedded ? 'embedded' : ''}`} aria-label="记忆中心">
      <header className="memory-heading">
        <div>
          <span className="memory-kicker">
            <Brain size={16} /> 本机长期记忆
          </span>
          <h1>越使用，越贴近你的设计习惯</h1>
          <p>只有明确保存的规则和反馈会进入生成任务。全部记忆保存在本机，可随时修改、停用或删除。</p>
        </div>
        <label className="memory-switch">
          <input
            type="checkbox"
            checked={data.memory?.enabled !== false}
            onChange={(event) =>
              safe(() =>
                act(
                  () =>
                    request('/memory/settings', {
                      method: 'PATCH',
                      body: { enabled: event.target.checked },
                    }),
                  event.target.checked ? '长期记忆已启用' : '长期记忆已暂停',
                ),
              )
            }
          />
          <span>{data.memory?.enabled !== false ? '生成时使用记忆' : '已暂停使用记忆'}</span>
        </label>
      </header>

      <div className="memory-summary">
        <div><b>{entries.filter((item) => item.status === 'active').length}</b><span>生效记忆</span></div>
        <div><b>{entries.filter((item) => item.scope === 'global' && item.status === 'active').length}</b><span>全局偏好</span></div>
        <div><b>{entries.filter((item) => item.projectId === project?.id && item.status === 'active').length}</b><span>当前项目</span></div>
      </div>

      <div className="memory-layout">
        <form className="memory-compose" onSubmit={submit}>
          <div className="memory-compose-title"><Plus size={17} /><strong>添加一条确定的记忆</strong></div>
          <label>
            <span>作用范围</span>
            <select
              value={draft.scope}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  scope: event.target.value,
                  projectId: event.target.value === 'project' ? project?.id : null,
                }))
              }
            >
              <option value="global">所有项目</option>
              {project && <option value="project">当前项目 · {project.name}</option>}
            </select>
          </label>
          <div className="memory-form-row">
            <label>
              <span>类型</span>
              <select value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))}>
                {Object.entries(categories).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
            <label>
              <span>性质</span>
              <select value={draft.polarity} onChange={(event) => setDraft((current) => ({ ...current, polarity: event.target.value }))}>
                {Object.entries(polarities).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
          </div>
          <label>
            <span>标题，可选</span>
            <input value={draft.title} maxLength={100} placeholder="例如：品牌色彩边界" onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} />
          </label>
          <label>
            <span>需要长期遵循的内容</span>
            <textarea
              required
              rows={6}
              maxLength={1200}
              value={draft.text}
              placeholder="例如：系列主色保持低饱和，避免大面积荧光色；Logo 优先使用小面积同色刺绣。"
              onChange={(event) => setDraft((current) => ({ ...current, text: event.target.value }))}
            />
          </label>
          <button className="primary-action" disabled={!draft.text.trim()}><Brain size={16} />保存到长期记忆</button>
          <small>也可以在 Chat 中直接说“记住：……”或“以后都……”。</small>
        </form>

        <div className="memory-library">
          <div className="memory-tabs">
            <button className={filter === 'active' ? 'active' : ''} onClick={() => setFilter('active')}>正在使用</button>
            <button className={filter === 'archived' ? 'active' : ''} onClick={() => setFilter('archived')}>已停用</button>
          </div>
          {visible.length ? (
            <div className="memory-list">
              {visible.map((entry) => (
                <article className={`memory-card ${entry.polarity}`} key={entry.id}>
                  {editing?.id === entry.id ? (
                    <div className="memory-editor">
                      <input value={editing.title} onChange={(event) => setEditing((current) => ({ ...current, title: event.target.value }))} />
                      <textarea rows={5} value={editing.text} onChange={(event) => setEditing((current) => ({ ...current, text: event.target.value }))} />
                      <div>
                        <button className="primary-action" onClick={() => safe(() => saveEdit(entry))}><Check size={14} />保存</button>
                        <button className="outline-action" onClick={() => setEditing(null)}><X size={14} />取消</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="memory-card-head">
                        <div>
                          <span>{categories[entry.category]} · {polarities[entry.polarity]}</span>
                          <h2>{entry.title}</h2>
                        </div>
                        <em>{entry.scope === 'global' ? '所有项目' : projectName(entry.projectId)}</em>
                      </div>
                      <p>{entry.text}</p>
                      <footer>
                        <small>{sourceLabels[entry.source] || entry.source} · 已确认 {entry.evidenceCount || 1} 次</small>
                        <div>
                          {entry.status === 'active' ? (
                            <>
                              <button onClick={() => setEditing({ id: entry.id, title: entry.title, text: entry.text })}><Pencil size={14} />修改</button>
                              <button onClick={() => safe(() => act(() => request(`/memory/${entry.id}`, { method: 'PATCH', body: { status: 'archived', expectedRevision: entry.revision || 0 } }), '记忆已停用'))}><Archive size={14} />停用</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => safe(() => act(() => request(`/memory/${entry.id}`, { method: 'PATCH', body: { status: 'active', expectedRevision: entry.revision || 0 } }), '记忆已恢复'))}><RotateCcw size={14} />恢复</button>
                              <button className="danger-action" onClick={() => safe(() => act(() => request(`/memory/${entry.id}`, { method: 'DELETE' }), '记忆已删除'))}><Trash2 size={14} />删除</button>
                            </>
                          )}
                        </div>
                      </footer>
                    </>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="memory-empty"><Brain size={25} /><strong>{filter === 'active' ? '还没有长期记忆' : '没有已停用的记忆'}</strong><p>添加明确规则，或对生成成片标记喜欢与不喜欢。</p></div>
          )}
        </div>
      </div>
    </section>
  );
}
