import React, { useEffect, useRef, useState } from 'react';
import {
  Aperture,
  Check,
  Images,
  Menu,
  PanelLeftClose,
  Settings2,
  Sparkles,
  WandSparkles,
  X,
} from 'lucide-react';
import { request, isActive, taskNames } from './api.js';
import { ProjectWorkspace } from './ProjectWorkspace.jsx';
import { DesignWorkspace } from './DesignWorkspace.jsx';
import { SettingsWorkspace } from './SettingsWorkspace.jsx';
import { StartupScreen } from './StartupScreen.jsx';
import { Empty, IconButton, ThemeToggle } from './components.jsx';
import { applyTheme, readInitialTheme } from './theme.js';

export const steps = [
  { id: 'restyle', icon: WandSparkles, label: '改款中心' },
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

const visibleStep = (value) =>
  ['restyle', 'white', 'settings'].includes(value) ? value : 'restyle';

export default function App() {
  const [startupMinimumElapsed, setStartupMinimumElapsed] = useState(false);
  const [theme, setTheme] = useState(() => {
    const initial = readInitialTheme();
    document.documentElement.dataset.theme = initial;
    return initial;
  });
  const [data, setData] = useState(null);
  const [projectId, setProjectId] = useState(() => remembered('hongren-active-workspace', ''));
  const [sidebar, setSidebar] = useState(() => window.innerWidth > 820);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [step, setStep] = useState(() => visibleStep(remembered('hongren-step-v1', 'restyle')));
  const [settingsReturnStep, setSettingsReturnStep] = useState('restyle');
  const [settingsTab, setSettingsTab] = useState('account');
  const [restyleEntry, setRestyleEntry] = useState(null);
  const [toast, setToast] = useState('');
  const taskStatuses = useRef(null);
  const pollDelay = useRef(1200);

  useEffect(() => {
    const timer = window.setTimeout(() => setStartupMinimumElapsed(true), 1200);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => applyTheme(theme), [theme]);

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
          `${taskNames[finished.kind] || '任务'}${
            finished.status === 'completed'
              ? '已完成，结果已进入成片管理'
              : '未完成，请在任务中心查看原因'
          }`,
        );
    }
    taskStatuses.current = Object.fromEntries(data.tasks.map((task) => [task.id, task.status]));
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
        let next = await refresh();
        if (!next.projects.length) {
          await request('/projects', {
            method: 'POST',
            body: { name: '红人馆AI改款', group: next.groups[0] || '进行中' },
          });
          next = await refresh();
        }
        if (!projectId && next.projects[0]) setProjectId(next.projects[0].id);
      } catch (cause) {
        setConnected(false);
        setError(cause.message);
      }
      poll();
    }
    function poll() {
      if (stopped) return;
      timer = window.setTimeout(async () => {
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
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (data && !data.projects.some((project) => project.id === projectId))
      setProjectId(data.projects[0]?.id || '');
  }, [data, projectId]);
  useEffect(() => remember('hongren-active-workspace', projectId), [projectId]);
  useEffect(() => remember('hongren-step-v1', step), [step]);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const act = async (action, success) => {
    setError('');
    try {
      const result = await action();
      await refresh();
      if (success) setToast(success);
      return result;
    } catch (cause) {
      setError(cause.message);
      throw cause;
    }
  };
  const safe = (action) => action().catch(() => {});
  const project = data?.projects.find((item) => item.id === projectId) || data?.projects[0];
  const workspaceStep = step === 'settings' ? settingsReturnStep : step;
  const pending = data?.tasks.filter(isActive).length || 0;

  const navigate = (nextStep) => {
    if (nextStep === 'restyle') setRestyleEntry(null);
    setStep(nextStep);
    if (window.innerWidth <= 820) setSidebar(false);
  };

  const openRestyle = (lookId) => {
    setRestyleEntry({ projectId: project?.id, lookId, nonce: crypto.randomUUID() });
    setStep('restyle');
  };

  const openSettings = (tab = 'account') => {
    if (step !== 'settings') setSettingsReturnStep(step);
    setSettingsTab(tab);
    setStep('settings');
    if (window.innerWidth <= 820) setSidebar(false);
  };

  const viewTask = (task) => {
    if (task.projectId) setProjectId(task.projectId);
    if (task.kind === 'restyle') {
      setRestyleEntry({
        projectId: task.projectId,
        lookId: task.lookIds[0] || null,
        nonce: crypto.randomUUID(),
      });
      setStep('restyle');
      return;
    }
    setStep('white');
  };

  const toggleTheme = () => setTheme((current) => (current === 'light' ? 'dark' : 'light'));

  if (!data || !startupMinimumElapsed)
    return (
      <StartupScreen
        error={error}
        onRetry={() => safe(() => refresh())}
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
            <strong>红人馆AI</strong>
            <span>FASHION RESTYLE</span>
          </div>
          <IconButton label="收起侧边栏" onClick={() => setSidebar(false)}>
            <PanelLeftClose size={18} />
          </IconButton>
        </div>
        <nav className="workflow-nav" aria-label="改款工作流程">
          <p className="nav-label">工作台</p>
          {steps.map(({ id, icon: Icon, label }, index) => (
            <button
              className={`workflow-item ${step === id ? 'active' : ''}`}
              key={id}
              onClick={() => navigate(id)}
            >
              <span className="workflow-icon">
                <Icon size={17} />
              </span>
              <span>{label}</span>
              <span className="step-state">{index + 1}</span>
            </button>
          ))}
        </nav>
        <div className="project-list" aria-hidden="true" />
        <button
          className={`account ${step === 'settings' ? 'active' : ''}`}
          onClick={() => openSettings('account')}
        >
          <span>
            <Settings2 size={16} />
          </span>
          <div>
            <b>设置</b>
            <small>{pending ? `${pending} 项任务处理中` : '帐号 · 任务 · API'}</small>
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
              <strong>红人馆AI</strong>
              <span className={`save-state ${connected ? '' : 'offline'}`}>
                <span />
                {connected ? '本机服务正常' : '本机服务中断'}
              </span>
            </div>
          </div>
          <div className="step-title">
            {step === 'settings' ? '设置' : steps.find((item) => item.id === step)?.label}
          </div>
          <div className="top-actions">
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
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
              projectId={project?.id || ''}
              act={act}
              safe={safe}
              onRefresh={refresh}
              onViewTask={viewTask}
            />
          )}
          <div className={`workspace-layer ${step === 'settings' ? 'settings-hidden' : ''}`}>
            {project && workspaceStep === 'restyle' ? (
              <DesignWorkspace
                key={`${project.id}:restyle:${restyleEntry?.nonce || 'default'}`}
                type="restyle"
                project={project}
                data={data}
                act={act}
                safe={safe}
                onTask={() => openSettings('tasks')}
                initialSourceLookId={
                  restyleEntry?.projectId === project.id ? restyleEntry.lookId : null
                }
              />
            ) : project ? (
              <ProjectWorkspace
                key={project.id}
                project={project}
                data={data}
                step="white"
                setStep={setStep}
                act={act}
                safe={safe}
                onTask={() => openSettings('tasks')}
                onRestyle={openRestyle}
              />
            ) : (
              <Empty title="正在准备改款工作区">
                <p>工作区创建完成后即可上传原图开始改款。</p>
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
      {toast && (
        <div className="toast" role="status">
          <Check size={15} />
          {toast}
        </div>
      )}
    </div>
  );
}
