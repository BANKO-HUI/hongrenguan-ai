import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Check,
  ImagePlus,
  Images,
  LoaderCircle,
  Menu,
  PanelLeftClose,
  Settings2,
  Sparkles,
  WandSparkles,
  X,
} from 'lucide-react';
import { request, assetUrl, isActive, taskNames } from './api.js';
import { ProjectWorkspace } from './ProjectWorkspace.jsx';
import { DesignWorkspace } from './DesignWorkspace.jsx';
import { SettingsWorkspace } from './SettingsWorkspace.jsx';
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

const projectCover = (project) =>
  project.looks?.at(-1)?.scene || project.sourceAssetId || project.looks?.[0]?.scene || null;

export default function App() {
  const [theme, setTheme] = useState(() => {
    const initial = readInitialTheme();
    return initial;
  });
  const [data, setData] = useState(null);
  const [projectId, setProjectId] = useState(() => remembered('hongren-active-workspace', ''));
  const [sidebar, setSidebar] = useState(
    () => remembered('hongren-sidebar-v1', window.innerWidth > 820 ? 'open' : 'closed') === 'open',
  );
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [step, setStep] = useState(() => visibleStep(remembered('hongren-step-v1', 'restyle')));
  const [settingsReturnStep, setSettingsReturnStep] = useState(() =>
    visibleStep(remembered('hongren-settings-return-v1', 'restyle')),
  );
  const [settingsTab, setSettingsTab] = useState(() =>
    ['account', 'tasks', 'api', 'output'].includes(remembered('hongren-settings-tab-v1', 'account'))
      ? remembered('hongren-settings-tab-v1', 'account')
      : 'account',
  );
  const [restyleEntry, setRestyleEntry] = useState(null);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState('');
  const projectInput = useRef(null);
  const taskStatuses = useRef(null);
  const pollDelay = useRef(1200);

  useLayoutEffect(() => {
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
          `${finished.projectName || '图片项目'} · ${taskNames[finished.kind] || '任务'}${
            finished.status === 'completed'
              ? '已完成，操作历史已保存'
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
        await refresh();
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

  const imageProjects =
    data?.projects.filter((project) => project.sourceAssetId || project.looks?.length) || [];

  useEffect(() => {
    if (!data) return;
    if (!imageProjects.some((project) => project.id === projectId))
      setProjectId(imageProjects[0]?.id || '');
  }, [data, projectId]);

  useEffect(() => remember('hongren-active-workspace', projectId), [projectId]);
  useEffect(() => remember('hongren-step-v1', step), [step]);
  useEffect(() => remember('hongren-sidebar-v1', sidebar ? 'open' : 'closed'), [sidebar]);
  useEffect(() => remember('hongren-settings-return-v1', settingsReturnStep), [settingsReturnStep]);
  useEffect(() => remember('hongren-settings-tab-v1', settingsTab), [settingsTab]);
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
  const project = imageProjects.find((item) => item.id === projectId) || imageProjects[0];
  const workspaceStep = step === 'settings' ? settingsReturnStep : step;
  const pending = data?.tasks.filter(isActive).length || 0;

  const selectProject = (id) => {
    setProjectId(id);
    setRestyleEntry(null);
    setStep('restyle');
    if (window.innerWidth <= 820) setSidebar(false);
  };

  const importImageProjects = (files) =>
    safe(async () => {
      if (!files.length) return;
      setImporting(true);
      try {
        const form = new FormData();
        files.forEach((file) => form.append('files', file));
        const created = await act(
          () => request('/image-projects', { method: 'POST', form }),
          files.length === 1 ? '图片项目已创建' : `已创建 ${files.length} 个图片项目`,
        );
        if (created[0]) {
          setProjectId(created[0].id);
          setRestyleEntry(null);
          setStep('restyle');
        }
      } finally {
        setImporting(false);
      }
    });

  const navigate = (nextStep) => {
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

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
    setTheme(next);
  };

  if (!data)
    return (
      <div className="app-booting" role="status">
        <LoaderCircle size={22} />
        正在连接本机工作台…
      </div>
    );

  return (
    <div className={`app-shell ${sidebar ? '' : 'sidebar-collapsed'}`}>
      <input
        ref={projectInput}
        hidden
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/heic,image/heif,image/tiff"
        onChange={(event) => {
          importImageProjects([...(event.target.files || [])]);
          event.target.value = '';
        }}
      />
      <aside className={`sidebar ${sidebar ? 'open' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark">
            <img src="/assets/hongrenguan-icon.png" alt="" />
          </div>
          <div>
            <strong>红人馆AI</strong>
            <span>FASHION RESTYLE</span>
          </div>
          <IconButton label="收起侧边栏" onClick={() => setSidebar(false)}>
            <PanelLeftClose size={18} />
          </IconButton>
        </div>
        <button
          className="new-project"
          disabled={importing}
          onClick={() => projectInput.current?.click()}
        >
          {importing ? <LoaderCircle className="spin" size={16} /> : <ImagePlus size={16} />}
          {importing ? '正在导入…' : '添加图片项目'}
        </button>
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
        <div className="project-list image-project-list">
          <div className="project-heading">
            <p className="nav-label">图片项目</p>
            <small>{imageProjects.length}</small>
          </div>
          {imageProjects.map((item) => {
            const cover = projectCover(item);
            const activeTask = data.tasks.find(
              (task) => task.projectId === item.id && isActive(task),
            );
            return (
              <button
                className={`project ${project?.id === item.id ? 'active' : ''}`}
                key={item.id}
                onClick={() => selectProject(item.id)}
              >
                <span className="project-thumb">
                  {cover ? <img src={assetUrl(cover)} alt="" /> : <ImagePlus size={16} />}
                </span>
                <span>
                  <b>{item.name}</b>
                  <small>
                    {activeTask
                      ? `${taskNames[activeTask.kind] || '改图'} · 处理中`
                      : `${item.looks.length} 次结果 · ${item.sourceFilename || '原图已保存'}`}
                  </small>
                </span>
                {activeTask && <span className="image-project-running" aria-label="任务处理中" />}
              </button>
            );
          })}
        </div>
        <button
          className={`account ${step === 'settings' ? 'active' : ''}`}
          onClick={() => openSettings(settingsTab)}
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
              <strong>{project?.name || '红人馆AI'}</strong>
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
          <div className={`workspace-view ${step === 'settings' ? '' : 'workspace-view-hidden'}`}>
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
          </div>
          <div className={`workspace-layer ${step === 'settings' ? 'settings-hidden' : ''}`}>
            {project ? (
              <>
                <div
                  className={`workspace-view ${workspaceStep === 'restyle' ? '' : 'workspace-view-hidden'}`}
                >
                  <DesignWorkspace
                    key={`${project.id}:restyle:${restyleEntry?.nonce || 'default'}`}
                    type="restyle"
                    project={project}
                    data={data}
                    act={act}
                    safe={safe}
                    onTask={() => openSettings('tasks')}
                    onAddImages={() => projectInput.current?.click()}
                    initialSourceLookId={
                      restyleEntry?.projectId === project.id ? restyleEntry.lookId : null
                    }
                  />
                </div>
                <div
                  className={`workspace-view ${workspaceStep === 'white' ? '' : 'workspace-view-hidden'}`}
                >
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
                </div>
              </>
            ) : (
              <Empty title="添加第一张需要改款的图片">
                <p>每张图片会建立独立项目，并保留自己的改款结果与操作历史。</p>
                <button className="primary-action" onClick={() => projectInput.current?.click()}>
                  <ImagePlus size={16} /> 添加图片
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
      {toast && (
        <div className="toast" role="status">
          <Check size={15} />
          {toast}
        </div>
      )}
    </div>
  );
}
