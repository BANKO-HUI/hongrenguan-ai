import React, { useEffect, useRef, useState } from 'react';
import {
  Aperture,
  ArrowDownToLine,
  Check,
  ChevronDown,
  CircleHelp,
  Columns2,
  FileText,
  Folder,
  Image,
  Images,
  GitFork,
  LayoutGrid,
  Menu,
  MessageCircle,
  PanelLeftClose,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  WandSparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { request, saveBlob, assetUrl, isActive, taskNames, statusNames } from './api.js';
import { ProjectWorkspace } from './ProjectWorkspace.jsx';
import { LibraryWorkspace } from './LibraryWorkspace.jsx';
import { DesignWorkspace } from './DesignWorkspace.jsx';
import { ChatWorkspace } from './ChatWorkspace.jsx';
import { SettingsWorkspace } from './SettingsWorkspace.jsx';
import { StartupScreen } from './StartupScreen.jsx';
import { Modal, Empty, IconButton, ThemeToggle } from './components.jsx';
import { applyTheme, readInitialTheme } from './theme.js';

export const steps = [
  { id: 'generate', icon: Sparkles, label: '系列工作台' },
  { id: 'restyle', icon: WandSparkles, label: '改款中心' },
  { id: 'viral', icon: GitFork, label: '爆款裂变' },
  { id: 'trend', icon: FileText, label: '趋势资料库' },
  { id: 'assets', icon: Image, label: '素材库' },
  { id: 'white', icon: Images, label: '成片管理' },
];
const remembered = (key, fallback) => {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
};
const remember = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};

export default function App() {
  const [startupMinimumElapsed, setStartupMinimumElapsed] = useState(false);
  const [theme, setTheme] = useState(() => {
    const initial = readInitialTheme();
    document.documentElement.dataset.theme = initial;
    return initial;
  });
  const [data, setData] = useState(null);
  const [projectId, setProjectId] = useState(() => remembered('badmark-active-project', 'forest'));
  const [sidebar, setSidebar] = useState(() => window.innerWidth > 820);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [group, setGroup] = useState('进行中');
  const [groupName, setGroupName] = useState('');
  const [collapsed, setCollapsed] = useState(new Set());
  const [step, setStep] = useState(() => {
    const saved = remembered('badmark-step-v4', 'generate');
    return saved === 'memory' ? 'settings' : saved;
  });
  const [settingsReturnStep, setSettingsReturnStep] = useState(() => {
    const saved = remembered('badmark-step-v4', 'generate');
    return ['memory', 'settings'].includes(saved) ? 'generate' : saved;
  });
  const [settingsTab, setSettingsTab] = useState(() =>
    remembered('badmark-step-v4', '') === 'memory'
      ? 'memory'
      : remembered('badmark-settings-tab-v1', 'account'),
  );
  const [restyleEntry, setRestyleEntry] = useState(null);
  const [viralEntry, setViralEntry] = useState(null);
  const [toast, setToast] = useState('');
  const taskStatuses = useRef(null);
  const pollDelay = useRef(1200);
  useEffect(() => {
    const timer = window.setTimeout(() => setStartupMinimumElapsed(true), 3000);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  useEffect(() => {
    if (!data) return;
    if (taskStatuses.current) {
      const finished = data.tasks.find(
        (task) =>
          ['pending', 'running'].includes(taskStatuses.current[task.id]) &&
          ['completed', 'failed'].includes(task.status),
      );
      if (finished)
        setToast(
          `${finished.projectName} · ${taskNames[finished.kind]}${finished.status === 'completed' ? '已完成，可在任务中心查看结果' : '未完成，请在任务中心查看原因'}`,
        );
    }
    taskStatuses.current = Object.fromEntries(data.tasks.map((t) => [t.id, t.status]));
  }, [data]);
  const refresh = async () => {
    const next = await request('/state');
    pollDelay.current = next.tasks.some(isActive) ? 450 : 1200;
    setData((current) => (!current || next.revision >= current.revision ? next : current));
    setConnected(true);
    return next;
  };
  useEffect(() => {
    let stopped = false;
    let timer;
    async function start() {
      try {
        await refresh();
        let old;
        try {
          old = JSON.parse(localStorage.getItem('badmark-projects-v2'));
        } catch {}
        if (Array.isArray(old) && old.length) {
          await request('/migrate', { method: 'POST', body: { projects: old } });
          await refresh();
        }
      } catch (e) {
        setConnected(false);
        setError(e.message);
      }
      poll();
    }
    async function poll() {
      if (stopped) return;
      timer = setTimeout(async () => {
        try {
          await refresh();
        } catch {
          setConnected(false);
        }
        poll();
      }, pollDelay.current);
    }
    start();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (data && !data.projects.some((p) => p.id === projectId))
      setProjectId(data.projects[0]?.id || '');
  }, [data, projectId]);
  useEffect(() => remember('badmark-active-project', projectId), [projectId]);
  useEffect(() => remember('badmark-step-v4', step), [step]);
  useEffect(() => remember('badmark-settings-tab-v1', settingsTab), [settingsTab]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(''), 3500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  const act = async (fn, success) => {
    setError('');
    try {
      const result = await fn();
      await refresh();
      if (success) setToast(success);
      return result;
    } catch (e) {
      setError(e.message);
      throw e;
    }
  };
  const safe = (fn) => {
    return fn().catch(() => {});
  };
  const project = data?.projects.find((p) => p.id === projectId);
  const workspaceStep = step === 'settings' ? settingsReturnStep : step;
  const pending = data?.tasks.filter(isActive).length || 0;
  const selectProject = (id) => {
    setProjectId(id);
    setRestyleEntry(null);
    setViralEntry(null);
    if (window.innerWidth <= 820) setSidebar(false);
  };
  const openRestyle = (lookId) => {
    setRestyleEntry({ projectId, lookId, nonce: crypto.randomUUID() });
    setStep('restyle');
    setModal(null);
  };
  const openViral = (lookId) => {
    setViralEntry({ projectId, lookId, nonce: crypto.randomUUID() });
    setStep('viral');
    setModal(null);
  };
  const openSettings = (tab = 'account') => {
    if (step !== 'settings') setSettingsReturnStep(step);
    setSettingsTab(tab);
    setStep('settings');
    setModal(null);
    if (window.innerWidth <= 820) setSidebar(false);
  };
  const viewTask = (task) => {
    if (task.projectId) selectProject(task.projectId);
    if (task.kind === 'restyle')
      setRestyleEntry({
        projectId: task.projectId,
        lookId: task.lookIds[0] || null,
        nonce: crypto.randomUUID(),
      });
    if (task.kind === 'viral')
      setViralEntry({
        projectId: task.projectId,
        lookId: task.lookIds[0] || null,
        nonce: crypto.randomUUID(),
      });
    setStep(
      task.kind === 'analysis'
        ? 'trend'
        : task.kind === 'series'
          ? 'generate'
          : ['restyle', 'viral'].includes(task.kind)
            ? task.kind
            : 'white',
    );
  };
  const create = async (event) => {
    event.preventDefault();
    setCreating(true);
    try {
      const p = await act(
        () => request('/projects', { method: 'POST', body: { name, group } }),
        '项目已创建',
      );
      selectProject(p.id);
      setStep('generate');
      setName('');
      setModal(null);
    } finally {
      setCreating(false);
    }
  };
  const toggleTheme = () => setTheme((current) => (current === 'light' ? 'dark' : 'light'));
  if (!data || !startupMinimumElapsed)
    return (
      <StartupScreen
        error={error}
        onRetry={() => safe(() => act(refresh))}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    );

  return (
    <div className={`app-shell ${sidebar ? '' : 'sidebar-collapsed'}`}>
      <aside className={`sidebar ${sidebar ? 'open' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark">
            <Aperture size={19} />
          </div>
          <div>
            <strong>Bomi智绘</strong>
            <span>Fashion · AI Design</span>
          </div>
          <IconButton label="收起侧边栏" onClick={() => setSidebar(false)}>
            <PanelLeftClose size={18} />
          </IconButton>
        </div>
        <button
          className="new-project"
          onClick={() => {
            setGroup(data.groups[0]);
            setModal('new');
          }}
        >
          <Plus size={16} />
          新建项目
        </button>
        <nav className="workflow-nav" aria-label="工作流程">
          <button
            className={`chat-nav-item ${step === 'chat' ? 'active' : ''}`}
            onClick={() => {
              setStep('chat');
              if (window.innerWidth <= 820) setSidebar(false);
            }}
          >
            <span className="workflow-icon">
              <MessageCircle size={17} />
            </span>
            <span>Chat模式</span>
            <span className="chat-nav-badge">AI</span>
          </button>
          <p className="nav-label">工作流程</p>
          {steps.map(({ id, icon: Icon, label }, i) => {
            const complete = {
              generate: Boolean(project?.looks.length),
              trend: Boolean(
                data.trendLibrary.items.some((item) => item.status === 'ready' && !item.archivedAt),
              ),
              assets: Boolean(data.materialLibrary.items.some((item) => !item.archivedAt)),
              white: Boolean(project?.looks.length && project.looks.every((l) => l.white)),
            }[id];
            return (
              <button
                className={`workflow-item ${step === id ? 'active' : ''}`}
                key={id}
                onClick={() => {
                  if (id === 'restyle') setRestyleEntry(null);
                  if (id === 'viral') setViralEntry(null);
                  setStep(id);
                  if (window.innerWidth <= 820) setSidebar(false);
                }}
              >
                <span className="workflow-icon">
                  <Icon size={17} />
                </span>
                <span>{label}</span>
                <span className={`step-state ${complete ? 'done' : ''}`}>
                  {complete ? <Check size={11} /> : i + 1}
                </span>
              </button>
            );
          })}
        </nav>
        <div className="project-list">
          <div className="project-heading">
            <p className="nav-label">项目</p>
            <IconButton label="管理项目" onClick={() => setModal('manage')}>
              <Settings2 size={15} />
            </IconButton>
          </div>
          {data.groups.map((g) => (
            <section className="project-group" key={g}>
              <button
                className="group-toggle"
                onClick={() =>
                  setCollapsed((old) => {
                    const next = new Set(old);
                    next.has(g) ? next.delete(g) : next.add(g);
                    return next;
                  })
                }
              >
                <span>
                  <Folder size={14} />
                  {g}
                </span>
                <em>{data.projects.filter((p) => p.group === g).length}</em>
                <ChevronDown size={13} className={collapsed.has(g) ? 'collapsed' : ''} />
              </button>
              {!collapsed.has(g) &&
                data.projects
                  .filter((p) => p.group === g)
                  .map((p) => (
                    <button
                      className={`project ${projectId === p.id ? 'active' : ''}`}
                      key={p.id}
                      onClick={() => selectProject(p.id)}
                    >
                      <span className="project-thumb">
                        {p.looks[0] ? (
                          <img src={assetUrl(p.looks[0].white || p.looks[0].scene)} alt="" />
                        ) : (
                          <Folder size={16} />
                        )}
                      </span>
                      <span>
                        <b>{p.name}</b>
                        <small>
                          {p.looks.length} 套 ·{' '}
                          {data.tasks.some((t) => t.projectId === p.id && isActive(t))
                            ? '任务待完成'
                            : '本机已保存'}
                        </small>
                      </span>
                    </button>
                  ))}
            </section>
          ))}
        </div>
        <button
          className={`account ${step === 'settings' ? 'active' : ''}`}
          onClick={() => openSettings('account')}
        >
          <span>
            <Settings2 size={16} />
          </span>
          <div>
            <b>设置</b>
            <small>{pending ? `${pending} 项任务待完成` : '帐号 · 记忆 · API'}</small>
          </div>
          <span className="settings-entry-dot">{pending || ''}</span>
        </button>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            {!sidebar && (
              <IconButton label="打开侧边栏" onClick={() => setSidebar(true)}>
                <Menu size={19} />
              </IconButton>
            )}
            <div className="project-title">
              <strong>{project?.name || '服装工作台'}</strong>
              <span className={`save-state ${connected ? '' : 'offline'}`}>
                <span />
                {connected ? '本机服务正常' : '本机服务中断'}
              </span>
            </div>
          </div>
          <div className="step-title">
            {step === 'chat'
              ? 'Chat模式'
              : step === 'settings'
                ? '设置'
                : steps.find((s) => s.id === step)?.label}
          </div>
          <div className="top-actions">
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
            <IconButton label="搜索工作台" onClick={() => setModal('search')}>
              <Search size={18} />
            </IconButton>
            <IconButton label="工作台帮助" onClick={() => setModal('help')}>
              <CircleHelp size={18} />
            </IconButton>
            <button className="export-button" onClick={() => openSettings('tasks')}>
              <Sparkles size={15} />
              任务 {pending || ''}
            </button>
          </div>
        </header>
        <div className="workspace-body">
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <IconButton label="关闭错误提示" onClick={() => setError('')}>
                <X size={15} />
              </IconButton>
            </div>
          )}
          {!connected && (
            <div className="connection-banner" role="status">
              服务连接中断，操作可能暂不可用。恢复连接后会自动同步。
            </div>
          )}
          {step === 'settings' && (
            <SettingsWorkspace
              tab={settingsTab}
              onTab={setSettingsTab}
              data={data}
              project={project}
              projectId={projectId}
              act={act}
              safe={safe}
              onRefresh={refresh}
              onViewTask={viewTask}
            />
          )}
          <div className={`workspace-layer ${step === 'settings' ? 'settings-hidden' : ''}`}>
            {workspaceStep === 'chat' ? (
              <ChatWorkspace
                project={project}
                tasks={data.tasks}
                connected={connected}
                executor={data.executor}
                onNewProject={() => {
                  setGroup(data.groups[0]);
                  setModal('new');
                }}
                onNavigate={(target) => {
                  if (target === 'restyle') setRestyleEntry(null);
                  setStep(target);
                }}
                onRefresh={refresh}
              />
            ) : workspaceStep === 'trend' ? (
              <LibraryWorkspace
                key="trend-library"
                type="trend"
                data={data}
                project={project}
                act={act}
                safe={safe}
              />
            ) : workspaceStep === 'assets' ? (
              <LibraryWorkspace
                key="material-library"
                type="material"
                data={data}
                project={project}
                act={act}
                safe={safe}
              />
            ) : project && ['restyle', 'viral'].includes(workspaceStep) ? (
              <DesignWorkspace
                key={`${project.id}:${workspaceStep}:${
                  (workspaceStep === 'restyle' ? restyleEntry?.nonce : viralEntry?.nonce) ||
                  'default'
                }`}
                type={workspaceStep}
                project={project}
                data={data}
                act={act}
                safe={safe}
                onTask={() => openSettings('tasks')}
                initialSourceLookId={
                  workspaceStep === 'restyle'
                    ? restyleEntry?.projectId === project.id
                      ? restyleEntry.lookId
                      : null
                    : viralEntry?.projectId === project.id
                      ? viralEntry.lookId
                      : null
                }
              />
            ) : project ? (
              <ProjectWorkspace
                key={project.id}
                project={project}
                data={data}
                step={workspaceStep}
                setStep={setStep}
                act={act}
                safe={safe}
                onTask={() => openSettings('tasks')}
                onRestyle={openRestyle}
                onViral={openViral}
              />
            ) : (
              <Empty title="创建你的第一个项目">
                <p>建立系列项目后，可直接从共享趋势与素材库选择参考并生成。</p>
                <button className="primary-action" onClick={() => setModal('new')}>
                  新建项目
                </button>
              </Empty>
            )}
          </div>
        </div>
      </main>
      {sidebar && (
        <button
          className="sidebar-shade"
          aria-label="关闭侧边栏"
          onClick={() => setSidebar(false)}
        />
      )}
      {modal === 'new' && (
        <Modal title="新建项目" onClose={() => setModal(null)}>
          <form className="new-project-form" onSubmit={(e) => safe(() => create(e))}>
            <label>
              项目名称
              <input
                value={name}
                required
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：城市夜跑系列"
              />
            </label>
            <label>
              所属分组
              <select value={group} onChange={(e) => setGroup(e.target.value)}>
                {data.groups.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
            </label>
            <p>新项目从空白开始，上传的报告与素材会保存到本机。</p>
            <div className="modal-actions">
              <button type="button" onClick={() => setModal(null)}>
                取消
              </button>
              <button className="primary" disabled={creating || !name.trim()}>
                {creating ? '创建中…' : '创建项目'}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === 'manage' && (
        <Modal title="项目管理" onClose={() => setModal(null)}>
          <div className="project-manager-panel">
            <form
              className="group-creator"
              onSubmit={(e) => {
                e.preventDefault();
                safe(async () => {
                  await act(() =>
                    request('/groups', {
                      method: 'POST',
                      body: { action: 'add', name: groupName },
                    }),
                  );
                  setGroupName('');
                });
              }}
            >
              <input
                aria-label="新分组名称"
                value={groupName}
                maxLength={80}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="新分组名称"
              />
              <button disabled={!groupName.trim()}>添加分组</button>
            </form>
            {data.groups.map((g) => (
              <section className="managed-group" key={g}>
                <header>
                  <strong>{g}</strong>
                  <IconButton
                    label={`删除分组 ${g}`}
                    disabled={data.groups.length === 1}
                    onClick={() => {
                      if (window.confirm(`删除分组“${g}”？项目会移至其他分组。`))
                        safe(() =>
                          act(() =>
                            request('/groups', {
                              method: 'POST',
                              body: { action: 'delete', name: g },
                            }),
                          ),
                        );
                    }}
                  >
                    <Trash2 size={15} />
                  </IconButton>
                </header>
                {data.projects
                  .filter((p) => p.group === g)
                  .map((p) => (
                    <article className="managed-project" key={p.id}>
                      <span>
                        <b>{p.name}</b>
                        <small>{p.looks.length} 套成片</small>
                      </span>
                      <select
                        aria-label={`移动项目 ${p.name}`}
                        value={p.group}
                        onChange={(e) =>
                          safe(() =>
                            act(() =>
                              request(`/projects/${p.id}`, {
                                method: 'PATCH',
                                body: { group: e.target.value },
                              }),
                            ),
                          )
                        }
                      >
                        {data.groups.map((g) => (
                          <option key={g}>{g}</option>
                        ))}
                      </select>
                      <IconButton
                        label={`删除项目 ${p.name}`}
                        onClick={() => {
                          if (window.confirm(`删除“${p.name}”？原文件保留在本机存储中。`))
                            safe(() =>
                              act(() => request(`/projects/${p.id}`, { method: 'DELETE' })),
                            );
                        }}
                      >
                        <Trash2 size={15} />
                      </IconButton>
                    </article>
                  ))}
              </section>
            ))}
          </div>
        </Modal>
      )}
      {modal === 'search' && (
        <Modal title="搜索工作台" onClose={() => setModal(null)}>
          <div className="search-panel">
            <input
              aria-label="搜索项目、造型或步骤"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索项目、造型或工作步骤"
            />
            <div className="search-results">
              {steps
                .filter((s) => s.label.includes(search))
                .map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      if (s.id === 'restyle') setRestyleEntry(null);
                      if (s.id === 'viral') setViralEntry(null);
                      setStep(s.id);
                      setModal(null);
                    }}
                  >
                    {s.label}
                    <ArrowRight size={14} />
                  </button>
                ))}
              {[
                ['memory', '记忆设置'],
                ['account', '帐号管理'],
                ['tasks', '任务中心'],
                ['api', 'API 管理'],
              ]
                .filter(([, label]) => label.toLowerCase().includes(search.toLowerCase()))
                .map(([id, label]) => (
                  <button key={id} onClick={() => openSettings(id)}>
                    {label}
                    <Settings2 size={14} />
                  </button>
                ))}
              {data.projects
                .filter((p) =>
                  `${p.name} ${p.looks.map((l) => l.title).join(' ')}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      selectProject(p.id);
                      setStep('white');
                      setModal(null);
                    }}
                  >
                    {p.name}
                    <small>{p.looks.length} 套造型</small>
                  </button>
                ))}
            </div>
          </div>
        </Modal>
      )}
      {modal === 'help' && (
        <Modal title="工作台使用说明" onClose={() => setModal(null)}>
          <div className="help-panel">
            <p>
              在共享资料库上传趋势与素材 → 在系列工作台选择主辅趋势、模特和 Logo / 图案 → 生成系列 →
              精修 / 白底 → 导出交付包。
            </p>
            <p>
              全部设计操作都在此界面完成。创建任务后，可在“设置 /
              任务中心”独立开始、暂停、继续、重启或结束；模型在“API
              管理”中设置，生成与任务并发由智能调度自动提速或降速。后台调用已登录的 AI
              服务，并逐项保存真实结果。
            </p>
            <p>
              插件对话操作仍可作为可选入口。可以直接说：“使用 Bomi智绘
              工作台，查看并完成待处理任务。”
            </p>
            <p>
              人物一致性、Logo 和工艺细节仍需逐张人工验收。上传原件与历史版本保留在本机；ZIP
              包包含当前成片和设计说明。
            </p>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={15} />
          {toast}
        </div>
      )}
    </div>
  );
}
