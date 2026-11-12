import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  Brain,
  CircleUserRound,
  Edit3,
  FolderDown,
  FolderOpen,
  KeyRound,
  ListTodo,
  Plus,
  PlugZap,
  Power,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { modelLabel, request } from './api.js';
import { isDesktopShell, openAuthorizationUrl } from './auth.js';
import { SmartConcurrencyStatus, TaskCenter } from './components.jsx';
import {
  OPENAI_ANALYSIS_MODEL,
  OPENAI_API_BASE_URL,
  OPENAI_IMAGE_MODEL,
} from '../shared/openai-defaults.js';

const tabs = [
  { id: 'account', label: '帐号管理', detail: '授权与套餐状态', icon: CircleUserRound },
  { id: 'tasks', label: '任务中心', detail: '进度与执行控制', icon: ListTodo },
  { id: 'api', label: 'API 管理', detail: '模型、智能并发与连接', icon: PlugZap },
  { id: 'output', label: '成片文件夹', detail: '自动保存与同步', icon: FolderDown },
];

function AccountSettings({ executor, onRefresh }) {
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const poller = useRef(null);
  useEffect(() => () => window.clearInterval(poller.current), []);

  const recheck = async () => {
    setBusy('check');
    setMessage('');
    try {
      const status = await request('/provider', {
        method: 'PUT',
        body: { mode: 'account' },
      });
      await onRefresh();
      setMessage(status.ready ? '帐号与 AI 服务已连接。' : status.message);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy('');
    }
  };

  const authorize = async () => {
    setBusy('authorize');
    setMessage('');
    const desktopShell = isDesktopShell(window.navigator.userAgent);
    const popup = desktopShell
      ? null
      : window.open('', 'badmark-account', 'popup,width=560,height=760');
    try {
      const result = await request('/auth/login', { method: 'POST' });
      openAuthorizationUrl(result.authUrl, {
        userAgent: window.navigator.userAgent,
        location: window.location,
        popup,
        openWindow: window.open,
      });
      window.clearInterval(poller.current);
      poller.current = window.setInterval(async () => {
        try {
          const status = await request('/auth/status');
          if (status.state === 'pending') return;
          window.clearInterval(poller.current);
          if (status.state === 'failed') {
            setMessage(status.error || '帐号授权未完成。');
            setBusy('');
            return;
          }
          await request('/provider', {
            method: 'PUT',
            body: { mode: 'account' },
          });
          await onRefresh();
          setMessage('帐号授权已更新。');
          setBusy('');
        } catch {}
      }, 1800);
    } catch (error) {
      popup?.close();
      setMessage(error.message);
      setBusy('');
    }
  };

  const account = executor?.account;
  const accountReady = Boolean(account) && !executor?.authRequired;
  return (
    <section className="settings-detail" aria-label="帐号管理">
      <header className="settings-detail-head">
        <span>
          <CircleUserRound size={18} />
        </span>
        <div>
          <h1>帐号管理</h1>
          <p>查看当前授权帐号，重新检测或更新登录授权。</p>
        </div>
      </header>
      <div className="settings-account-card">
        <span className={`settings-status-icon ${accountReady ? 'ready' : ''}`}>
          {accountReady ? <BadgeCheck size={24} /> : <CircleUserRound size={24} />}
        </span>
        <div>
          <small>当前帐号</small>
          <strong>{account?.email || '尚未登录帐号'}</strong>
          <p>
            {accountReady
              ? account?.planType
                ? `${account.planType} 套餐 · 帐号授权可用`
                : '帐号授权可用，套餐信息暂不可用'
              : '未登录不影响浏览和管理本机项目；执行 AI 任务前再完成授权。'}
          </p>
        </div>
        <span className={`settings-state-pill ${accountReady ? 'ready' : ''}`}>
          {accountReady ? '已登录' : '未登录'}
        </span>
      </div>
      <div className="settings-action-row">
        <button className="primary-action" onClick={authorize} disabled={Boolean(busy)}>
          <KeyRound size={15} />
          {busy === 'authorize' ? '等待授权…' : accountReady ? '更新帐号授权' : '登录帐号'}
        </button>
        <button className="outline-action" onClick={recheck} disabled={Boolean(busy)}>
          <RefreshCw size={15} />
          {busy === 'check' ? '正在检测…' : '重新检测帐号'}
        </button>
      </div>
      {message && (
        <p className="settings-inline-message" role="status">
          {message}
        </p>
      )}
      <div className="settings-info-grid">
        <article>
          <ShieldCheck size={18} />
          <strong>本机安全授权</strong>
          <p>登录由系统浏览器完成，工作台不显示或复制访问令牌。</p>
        </article>
        <article>
          <Brain size={18} />
          <strong>帐号与图片分离</strong>
          <p>原图、参考图和成片只保存在本机工作台，不会写入帐号资料。</p>
        </article>
      </div>
    </section>
  );
}

function OutputDirectorySettings({ config = {}, act, safe }) {
  const [directory, setDirectory] = useState(config.path || '');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => setDirectory(config.path || ''), [config.path]);

  const run = (name, action, success) =>
    safe(async () => {
      setBusy(name);
      setMessage('');
      try {
        const result = await act(action, success);
        if (name === 'sync') setMessage(`已同步 ${result.copied} 个生成文件。`);
      } finally {
        setBusy('');
      }
    });

  const chooseDirectory = async () => {
    if (!window.bomiDesktop?.selectOutputDirectory) {
      setMessage('当前为浏览器模式，请在下方输入文件夹完整路径后绑定。');
      return;
    }
    const selected = await window.bomiDesktop.selectOutputDirectory();
    if (selected) setDirectory(selected);
  };

  return (
    <section className="settings-detail output-directory-settings" aria-label="成片文件夹">
      <header className="settings-detail-head">
        <span>
          <FolderDown size={18} />
        </span>
        <div>
          <h1>成片文件夹</h1>
          <p>绑定本地文件夹后，每个新生成的完整改款成片都会自动保存一份副本。</p>
        </div>
      </header>
      <div className={`output-directory-card ${config.enabled ? 'ready' : ''}`}>
        <span className={`settings-status-icon ${config.enabled ? 'ready' : ''}`.trim()}>
          <FolderOpen size={22} />
        </span>
        <div>
          <small>{config.enabled ? '正在自动保存' : '尚未启用自动保存'}</small>
          <strong>{config.path || '未绑定本地文件夹'}</strong>
          <p>
            {config.enabled
              ? '后续生成结果会在进入成片管理的同时复制到此文件夹。'
              : '绑定不会移动或删除工作台中的原文件。'}
          </p>
        </div>
        <span className={`settings-state-pill ${config.enabled ? 'ready' : ''}`}>
          {config.enabled ? '已绑定' : '未绑定'}
        </span>
      </div>
      <label className="output-directory-field">
        <span>本地文件夹完整路径</span>
        <div>
          <input
            value={directory}
            placeholder="例如：/Users/你的名字/Pictures/红人馆AI成片"
            onChange={(event) => setDirectory(event.target.value)}
          />
          <button className="outline-action" type="button" onClick={chooseDirectory}>
            <FolderOpen size={14} /> 选择文件夹
          </button>
        </div>
      </label>
      <div className="settings-action-row">
        <button
          className="primary-action"
          disabled={!directory.trim() || Boolean(busy)}
          onClick={() =>
            run(
              'bind',
              () =>
                request('/output-directory', {
                  method: 'PUT',
                  body: { path: directory.trim(), enabled: true },
                }),
              '成片文件夹已绑定',
            )
          }
        >
          <FolderDown size={15} />
          {busy === 'bind' ? '正在绑定…' : config.enabled ? '更新绑定' : '绑定并启用'}
        </button>
        <button
          className="outline-action"
          disabled={!config.enabled || Boolean(busy)}
          onClick={() =>
            run(
              'sync',
              () => request('/output-directory/sync', { method: 'POST' }),
              '已有生成文件已同步',
            )
          }
        >
          <RefreshCw size={15} /> {busy === 'sync' ? '同步中…' : '同步已有成片'}
        </button>
        <button
          className="outline-action"
          disabled={!config.enabled || Boolean(busy)}
          onClick={() =>
            run(
              'disable',
              () =>
                request('/output-directory', {
                  method: 'PUT',
                  body: { path: config.path, enabled: false },
                }),
              '已停止自动保存',
            )
          }
        >
          <Power size={15} /> 停止自动保存
        </button>
      </div>
      {(message || config.lastError) && (
        <p className={`settings-inline-message ${config.lastError ? 'error' : ''}`} role="status">
          {config.lastError ? `最近保存失败：${config.lastError}` : message}
        </p>
      )}
      {config.lastSavedFile && (
        <div className="output-directory-last">
          <small>最近保存</small>
          <strong>{config.lastSavedFile}</strong>
          <span>
            {config.lastSavedAt ? new Date(config.lastSavedAt).toLocaleString('zh-CN') : ''}
          </span>
        </div>
      )}
    </section>
  );
}

const newApiForm = (providerType = 'openai') =>
  providerType === 'openai'
    ? {
        providerType,
        name: 'OpenAI API',
        baseUrl: OPENAI_API_BASE_URL,
        apiKey: '',
        analysisModel: OPENAI_ANALYSIS_MODEL,
        imageModel: OPENAI_IMAGE_MODEL,
        enabled: true,
        roles: { analysis: true, image: true },
      }
    : {
        providerType,
        name: '',
        baseUrl: '',
        apiKey: '',
        analysisModel: '',
        imageModel: '',
        enabled: true,
        roles: { analysis: true, image: false },
      };

const officialOpenAiAnalysisModels = [
  OPENAI_ANALYSIS_MODEL,
  'gpt-6.1-sol',
  'gpt-6.1-terra',
  'gpt-6-luna',
];
const officialOpenAiImageModels = [
  'gpt-image-2.6-sunburst',
  'gpt-image-2.6-flare',
  OPENAI_IMAGE_MODEL,
  'gpt-image-2.5-flare',
  'gpt-image-2',
];
const uniqueModels = (items) => [...new Set(items.filter(Boolean))];

function ApiSettings({ executor, act, safe }) {
  const [busy, setBusy] = useState('');
  const [form, setForm] = useState(() => newApiForm());
  const [editingId, setEditingId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const provider = executor?.provider || { mode: 'account', profiles: [] };
  const profiles = provider.profiles || [];
  const activeProfiles = provider.activeProfiles || {};
  const canUseSavedApi = profiles.some((profile) => profile.enabled && profile.analysisModel);
  const selectedModel = executor?.models?.find((model) => model.id === executor.model);
  const activeTaskIds =
    executor?.activeTaskIds || (executor?.activeTaskId ? [executor.activeTaskId] : []);
  const locked = Boolean(busy) || activeTaskIds.length > 0;
  const detectedModelIds = (executor?.models || []).map((model) => model.id);
  const openAiAnalysisModels = uniqueModels([
    ...officialOpenAiAnalysisModels,
    ...detectedModelIds.filter((id) => /^gpt-(?!image)/i.test(id)),
  ]);
  const openAiImageModels = uniqueModels([
    ...officialOpenAiImageModels,
    ...detectedModelIds.filter((id) => /^gpt-image/i.test(id)),
  ]);
  const perform = (key, action, success, after) =>
    safe(async () => {
      setBusy(key);
      try {
        await act(action, success);
        after?.();
      } finally {
        setBusy('');
      }
    });
  const openNew = () => {
    setEditingId(null);
    setForm(newApiForm());
    setFormOpen(true);
  };
  const openEdit = (profile) => {
    setEditingId(profile.id);
    setForm({
      providerType: profile.providerType || 'compatible',
      name: profile.name,
      baseUrl: profile.baseUrl,
      apiKey: '',
      analysisModel: profile.analysisModel || '',
      imageModel: profile.imageModel || '',
      enabled: profile.enabled,
      roles: { ...profile.roles },
    });
    setFormOpen(true);
  };
  const updateForm = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const selectProviderType = (providerType) => {
    setForm((current) => {
      if (providerType === current.providerType) return current;
      const defaults = newApiForm(providerType);
      return {
        ...defaults,
        apiKey: current.apiKey,
        enabled: current.enabled,
        roles: defaults.roles,
      };
    });
  };
  const updateRole = (role, value) =>
    setForm((current) => ({ ...current, roles: { ...current.roles, [role]: value } }));
  const saveProfile = (event) => {
    event.preventDefault();
    const endpoint = editingId ? `/providers/${editingId}` : '/providers';
    const body = { ...form };
    if (editingId && !body.apiKey) delete body.apiKey;
    perform(
      'save-profile',
      () => request(endpoint, { method: editingId ? 'PATCH' : 'POST', body }),
      editingId ? 'API 配置已更新并重新检测' : 'API 已保存并完成检测',
      () => {
        setFormOpen(false);
        setEditingId(null);
        setForm(newApiForm());
      },
    );
  };
  const patchProfile = (profile, patch, success) =>
    perform(
      `profile-${profile.id}`,
      () => request(`/providers/${profile.id}`, { method: 'PATCH', body: patch }),
      success,
    );
  const switchMode = (mode) =>
    perform(
      'provider-mode',
      () => request('/provider', { method: 'PUT', body: { mode } }),
      mode === 'account' ? '已切换到帐号模式' : '已切换到已保存 API',
    );
  return (
    <section className="settings-detail" aria-label="API 管理">
      <header className="settings-detail-head">
        <span>
          <PlugZap size={18} />
        </span>
        <div>
          <h1>API 管理</h1>
          <p>保存多个第三方接口，并分别指定分析和生图服务。</p>
        </div>
      </header>
      <div className="api-status-strip">
        <span className={executor?.ready ? 'ready' : ''}>
          <i />
          {executor?.ready ? 'AI 服务已就绪' : 'AI 服务不可用'}
        </span>
        <span className={executor?.imageGeneration ? 'ready' : 'warning'}>
          <i />
          {executor?.imageGeneration
            ? '生图能力可用'
            : executor?.imageIssue?.code === 'usage-limit'
              ? '生图额度已用尽'
              : '生图能力不可用'}
        </span>
        <span>
          <i />
          {provider.mode === 'third-party' ? '已保存 API 模式' : '帐号模式'}
        </span>
        <span className={activeProfiles.analysis ? 'ready' : ''}>
          <i />
          {activeProfiles.analysis ? '分析服务已指定' : '未指定分析服务'}
        </span>
        <span className={activeProfiles.image ? 'ready' : ''}>
          <i />
          {activeProfiles.image ? '生图服务已指定' : '未指定生图服务'}
        </span>
      </div>
      {executor && !executor.ready && !executor.checking && (
        <div className="api-provider-alert" role="alert">
          <AlertTriangle size={18} />
          <div>
            <strong>当前连接无法执行智能助手和任务</strong>
            <p>{executor.message || '请检查当前连接配置后重新检测。'}</p>
          </div>
          <button
            className="outline-action"
            disabled={locked}
            onClick={() =>
              perform(
                'check',
                () => request('/executor/check', { method: 'POST' }),
                'AI 连接已重新检测',
              )
            }
          >
            <RefreshCw size={14} />
            {busy === 'check' ? '检测中…' : '重新检测'}
          </button>
        </div>
      )}
      <div className="api-mode-switch" aria-label="AI 连接方式">
        <div className="api-mode-switch-head">
          <strong>选择任务执行方式</strong>
          <p>任务只会使用当前选中的连接方式。</p>
        </div>
        <div className="api-mode-options">
          <button
            className={provider.mode === 'account' ? 'active' : ''}
            disabled={locked}
            onClick={() => switchMode('account')}
            aria-pressed={provider.mode === 'account'}
            aria-label="使用帐号模式"
          >
            <span className="api-mode-icon">
              <CircleUserRound size={19} />
            </span>
            <span className="api-mode-copy">
              <strong>帐号模式</strong>
              <small>使用已授权帐号执行</small>
            </span>
            <span className="api-mode-state">
              {provider.mode === 'account' ? (
                <>
                  <BadgeCheck size={13} /> 当前模式
                </>
              ) : (
                '切换'
              )}
            </span>
          </button>
          <button
            className={provider.mode === 'third-party' ? 'active' : ''}
            disabled={locked || !canUseSavedApi}
            onClick={() => switchMode('third-party')}
            aria-pressed={provider.mode === 'third-party'}
            aria-label="使用第三方 API 模式"
          >
            <span className="api-mode-icon">
              <PlugZap size={19} />
            </span>
            <span className="api-mode-copy">
              <strong>第三方 API</strong>
              <small>
                {activeProfiles.analysis
                  ? '调用已启用的 API 接口'
                  : canUseSavedApi
                    ? '切换时自动分配已填写的模型'
                    : '请先添加并启用分析 API'}
              </small>
            </span>
            <span className="api-mode-state">
              {provider.mode === 'third-party' ? (
                <>
                  <BadgeCheck size={13} /> 当前模式
                </>
              ) : canUseSavedApi ? (
                '切换'
              ) : (
                '不可用'
              )}
            </span>
          </button>
        </div>
      </div>
      <div className="api-profile-heading">
        <div>
          <strong>API 服务</strong>
          <small>密钥始终隐藏；可以随时关闭或重新分配用途。</small>
        </div>
        <button className="primary-action" disabled={locked} onClick={openNew}>
          <Plus size={15} />
          添加 API
        </button>
      </div>
      <div className="api-profile-list">
        {!profiles.length && (
          <div className="api-profile-empty">
            <KeyRound size={22} />
            <strong>还没有保存 API</strong>
            <span>添加后可作为分析、生图或两种任务的服务。</span>
          </div>
        )}
        {profiles.map((profile) => (
          <article
            className={`api-profile-card ${profile.enabled ? '' : 'disabled'}`}
            key={profile.id}
          >
            <header>
              <span className="api-profile-icon">
                <PlugZap size={17} />
              </span>
              <div>
                <strong>
                  {profile.name}
                  <em className="api-profile-type-badge">
                    {profile.providerType === 'openai' ? 'OpenAI 官方' : '兼容 API'}
                  </em>
                </strong>
                <small>{profile.baseUrl}</small>
              </div>
              <button
                className={`api-power-button ${profile.enabled ? 'active' : ''}`}
                aria-label={`${profile.enabled ? '关闭' : '开启'} ${profile.name}`}
                title={profile.enabled ? '关闭 API' : '开启 API'}
                disabled={locked}
                onClick={() =>
                  patchProfile(
                    profile,
                    { enabled: !profile.enabled },
                    profile.enabled ? 'API 已关闭' : 'API 已开启',
                  )
                }
              >
                <Power size={15} />
              </button>
            </header>
            <div className="api-profile-key">
              <KeyRound size={13} />
              <span>API Key</span>
              <code>••••••••••••</code>
              <em>{profile.keyStored ? '已保存' : '未设置'}</em>
            </div>
            <div className="api-role-row" aria-label={`${profile.name} 的参与任务`}>
              <button
                className={profile.roles.analysis ? 'active' : ''}
                disabled={locked}
                onClick={() =>
                  patchProfile(
                    profile,
                    { roles: { ...profile.roles, analysis: !profile.roles.analysis } },
                    profile.roles.analysis ? '已取消参与分析' : '已设为分析服务',
                  )
                }
              >
                参与分析 {activeProfiles.analysis === profile.id && <BadgeCheck size={13} />}
              </button>
              <button
                className={profile.roles.image ? 'active' : ''}
                disabled={locked}
                onClick={() =>
                  patchProfile(
                    profile,
                    { roles: { ...profile.roles, image: !profile.roles.image } },
                    profile.roles.image ? '已取消参与生图' : '已设为生图服务',
                  )
                }
              >
                参与生图 {activeProfiles.image === profile.id && <BadgeCheck size={13} />}
              </button>
            </div>
            <div className="api-profile-models">
              <span>
                分析 <b>{profile.analysisModel || '未设置'}</b>
              </span>
              <span>
                生图 <b>{profile.imageModel || '未设置'}</b>
              </span>
            </div>
            <footer>
              <button disabled={locked} onClick={() => openEdit(profile)}>
                <Edit3 size={14} />
                编辑
              </button>
              <button
                className="danger-action"
                disabled={locked}
                onClick={() => {
                  if (!window.confirm(`删除“${profile.name}”？本机保存的密钥也会一并删除。`))
                    return;
                  perform(
                    `delete-${profile.id}`,
                    () => request(`/providers/${profile.id}`, { method: 'DELETE' }),
                    'API 已删除',
                  );
                }}
              >
                <Trash2 size={14} />
                删除
              </button>
            </footer>
          </article>
        ))}
      </div>
      {formOpen && (
        <form className="api-profile-form" onSubmit={saveProfile}>
          <header>
            <div>
              <strong>{editingId ? '编辑 API' : '添加 API'}</strong>
              <small>留空密钥不会覆盖已保存的值。</small>
            </div>
            <button type="button" aria-label="关闭 API 表单" onClick={() => setFormOpen(false)}>
              <X size={16} />
            </button>
          </header>
          <div className="api-profile-type" aria-label="API 接口类型">
            <button
              type="button"
              className={form.providerType === 'openai' ? 'active' : ''}
              aria-pressed={form.providerType === 'openai'}
              onClick={() => selectProviderType('openai')}
            >
              <BadgeCheck size={16} />
              <span>
                <strong>OpenAI 官方 API</strong>
                <small>自动使用 Responses 与 Images 接口</small>
              </span>
            </button>
            <button
              type="button"
              className={form.providerType === 'compatible' ? 'active' : ''}
              aria-pressed={form.providerType === 'compatible'}
              onClick={() => selectProviderType('compatible')}
            >
              <PlugZap size={16} />
              <span>
                <strong>通用兼容 API</strong>
                <small>适用 OpenAI 格式的第三方服务</small>
              </span>
            </button>
          </div>
          <div className="api-profile-form-grid">
            <label>
              <span>API 名称</span>
              <input
                value={form.name}
                onChange={(event) => updateForm('name', event.target.value)}
                required
              />
            </label>
            <label>
              <span>Base URL</span>
              <input
                type="url"
                value={form.baseUrl}
                placeholder="https://api.example.com/v1"
                onChange={(event) => updateForm('baseUrl', event.target.value)}
                readOnly={form.providerType === 'openai'}
                required
              />
            </label>
            <label>
              <span>API Key</span>
              <input
                type="password"
                autoComplete="new-password"
                value={form.apiKey}
                placeholder={editingId ? '已保存；留空保持不变' : '输入后始终隐藏'}
                onChange={(event) => updateForm('apiKey', event.target.value)}
                required={!editingId}
              />
            </label>
            <label>
              <span>分析模型</span>
              <input
                list={form.providerType === 'openai' ? 'openai-analysis-model-list' : undefined}
                value={form.analysisModel}
                placeholder={
                  form.providerType === 'openai' ? OPENAI_ANALYSIS_MODEL : 'vision-model'
                }
                onChange={(event) => updateForm('analysisModel', event.target.value)}
                required={form.roles.analysis}
              />
            </label>
            <label>
              <span>图像模型</span>
              <input
                list={form.providerType === 'openai' ? 'openai-image-model-list' : undefined}
                value={form.imageModel}
                placeholder={form.providerType === 'openai' ? OPENAI_IMAGE_MODEL : 'image-model'}
                onChange={(event) => updateForm('imageModel', event.target.value)}
                required={form.roles.image}
              />
            </label>
          </div>
          {form.providerType === 'openai' && (
            <>
              <datalist id="openai-analysis-model-list">
                {openAiAnalysisModels.map((model) => (
                  <option value={model} key={model} />
                ))}
              </datalist>
              <datalist id="openai-image-model-list">
                {openAiImageModels.map((model) => (
                  <option value={model} key={model} />
                ))}
              </datalist>
              <p className="api-model-list-hint">
                点击模型输入框查看可选列表；也可直接输入当前 API Key 已开放的模型 ID。
              </p>
            </>
          )}
          <div className="api-profile-form-roles">
            <label>
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => updateForm('enabled', event.target.checked)}
              />
              <span>立即开启</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={form.roles.analysis}
                onChange={(event) => updateRole('analysis', event.target.checked)}
              />
              <span>参与分析</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={form.roles.image}
                onChange={(event) => updateRole('image', event.target.checked)}
              />
              <span>参与生图</span>
            </label>
          </div>
          <div className="api-provider-footer">
            <small>
              凭据保存在本机独立文件中，仅当前系统用户可读；不会返回前端、写入项目或导出文件。
            </small>
            <button className="primary-action" disabled={locked}>
              <ShieldCheck size={15} />
              {busy === 'save-profile' ? '正在保存…' : '保存并检测'}
            </button>
          </div>
        </form>
      )}
      <div className="api-settings-grid">
        <label>
          <span>任务模型</span>
          <select
            aria-label="任务模型"
            value={executor?.model || ''}
            disabled={locked}
            onChange={(event) =>
              perform(
                'model',
                () =>
                  request('/executor/control', {
                    method: 'POST',
                    body: { action: 'model', model: event.target.value },
                  }),
                '任务模型已更新',
              )
            }
          >
            {!executor?.models?.length && <option value="">暂无可用模型</option>}
            {executor?.models?.map((model) => (
              <option value={model.id} key={model.id}>
                {modelLabel(model)}
                {model.id === executor.recommendedModel ? ' · 推荐快速' : ''}
              </option>
            ))}
          </select>
          <small>{selectedModel?.description || '重新检测连接后显示模型信息。'}</small>
        </label>
        <SmartConcurrencyStatus executor={executor} className="api-smart-concurrency" />
      </div>
      <div className="api-connection-card">
        <div>
          <strong>本机服务接口</strong>
          <code>{window.location.origin}/api</code>
        </div>
        <p>第三方 API 的计费、数据使用和可用性由对应提供商负责。</p>
        <button
          className="outline-action"
          disabled={locked}
          onClick={() =>
            perform(
              'check',
              () => request('/executor/check', { method: 'POST' }),
              'AI 连接已重新检测',
            )
          }
        >
          <RefreshCw size={15} />
          {busy === 'check' ? '检测中…' : '重新检测连接'}
        </button>
      </div>
    </section>
  );
}

export function SettingsWorkspace({
  tab,
  onTab,
  data,
  project,
  projectId,
  act,
  safe,
  onRefresh,
  onViewTask,
}) {
  return (
    <section className="page-scroll settings-workspace" aria-label="设置">
      <header className="settings-heading">
        <span>
          <Settings2 size={17} />
          工作台设置
        </span>
        <h1>设置</h1>
        <p>统一管理帐号授权、改款任务、成片文件夹和 AI 接口。</p>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="设置分类">
          {tabs.map(({ id, label, detail, icon: Icon }) => (
            <button className={tab === id ? 'active' : ''} onClick={() => onTab(id)} key={id}>
              <span>
                <Icon size={17} />
              </span>
              <span>
                <strong>{label}</strong>
                <small>{detail}</small>
              </span>
              {id === 'tasks' && (
                <em>
                  {
                    data.tasks.filter((task) =>
                      ['pending', 'running', 'paused'].includes(task.status),
                    ).length
                  }
                </em>
              )}
            </button>
          ))}
        </nav>
        <div className="settings-panel">
          {tab === 'account' && <AccountSettings executor={data.executor} onRefresh={onRefresh} />}
          {tab === 'tasks' && (
            <section className="settings-detail task-settings-detail" aria-label="任务中心">
              <header className="settings-detail-head">
                <span>
                  <ListTodo size={18} />
                </span>
                <div>
                  <h1>任务中心</h1>
                  <p>查看所有任务进度，单独开始、暂停、重试、结束或删除记录。</p>
                </div>
              </header>
              <TaskCenter
                tasks={data.tasks}
                projects={data.projects}
                executor={data.executor}
                projectId={projectId}
                onView={onViewTask}
                act={act}
                safe={safe}
                showConfiguration={false}
              />
            </section>
          )}
          {tab === 'api' && <ApiSettings executor={data.executor} act={act} safe={safe} />}
          {tab === 'output' && (
            <OutputDirectorySettings config={data.outputDirectory} act={act} safe={safe} />
          )}
        </div>
      </div>
    </section>
  );
}
