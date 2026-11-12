import React, { useEffect, useRef, useState } from 'react';
import { sortImages } from './imageSort.js';
import { ImageSortControl, useImageSort } from './ImageSortControl.jsx';
import {
  Archive,
  ArrowDownToLine,
  ArrowRight,
  Check,
  Columns2,
  Image,
  LayoutGrid,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Upload,
} from 'lucide-react';
import { request, saveBlob, assetUrl, isActive, taskNames, statusNames } from './api.js';
import {
  ActionMenu,
  Modal,
  Empty,
  IconButton,
  AnalysisEditor,
  ImageScrollRail,
  ImageLightbox,
} from './components.jsx';
import { activateAdjacentThumbnail } from './thumbnailNavigation.js';
import { GenerationSlotRail } from './GenerationSlotRail.jsx';
import { findVisibleGenerationTask } from './generationSlots.js';

const fields = [
  'name',
  'group',
  'prompt',
  'lookCount',
  'logoMethod',
  'patternCoverage',
  'trendRefs',
  'modelRefId',
  'brandRefId',
  'patternRefId',
  'fabricRefId',
  'backgroundRefId',
  'customRefIds',
  'keepIdentity',
  'logoHarmony',
  'autoInvert',
];
const settings = (p) =>
  Object.fromEntries(
    fields.map((key) => [key, key === 'trendRefs' ? structuredClone(p[key] || []) : p[key]]),
  );
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const defaultSeriesPrompt =
  '分析所选流行趋势报告，并根据趋势方向将模特生成指定数量的同类风格款式。服装搭配、配饰、妆发均可调整；Logo 需根据服装风格协调调整大小、颜色、工艺和表现风格。其他要求或限制以本系列描述为准。';
const additionalSeriesPrompt = (prompt = '') =>
  prompt.startsWith(defaultSeriesPrompt) ? prompt.slice(defaultSeriesPrompt.length).trim() : prompt;
const storedSeriesPrompt = (additional = '') =>
  additional.trim() ? `${defaultSeriesPrompt}\n\n${additional.trim()}` : defaultSeriesPrompt;
const appendSeriesRequirement = (prompt, requirement) =>
  storedSeriesPrompt(
    [additionalSeriesPrompt(prompt).trim(), requirement.trim()].filter(Boolean).join('\n'),
  );

function lookPreviewItems(look, showWhite) {
  const currentAssetId = showWhite && look.white ? look.white : look.scene;
  const items = [];
  const seen = new Set();
  const add = (assetId, title, label, canSetPrimary = true) => {
    if (!assetId || seen.has(assetId)) return;
    seen.add(assetId);
    items.push({
      assetId,
      src: assetUrl(assetId),
      title,
      label,
      isPrimary: assetId === look.scene,
      canSetPrimary,
    });
  };
  const originalAssetId = look.originalScene || look.versions?.[0]?.scene;
  add(originalAssetId, `${look.title} · 未改原图`, '未改原图');
  (look.versions || []).forEach((version, index) =>
    add(version.scene, `${look.title} · 历史版本 ${index + 1}`, `历史版本 ${index + 1}`),
  );
  add(look.scene, `${look.title} · 当前主图`, '当前主图');
  const primaryItem = items.find((item) => item.assetId === look.scene);
  if (primaryItem) {
    primaryItem.title = `${look.title} · 当前主图`;
    primaryItem.label = '当前主图';
    primaryItem.isPrimary = true;
  }
  if (look.white) add(look.white, `${look.title} · 白底图`, '白底图', false);
  const currentIndex = Math.max(
    0,
    items.findIndex((item) => item.assetId === currentAssetId),
  );
  return { items, currentIndex };
}

function GeneratedImagePreview({
  look,
  showWhite,
  onClose,
  onPrevious,
  onNext,
  onSetPrimary,
  onDownload,
  onDownloadSelected,
}) {
  const { items, currentIndex } = lookPreviewItems(look, showWhite);
  const current = items[currentIndex] || items[0];
  return (
    <ImageLightbox
      src={current?.src}
      title={look.title}
      items={items}
      initialIndex={currentIndex}
      comparisonItems={items}
      selectable
      onSetPrimary={onSetPrimary}
      onDownload={onDownload}
      onDownloadSelected={onDownloadSelected}
      onPreviousGroup={onPrevious}
      onNextGroup={onNext}
      onClose={onClose}
    />
  );
}

function ReferencePicker({ kind, data, draft, onPatch, onClose, onManage }) {
  const isTrend = kind === 'trend';
  const items = isTrend
    ? data.trendLibrary.items.filter(
        (item) => !item.archivedAt && item.status === 'ready' && item.analysis,
      )
    : data.materialLibrary.items.filter(
        (item) =>
          !item.archivedAt &&
          (['custom', 'background'].includes(kind) ? item.kind === 'custom' : item.kind === kind),
      );
  const refs = draft.trendRefs || [];
  const chooseTrend = (item, role) => {
    const rest = refs.filter((ref) => ref.trendId !== item.id);
    if (role === 'primary')
      onPatch(
        'trendRefs',
        [
          { trendId: item.id, role: 'primary' },
          ...rest.filter((ref) => ref.role === 'secondary'),
        ].slice(0, 3),
      );
    else if (refs.some((ref) => ref.trendId === item.id && ref.role === 'secondary'))
      onPatch('trendRefs', rest);
    else if (rest.length < 3)
      onPatch('trendRefs', [...rest, { trendId: item.id, role: 'secondary' }]);
  };
  return (
    <Modal
      title={
        isTrend
          ? '选择趋势方向'
          : kind === 'model'
            ? '选择模特或模特组合（可选）'
            : kind === 'logo'
              ? '选择 Logo（可选）'
              : kind === 'pattern'
                ? '选择图案（可选）'
                : kind === 'fabric'
                  ? '选择面料（可选）'
                  : kind === 'background'
                    ? '选择背景参考（可选）'
                    : kind === 'custom'
                      ? '选择自定义参考素材'
                      : '选择参考素材'
      }
      onClose={onClose}
    >
      <div className="reference-picker">
        <header>
          <p>
            {isTrend
              ? '选择 1 个主趋势，并可增加最多 2 个辅助趋势。'
              : '选择会立即写入当前项目草稿，保存或生成时生效。'}
          </p>
          <button className="outline-action" onClick={onManage}>
            打开资料库
          </button>
        </header>
        <div className="reference-picker-grid">
          {items.map((item) => {
            const selected = isTrend
              ? refs.find((ref) => ref.trendId === item.id)
              : kind === 'custom'
                ? draft.customRefIds?.includes(item.id)
                : draft[
                    {
                      model: 'modelRefId',
                      logo: 'brandRefId',
                      pattern: 'patternRefId',
                      fabric: 'fabricRefId',
                      background: 'backgroundRefId',
                    }[kind]
                  ] === item.id;
            return (
              <article className={selected ? 'selected' : ''} key={item.id}>
                <img
                  src={
                    isTrend && !item.coverAssetId
                      ? `${assetUrl(item.assetId)}?preview=1`
                      : assetUrl(isTrend ? item.coverAssetId : item.assetId)
                  }
                  alt={item.title}
                />
                <div>
                  <b>{item.analysis?.theme || item.title}</b>
                  <span>{item.group}</span>
                </div>
                {isTrend ? (
                  <div className="picker-actions">
                    <button
                      className={selected?.role === 'primary' ? 'active' : ''}
                      onClick={() => chooseTrend(item, 'primary')}
                    >
                      主趋势
                    </button>
                    <button
                      className={selected?.role === 'secondary' ? 'active' : ''}
                      disabled={!selected && refs.length >= 3}
                      onClick={() => chooseTrend(item, 'secondary')}
                    >
                      辅助
                    </button>
                  </div>
                ) : (
                  <button
                    className="picker-select"
                    onClick={() => {
                      if (kind === 'custom') {
                        const current = draft.customRefIds || [];
                        onPatch(
                          'customRefIds',
                          selected ? current.filter((id) => id !== item.id) : [...current, item.id],
                        );
                      } else {
                        const field = {
                          model: 'modelRefId',
                          logo: 'brandRefId',
                          pattern: 'patternRefId',
                          fabric: 'fabricRefId',
                          background: 'backgroundRefId',
                        }[kind];
                        onPatch(field, selected ? null : item.id);
                      }
                    }}
                  >
                    {selected ? <Check size={13} /> : null}
                    {selected ? '已选择' : '选择'}
                  </button>
                )}
              </article>
            );
          })}
        </div>
        {!items.length && (
          <Empty title="资料库中没有可选内容">
            <p>请先上传并完成资料准备。</p>
          </Empty>
        )}
      </div>
    </Modal>
  );
}

export function ProjectWorkspace({
  project: p,
  data,
  step,
  setStep,
  act,
  safe,
  onTask,
  onRestyle,
}) {
  const [draft, setDraft] = useState(() => {
    try {
      return {
        ...settings(p),
        ...JSON.parse(sessionStorage.getItem(`badmark-draft:${p.id}`) || '{}'),
      };
    } catch {
      return settings(p);
    }
  });
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState(new Set());
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [variant, setVariant] = useState('scene');
  const [imageOrder, setImageOrder] = useImageSort('project');
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState('canvas');
  const [preview, setPreview] = useState(null);
  const [history, setHistory] = useState(false);
  const [historyPreview, setHistoryPreview] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [editAnalysis, setEditAnalysis] = useState(false);
  const [picker, setPicker] = useState(null);
  const fileInput = useRef(null);
  const uploadKind = useRef(null);
  const materialInput = useRef(null);
  const materialUploadKind = useRef(null);
  const dirty = fields.some((key) => !same(draft[key], p[key]));
  const previousSaved = useRef(settings(p));
  useEffect(() => {
    try {
      if (dirty) sessionStorage.setItem(`badmark-draft:${p.id}`, JSON.stringify(draft));
      else sessionStorage.removeItem(`badmark-draft:${p.id}`);
    } catch {}
  }, [dirty, draft, p.id]);
  useEffect(() => {
    const incoming = settings(p),
      previous = previousSaved.current;
    setDraft((current) =>
      Object.fromEntries(
        fields.map((k) => [k, same(current[k], previous[k]) ? incoming[k] : current[k]]),
      ),
    );
    previousSaved.current = incoming;
  }, [p.updatedAt, p.revision, p.group]);
  useEffect(
    () => setSelection((old) => new Set([...old].filter((id) => p.looks.some((l) => l.id === id)))),
    [p.looks.map((l) => l.id).join(',')],
  );
  const projectTasks = data.tasks.filter((t) => t.projectId === p.id && isActive(t));
  const task = projectTasks[0];
  const generationTask = findVisibleGenerationTask(data.tasks, p.id, 'series');
  const latest = data.tasks.find((t) => t.projectId === p.id);
  const liveTasks = data.tasks.filter(
    (candidate) =>
      candidate.projectId === p.id &&
      ['series', 'viral'].includes(candidate.kind) &&
      isActive(candidate) &&
      candidate.results.some((result) => result.assetId),
  );
  const savedAssets = new Set(p.looks.flatMap((look) => [look.scene, look.white].filter(Boolean)));
  const savedLookIds = new Set(p.looks.map((look) => look.id));
  const liveLooks = liveTasks.flatMap((liveTask) =>
    (liveTask.results || [])
      .filter(
        (result) =>
          result.assetId &&
          !savedAssets.has(result.assetId) &&
          (!result.lookId || !savedLookIds.has(result.lookId)),
      )
      .map((result) => ({
        id: `live:${liveTask.id}:${result.slot}`,
        title:
          liveTask.plan.find((item) => item.slot === result.slot)?.title ||
          `LOOK ${(liveTask.slotOffset || 0) + result.slot}`,
        scene: result.assetId,
        white: null,
        slot: (liveTask.slotOffset || 0) + result.slot,
        originKind: liveTask.kind,
        live: true,
      })),
  );
  const workspaceLooks = sortImages([...p.looks, ...liveLooks], imageOrder, data.assets);
  const generationAssetIds = new Set(
    (generationTask?.results || []).map((result) => result.assetId).filter(Boolean),
  );
  const filmstripLooks = workspaceLooks.filter((look) => !generationAssetIds.has(look.scene));
  const archivedLooks = sortImages(p.archivedLooks || [], imageOrder, data.assets);
  const locked = busy || Boolean(task);
  const current = workspaceLooks.find((l) => l.id === selected) || workspaceLooks[0];
  const lookLocked = (look) =>
    busy ||
    look.live ||
    projectTasks.some(
      (candidate) =>
        ['white', 'refine', 'restyle'].includes(candidate.kind) &&
        candidate.lookIds.includes(look.id),
    );
  const rememberLook = (look, value) =>
    act(
      () =>
        request(`/projects/${p.id}/looks/${look.id}/feedback`, {
          method: 'POST',
          body: { value: look.feedback === value ? 'clear' : value },
        }),
      look.feedback === value
        ? '已取消这条成片偏好'
        : value === 'liked'
          ? '已记住你喜欢这个方向'
          : '已记住后续避免这个方向',
    );
  const patch = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const save = async () => {
    if (!dirty) return p;
    const changes = Object.fromEntries(
      fields.filter((key) => !same(draft[key], p[key])).map((key) => [key, draft[key]]),
    );
    return request(`/projects/${p.id}`, {
      method: 'PATCH',
      body: { ...changes, expectedRevision: p.revision || 0 },
    });
  };
  const doWork = async (fn) => {
    setBusy(true);
    try {
      return await act(fn);
    } finally {
      setBusy(false);
    }
  };
  const queue = (body) =>
    safe(() =>
      doWork(async () => {
        if (!data.executor?.ready) throw new Error('任务执行器尚未连接，请等待连接恢复后重试。');
        await save();
        const { referenceFiles = [], ...task } = body;
        if (referenceFiles.length) {
          const form = new FormData();
          for (const file of referenceFiles) form.append('files', file);
          const uploaded = await request(`/projects/${p.id}/refine-references`, {
            method: 'POST',
            form,
          });
          task.referenceAssetIds = uploaded.assets.map((asset) => asset.id);
        }
        const created = await request(`/projects/${p.id}/tasks`, { method: 'POST', body: task });
        await request('/executor/control', {
          method: 'POST',
          body: { action: 'start-task', taskId: created.id },
        });
        return true;
      }),
    );
  const upload = (kind) => {
    uploadKind.current = kind;
    fileInput.current.accept =
      kind === 'report' ? 'application/pdf' : 'image/png,image/jpeg,image/webp,image/svg+xml';
    fileInput.current.click();
  };
  const onUpload = (event) => {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    if (!files.length) return;
    const kind = uploadKind.current;
    safe(() =>
      doWork(async () => {
        await save();
        for (const file of files) {
          const form = new FormData();
          form.append('file', file);
          await request(`/projects/${p.id}/assets/${kind}`, { method: 'POST', form });
        }
      }),
    );
  };
  const uploadFixedMaterial = (kind) => {
    materialUploadKind.current = kind;
    materialInput.current.click();
  };
  const onFixedMaterialUpload = (event) => {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    if (!files.length) return;
    const kind = materialUploadKind.current;
    const field = {
      model: 'modelRefId',
      logo: 'brandRefId',
      pattern: 'patternRefId',
      fabric: 'fabricRefId',
      background: 'backgroundRefId',
    }[kind];
    safe(() =>
      doWork(() =>
        act(async () => {
          const saved = await save();
          const items = [];
          for (const file of files) {
            const form = new FormData();
            form.append('file', file);
            items.push(
              await request(`/library/materials/${kind === 'background' ? 'custom' : kind}`, {
                method: 'POST',
                form,
              }),
            );
          }
          const updated = await request(`/projects/${p.id}`, {
            method: 'PATCH',
            body: {
              [field]: items[0].id,
              expectedRevision: saved?.revision ?? p.revision ?? 0,
            },
          });
          setDraft(settings(updated));
          return updated;
        }),
      ),
    );
  };
  const exportZip = (mode, lookIds = []) =>
    safe(() =>
      doWork(async () => {
        const blob = await request(`/projects/${p.id}/export`, {
          method: 'POST',
          body: { mode, lookIds },
          binary: true,
        });
        saveBlob(blob, `${p.name.replace(/[\\/:*?"<>|]/g, '_')}_${mode}.zip`);
      }),
    );
  const downloadLookAsset = async (look, assetId, label) => {
    const selectedAsset = assetId || (filter === 'white' && look.white ? look.white : look.scene);
    const asset = data.assets[selectedAsset];
    const extension = asset?.filename?.match(/\.[a-z0-9]+$/i)?.[0] || '.png';
    const projectName = p.name.replace(/[\\/:*?"<>|]/g, '_');
    const version = String(label || (selectedAsset === look.white ? 'white' : 'scene'))
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_');
    const slot = String(look.slot || p.looks.findIndex((item) => item.id === look.id) + 1).padStart(
      2,
      '0',
    );
    const blob = await request(`/files/${selectedAsset}?download=1`, { binary: true });
    saveBlob(blob, `${projectName}_LOOK_${slot}_${version}${extension}`);
  };
  const downloadLook = (look, assetId, label) =>
    safe(() => doWork(() => downloadLookAsset(look, assetId, label)));
  const manageLook = (look, action) =>
    safe(() =>
      doWork(async () => {
        await request(`/projects/${p.id}/looks/${action}`, {
          method: 'POST',
          body: { lookIds: [look.id] },
        });
        setSelection((current) => {
          const next = new Set(current);
          next.delete(look.id);
          return next;
        });
        if (selected === look.id) setSelected(null);
      }),
    );
  const visibleSource = filter === 'archived' ? archivedLooks : workspaceLooks;
  const visible = visibleSource.filter(
    (l) =>
      `${l.title} ${l.slot || visibleSource.indexOf(l) + 1}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === 'all' ||
        filter === 'archived' ||
        (['series', 'viral', 'restyle'].includes(filter) && l.originKind === filter) ||
        (filter === 'white' && l.white) ||
        (filter === 'pending' && !l.white) ||
        (filter === 'adjusted' && l.adjusted)),
  );
  const selectableVisible = visible.filter((look) => filter !== 'archived' && !look.live);
  const previewLooks =
    preview && archivedLooks.some((look) => look.id === preview.id)
      ? archivedLooks
      : workspaceLooks;
  const movePreview = (delta) =>
    setPreview((currentPreview) => {
      if (!currentPreview || previewLooks.length < 2) return currentPreview;
      const index = Math.max(
        0,
        previewLooks.findIndex((look) => look.id === currentPreview.id),
      );
      return previewLooks[(index + delta + previewLooks.length) % previewLooks.length];
    });
  const allSelected =
    selectableVisible.length > 0 && selectableVisible.every((l) => selection.has(l.id));
  const toggle = (id) =>
    setSelection((old) => {
      const next = new Set(old);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const imageOf = (look) => assetUrl(variant === 'white' ? look.white || look.scene : look.scene);
  const dimensionsOf = (look) => {
    const asset = data.assets[look.scene];
    return asset?.width && asset?.height ? `${asset.width} × ${asset.height}` : '';
  };
  const selectedLooks = p.looks.filter((l) => selection.has(l.id));
  const pendingWhite = selectedLooks.filter((l) => !l.white);
  const selectedTrends = (draft.trendRefs || [])
    .map((ref) => ({
      ...data.trendLibrary.items.find((item) => item.id === ref.trendId),
      role: ref.role,
    }))
    .filter((item) => item.id);
  const primaryTrend = selectedTrends.find((item) => item.role === 'primary');
  const modelItem = data.materialLibrary.items.find((item) => item.id === draft.modelRefId);
  const brandItem = data.materialLibrary.items.find((item) => item.id === draft.brandRefId);
  const patternItem = data.materialLibrary.items.find((item) => item.id === draft.patternRefId);
  const fabricItem = data.materialLibrary.items.find((item) => item.id === draft.fabricRefId);
  const backgroundItem = data.materialLibrary.items.find(
    (item) => item.id === draft.backgroundRefId,
  );
  const customItems = (draft.customRefIds || [])
    .map((id) => data.materialLibrary.items.find((item) => item.id === id))
    .filter(Boolean);
  const historyPreviewItems = [
    ...p.history.flatMap((entry) =>
      entry.looks.map((look) => ({
        src: assetUrl(look.white || look.scene),
        title: look.title,
      })),
    ),
    ...p.looks.flatMap((look) =>
      look.versions.map((version, index) => ({
        src: assetUrl(version.white || version.scene),
        title: `${look.title} · 历史版本 ${index + 1}`,
      })),
    ),
  ];
  const openHistoryPreview = (src, title) =>
    setHistoryPreview({
      src,
      title,
      items: historyPreviewItems,
      index: historyPreviewItems.findIndex((item) => item.src === src && item.title === title),
    });
  const needs = [
    !primaryTrend && { label: '选择主趋势', picker: 'trend' },
    primaryTrend && primaryTrend.status !== 'ready' && { label: '等待趋势提炼完成', step: 'trend' },
    !draft.prompt.trim() && { label: '填写系列描述', field: true },
    (!Number.isInteger(draft.lookCount) || draft.lookCount < 1 || draft.lookCount > 12) && {
      label: '造型数量需为 1–12',
      field: true,
    },
  ].filter(Boolean);

  return (
    <>
      <input ref={fileInput} type="file" hidden multiple onChange={onUpload} />
      <input
        ref={materialInput}
        type="file"
        hidden
        multiple
        accept="image/png,image/jpeg,image/webp,image/svg+xml,image/heic,image/heif,image/tiff"
        onChange={onFixedMaterialUpload}
      />
      {step === 'assets' && (
        <div className="original-downloads">
          {['model', 'logo']
            .filter((kind) => p.assets[kind])
            .map((kind) => (
              <a
                key={kind}
                href={`${assetUrl(data.assets[p.assets[kind]]?.originalId || p.assets[kind])}?download=1`}
                download
              >
                下载{kind === 'model' ? '模特' : 'Logo'}原文件
              </a>
            ))}
        </div>
      )}
      {task && (
        <button className="task-banner" onClick={onTask}>
          <Sparkles size={16} />
          <b>
            {projectTasks.length > 1
              ? `${projectTasks.length} 个任务同时处理中`
              : `${taskNames[task.kind]} · ${statusNames[task.status]}`}
          </b>
          <span>
            {projectTasks.reduce((sum, currentTask) => sum + currentTask.results.length, 0)}{' '}
            项已回传
          </span>
          <ArrowRight size={15} />
        </button>
      )}
      {!task && latest && ['failed', 'cancelled'].includes(latest.status) && (
        <button className="task-banner task-attention" onClick={onTask}>
          <b>
            {taskNames[latest.kind]} ·{' '}
            {latest.status === 'failed' ? '上次执行中断' : statusNames[latest.status]}
          </b>
          <span>
            已保留 {latest.results.length} / {latest.total} 项
            {latest.status === 'failed' ? `，仍缺 ${latest.total - latest.results.length} 项` : ''}
          </span>
          <span>{latest.canRetry ? '打开任务中心继续' : '查看任务记录'}</span>
        </button>
      )}
      {p.migrationNote && <p className="migration-note">{p.migrationNote}</p>}
      {step === 'trend' && (
        <section className="page-scroll">
          <div className="page-inner wide">
            <div className="page-heading">
              <div>
                <span className="eyebrow">STEP 01</span>
                <h1>趋势解析</h1>
                <p>读取真实报告，提取可追溯的主题、色彩与设计方向。</p>
              </div>
              <button className="outline-action" disabled={locked} onClick={() => upload('report')}>
                <Upload size={15} />
                {p.assets.report ? '批量更换报告' : '批量上传报告'}
              </button>
            </div>
            <div className="report-strip">
              <div className="pdf-icon">PDF</div>
              <div>
                <strong>{data.assets[p.assets.report]?.filename || '尚未上传趋势报告'}</strong>
                <span>
                  {data.assets[p.assets.report]?.pageCount
                    ? `${data.assets[p.assets.report].pageCount} 页 · `
                    : ''}
                  原文件持久保存在本机
                </span>
              </div>
              {p.assets.report && (
                <a
                  className="outline-action"
                  href={assetUrl(p.assets.report)}
                  target="_blank"
                  rel="noreferrer"
                >
                  查看原文
                </a>
              )}
            </div>
            {p.analysis ? (
              <>
                <div className="trend-grid">
                  <article className="trend-hero">
                    <div>
                      <span>核心主题</span>
                      <h2>{p.analysis.theme}</h2>
                      <p>{p.analysis.summary}</p>
                    </div>
                  </article>
                  <article>
                    <span className="card-label">趋势关键词</span>
                    <div className="keyword-cloud">
                      {p.analysis.keywords.map((k) => (
                        <b key={k}>{k}</b>
                      ))}
                    </div>
                  </article>
                  <article>
                    <span className="card-label">色彩方向</span>
                    <div className="color-list">
                      {p.analysis.colors.map((c, i) => (
                        <div key={i}>
                          <i style={{ background: c.hex }} />
                          <span>
                            {c.name}
                            <small>{c.hex}</small>
                          </span>
                        </div>
                      ))}
                    </div>
                  </article>
                </div>
                <div className="insight-row">
                  {[
                    ['关键廓形', p.analysis.silhouettes],
                    ['功能细节', p.analysis.functions],
                    ['表面工艺', p.analysis.techniques],
                  ].map(([label, value], i) => (
                    <article key={label}>
                      <span className="insight-number">0{i + 1}</span>
                      <div>
                        <h3>{label}</h3>
                        <p>{value}</p>
                      </div>
                    </article>
                  ))}
                </div>
                <details className="evidence">
                  <summary>查看报告依据 · {p.analysis.evidence.length} 处引用</summary>
                  {p.analysis.evidence.map((e, i) => (
                    <p key={i}>
                      <a
                        href={`${assetUrl(p.assets.report)}#page=${e.page}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        第 {e.page} 页
                      </a>
                      ：{e.note}
                    </p>
                  ))}
                </details>
                {p.analysis.editedBy && (
                  <p className="migration-note">已按人工反馈调整设计方向，报告原始依据保持不变。</p>
                )}
                <div className="page-footer">
                  <button
                    className="outline-action"
                    disabled={locked}
                    onClick={() => setEditAnalysis(true)}
                  >
                    调整设计方向
                  </button>
                  <button
                    className="outline-action"
                    disabled={locked}
                    onClick={() => queue({ kind: 'analysis' })}
                  >
                    重新解析
                  </button>
                  <button className="primary-action" onClick={() => setStep('assets')}>
                    确认趋势方向
                    <ArrowRight size={15} />
                  </button>
                </div>
              </>
            ) : (
              <Empty title={task?.kind === 'analysis' ? '报告正在自动处理' : '报告等待解析'}>
                <p>
                  {task
                    ? task.message
                    : '一键读取报告并生成设计方向与页码依据；完成后可直接修改与确认。'}
                </p>
                <button
                  className="primary-action"
                  disabled={!p.assets.report || locked}
                  onClick={() => queue({ kind: 'analysis' })}
                >
                  <Sparkles size={15} />
                  开始解析报告
                </button>
              </Empty>
            )}
          </div>
        </section>
      )}
      {step === 'assets' && (
        <section className="page-scroll">
          <div className="page-inner">
            <div className="page-heading">
              <div>
                <span className="eyebrow">STEP 02</span>
                <h1>素材准备</h1>
                <p>确认模特身份与品牌标识，原图将作为生成参考。</p>
              </div>
              <span className={`page-status ${p.confirmed && !dirty ? 'ok' : ''}`}>
                {p.confirmed && !dirty ? '已确认' : '待确认'}
              </span>
            </div>
            <div className="asset-workspace">
              {[
                ['model', '模特图', '用于人物面部、体型和构图参考。'],
                ['logo', '品牌 Logo', '用于品牌识别、颜色与工艺参考。'],
              ].map(([kind, label, description]) => (
                <article className="large-asset" key={kind}>
                  <div className={`asset-image ${kind === 'logo' ? 'logo-preview' : ''}`}>
                    {p.assets[kind] ? (
                      <img src={assetUrl(p.assets[kind])} alt={label} />
                    ) : (
                      <span>尚未上传{label}</span>
                    )}
                  </div>
                  <div className="asset-copy">
                    <div>
                      <h2>{label}</h2>
                      <p>{description}</p>
                    </div>
                    <button
                      className="outline-action"
                      disabled={locked}
                      onClick={() => upload(kind)}
                    >
                      <Upload size={14} />
                      {p.assets[kind] ? '批量替换' : '批量上传'}
                      {label}
                    </button>
                  </div>
                </article>
              ))}
            </div>
            <div className="brand-rule-panel">
              <h2>Logo 应用规则</h2>
              <p>系统会按服装廓形、版片空间与整体构图自动协调 Logo 大小和位置。</p>
              <div className="rule-controls">
                <label>
                  <span>默认工艺</span>
                  <select
                    disabled={locked}
                    value={draft.logoMethod}
                    onChange={(e) => patch('logoMethod', e.target.value)}
                  >
                    {['刺绣', '反光印花', '织章'].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>自动反色</span>
                  <input
                    aria-label="自动反色"
                    type="checkbox"
                    disabled={locked}
                    checked={draft.autoInvert}
                    onChange={(e) => patch('autoInvert', e.target.checked)}
                  />
                </label>
              </div>
            </div>
            <div className="page-footer">
              <span>AI 会尽力保持人物与 Logo，成片需人工复核。</span>
              <button
                className="primary-action"
                disabled={locked || !p.assets.model || !p.assets.logo}
                onClick={() =>
                  safe(() =>
                    doWork(async () => {
                      await save();
                      await request(`/projects/${p.id}/confirm`, { method: 'POST' });
                      setStep('generate');
                    }),
                  )
                }
              >
                <Check size={15} />
                确认并进入生成
              </button>
            </div>
          </div>
        </section>
      )}
      {step === 'generate' && (
        <section className="content-area">
          <div className="main-stage">
            <div className="stage-toolbar">
              <ImageSortControl value={imageOrder} onChange={setImageOrder} />
              <div className="series-meta">
                <strong>
                  {workspaceLooks.length ? `${workspaceLooks.length} 套已生成款式` : '尚未生成'}
                </strong>
                <span>
                  {liveLooks.length
                    ? `${liveLooks.length} 套实时生成 · 完成后自动归档`
                    : p.provenance || ''}
                </span>
              </div>
              <div className="background-toggle">
                <button
                  className={view === 'canvas' ? 'active' : ''}
                  onClick={() => setView('canvas')}
                  aria-label="画布视图"
                >
                  <Image size={14} />
                </button>
                <button
                  className={view === 'gallery' ? 'active' : ''}
                  onClick={() => setView('gallery')}
                  aria-label="成片视图"
                >
                  <LayoutGrid size={14} />
                </button>
                <button
                  className={variant === 'scene' ? 'active' : ''}
                  onClick={() => setVariant('scene')}
                >
                  场景
                </button>
                <button
                  className={variant === 'white' ? 'active' : ''}
                  onClick={() => setVariant('white')}
                >
                  白底
                </button>
              </div>
            </div>
            {!current && !generationTask ? (
              <Empty title="准备好，开始你的新系列">
                <p>完成趋势解析与素材确认后，让 AI 生成独立造型。</p>
              </Empty>
            ) : view === 'canvas' ? (
              <div className="canvas-view">
                {current ? (
                  <div className="hero-output">
                    <button
                      className="hero-image-button"
                      aria-label={`查看 ${current.title} 大图`}
                      onClick={() => setPreview(current)}
                    >
                      <img src={imageOf(current)} alt={current.title} />
                    </button>
                    <div className="image-caption">
                      <span>
                        {current.live
                          ? '实时生成 · 任务完成后归档'
                          : variant === 'white' && !current.white
                            ? '尚无白底 · 显示原场景'
                            : variant === 'white'
                              ? '白底成片'
                              : '场景成片'}
                      </span>
                      <strong>{current.title}</strong>
                    </div>
                  </div>
                ) : (
                  <div className="hero-output generation-waiting-hero" aria-live="polite">
                    <Sparkles size={24} />
                    <strong>正在生成首张图片</strong>
                    <span>结果会自动填入下方固定位置</span>
                  </div>
                )}
                <ImageScrollRail className="filmstrip" label="系列成片滚动栏">
                  {generationTask && (
                    <GenerationSlotRail
                      task={generationTask}
                      label="系列图片生成进度"
                      className="generation-slot-rail--filmstrip"
                      compact
                      onSelect={(slot) => {
                        const look = workspaceLooks.find((item) => item.scene === slot.assetId);
                        if (look) setSelected(look.id);
                      }}
                    />
                  )}
                  {filmstripLooks.map((l) => (
                    <button
                      className={`look-card ${current?.id === l.id ? 'selected' : ''}`}
                      key={l.id}
                      onClick={() => setSelected(l.id)}
                    >
                      <img src={imageOf(l)} alt={l.title} />
                      <span className="look-index">{l.slot || workspaceLooks.indexOf(l) + 1}</span>
                    </button>
                  ))}
                </ImageScrollRail>
              </div>
            ) : (
              <div className="gallery-view">
                <div className="gallery-heading">
                  <div>
                    <h2>{p.name}</h2>
                    <p>
                      {p.looks.length} 套已生成
                      {liveLooks.length ? ` · ${liveLooks.length} 套实时生成` : ''}
                    </p>
                  </div>
                  <button className="outline-action" onClick={() => exportZip('all')}>
                    导出系列
                  </button>
                </div>
                <div className="gallery-grid">
                  {workspaceLooks.map((l) => (
                    <button
                      className="look-card"
                      key={l.id}
                      onClick={() => {
                        setSelected(l.id);
                        setView('canvas');
                      }}
                    >
                      <img src={imageOf(l)} alt={l.title} />
                      <span className="look-name">
                        {l.title}
                        {l.live
                          ? ' · 实时生成'
                          : variant === 'white' && !l.white
                            ? ' · 待白底处理'
                            : ''}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <aside className="inspector">
            <div className="inspector-header">
              <strong>系列设置</strong>
              <span className="draft-status">{dirty ? '有未保存修改' : '已保存'}</span>
            </div>
            <section className="inspector-section">
              <label className="setting-label">
                项目名称
                <input
                  disabled={locked}
                  value={draft.name}
                  maxLength={100}
                  onChange={(e) => patch('name', e.target.value)}
                />
              </label>
            </section>
            <section className="inspector-section">
              <div className="section-title">
                <span>参考素材</span>
                <button onClick={() => setStep('assets')}>管理</button>
              </div>
              <div className="asset-grid">
                {[
                  ['model', '模特 / 组合（可选）', modelItem, true],
                  ['logo', 'Logo（可选）', brandItem, true],
                  ['pattern', '图案（可选）', patternItem, true],
                  ['fabric', '面料（可选）', fabricItem, true],
                  ['background', '背景（可选）', backgroundItem, true],
                  [
                    'custom',
                    customItems.length ? `其它参考 · ${customItems.length}` : '其它参考',
                    customItems[0],
                    false,
                  ],
                ].map(([role, label, item, localUpload]) => (
                  <article className="fixed-reference-card" key={role}>
                    <button className="asset" onClick={() => setPicker(role)}>
                      {item ? <img src={assetUrl(item.assetId)} alt={label} /> : <Plus size={24} />}
                      <span>{item?.title || label}</span>
                    </button>
                    {localUpload && (
                      <button
                        className="slot-upload"
                        disabled={locked}
                        aria-label={`批量上传${label.replace('（可选）', '')}`}
                        onClick={() => uploadFixedMaterial(role)}
                      >
                        <Upload size={12} /> 批量上传
                      </button>
                    )}
                  </article>
                ))}
              </div>
              <small className="series-prompt-example">
                单人模特按参考图呈现匹配男款或女款；多人组合会保留人数与组合关系，生成情侣款或系列款。
              </small>
            </section>
            <section className="inspector-section">
              <label className="setting-label">
                系列描述 · 仅新增要求
                <textarea
                  aria-label="系列描述"
                  disabled={locked}
                  value={additionalSeriesPrompt(draft.prompt)}
                  onChange={(e) => patch('prompt', storedSeriesPrompt(e.target.value))}
                  placeholder="案例：面向 25–35 岁通勤女性；以低饱和灰蓝为主；避免大面积印花；场景为雨后城市街区。"
                />
              </label>
              <small className="series-prompt-example">
                案例模版：目标人群 + 配色方向 + 必须保留或避免的元素 + 指定场景。
              </small>
              <div className="tags">
                {primaryTrend?.analysis && (
                  <button
                    disabled={locked}
                    onClick={() =>
                      patch(
                        'prompt',
                        appendSeriesRequirement(
                          draft.prompt,
                          `趋势重点：${primaryTrend.analysis.theme}。${primaryTrend.analysis.silhouettes}。${primaryTrend.analysis.functions}。${primaryTrend.analysis.techniques}。`,
                        ),
                      )
                    }
                  >
                    使用趋势生成描述
                  </button>
                )}
                {primaryTrend?.analysis?.keywords.map((k) => (
                  <button
                    key={k}
                    disabled={locked}
                    onClick={() => patch('prompt', appendSeriesRequirement(draft.prompt, k))}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </section>
            <section className="inspector-section compact">
              <label>
                <span>趋势方向</span>
                <button className="select-control" onClick={() => setPicker('trend')}>
                  {primaryTrend?.analysis?.theme || '选择主趋势'}
                  <ArrowRight size={12} />
                </button>
              </label>
              <label>
                <span>造型数量</span>
                <input
                  aria-label="造型数量"
                  type="number"
                  min="1"
                  max="12"
                  disabled={locked}
                  value={draft.lookCount}
                  onChange={(e) => patch('lookCount', Number(e.target.value))}
                />
              </label>
              {[
                ['logoHarmony', 'Logo 协调'],
                ['keepIdentity', '保持人物'],
              ].map(([key, label]) => (
                <label key={key}>
                  <span>{label}</span>
                  <input
                    aria-label={label}
                    type="checkbox"
                    disabled={locked}
                    checked={draft[key]}
                    onChange={(e) => patch(key, e.target.checked)}
                  />
                </label>
              ))}
              {patternItem && (
                <label className="scale-control">
                  <span>图案覆盖 {draft.patternCoverage}%</span>
                  <input
                    aria-label="图案覆盖比例"
                    type="range"
                    min="10"
                    max="100"
                    disabled={locked}
                    value={draft.patternCoverage}
                    onChange={(e) => patch('patternCoverage', Number(e.target.value))}
                  />
                </label>
              )}
            </section>
            <section className="palette-section">
              <div className="section-title">
                <span>趋势色板</span>
              </div>
              <div className="swatches">
                {primaryTrend?.analysis?.colors.map((c, i) => (
                  <i key={i} title={`${c.name} ${c.hex}`} style={{ background: c.hex }} />
                ))}
              </div>
              <button
                className="outline-action save-settings"
                disabled={locked || !dirty}
                onClick={() => safe(() => doWork(save))}
              >
                保存设置
              </button>
              {p.looks.length > 0 && (
                <button
                  className="outline-action save-settings"
                  disabled={busy}
                  onClick={() => exportZip('all')}
                >
                  导出完整交付包
                </button>
              )}
            </section>
            <div className="generate-area">
              {needs.length > 0 && (
                <div className="preflight">
                  <strong>开始前还需要</strong>
                  {needs.map((need) => (
                    <button
                      key={need.label}
                      onClick={() =>
                        need.picker
                          ? setPicker(need.picker)
                          : need.step
                            ? setStep(need.step)
                            : document
                                .querySelector(
                                  `[aria-label="${need.label.includes('数量') ? '造型数量' : '系列描述'}"]`,
                                )
                                ?.focus()
                      }
                    >
                      {need.label}
                      <ArrowRight size={12} />
                    </button>
                  ))}
                </div>
              )}
              <p>
                {p.looks.length
                  ? `当前 ${p.looks.length} 套成片会保留，本次结果将继续追加。`
                  : '建议先生成 1–3 套试样，确认方向后再扩展系列。'}
              </p>
              <button
                className="generate-button"
                disabled={locked || Boolean(needs.length) || !data.executor?.ready}
                onClick={() => queue({ kind: 'series' })}
              >
                <Sparkles size={17} />
                {p.looks.length ? '新增生成' : '开始生成'} {draft.lookCount} 套
              </button>
              <span>点击后直接执行 · 使用当前任务模型 · 完成后请复核</span>
            </div>
          </aside>
        </section>
      )}
      {step === 'white' && (
        <section className="page-scroll asset-library-page">
          <div className="page-inner wide">
            <div className="page-heading library-heading">
              <div>
                <span className="eyebrow">STEP 04</span>
                <h1>成片管理</h1>
                <p>实时查看生成结果，并完成精修、白底、版本对比和交付导出。</p>
              </div>
              <div className="library-summary">
                <span>
                  <b>{workspaceLooks.length}</b> 已生成款式
                </span>
                <span>
                  <b>{p.looks.filter((l) => l.white).length}</b> 白底就绪
                </span>
                <span>
                  <b>{archivedLooks.length}</b> 已归档
                </span>
              </div>
            </div>
            <div className="library-toolbar">
              <div className="library-tabs">
                {[
                  ['all', '全部'],
                  ['pending', '待处理'],
                  ['white', '白底图'],
                  ['adjusted', '已调整'],
                  ['restyle', '改款新增'],
                  ['archived', `归档 ${archivedLooks.length}`],
                ].map(([id, label]) => (
                  <button
                    className={filter === id ? 'active' : ''}
                    key={id}
                    onClick={() => {
                      setFilter(id);
                      setSelection(new Set());
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="library-tools">
                <ImageSortControl value={imageOrder} onChange={setImageOrder} />
                <label>
                  <Search size={14} />
                  <input
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setSelection(new Set());
                    }}
                    aria-label="搜索素材"
                    placeholder="搜索 LOOK 或名称"
                  />
                </label>
                <button
                  className="outline-action"
                  disabled={filter === 'archived'}
                  onClick={() =>
                    setSelection((old) => {
                      const next = new Set(old);
                      selectableVisible.forEach((l) =>
                        allSelected ? next.delete(l.id) : next.add(l.id),
                      );
                      return next;
                    })
                  }
                >
                  {allSelected ? '取消选择' : '选择当前'}
                </button>
              </div>
            </div>
            {visible.length ? (
              <div className="library-grid">
                {visible.map((l) => (
                  <article
                    className={`library-card ${selection.has(l.id) ? 'chosen' : ''}`}
                    key={l.id}
                  >
                    <div className="library-image">
                      {filter !== 'archived' && (
                        <button
                          className="select-box"
                          aria-label={`选择 ${l.title}`}
                          disabled={l.live}
                          onClick={() => toggle(l.id)}
                        >
                          {selection.has(l.id) && <Check size={13} />}
                        </button>
                      )}
                      <button
                        className="preview-image-button"
                        aria-label={`查看 ${l.title} 大图`}
                        onClick={() => setPreview(l)}
                      >
                        <img
                          src={assetUrl(filter === 'white' && l.white ? l.white : l.scene)}
                          alt={l.title}
                        />
                      </button>
                      <span
                        className={`asset-badge ${filter === 'archived' || l.white ? 'ready' : l.live ? 'live' : ''}`}
                      >
                        {filter === 'archived'
                          ? '已归档'
                          : l.live
                            ? '实时生成'
                            : l.white
                              ? '白底就绪'
                              : '原场景'}
                      </span>
                      <span className={`origin-badge ${l.originKind || 'legacy'}`}>
                        {{
                          series: '历史成片',
                          viral: '历史成片',
                          restyle: '改款新增',
                          legacy: '历史成片',
                        }[l.originKind || 'legacy'] || '其它生成'}
                      </span>
                    </div>
                    <div className="library-card-meta">
                      <div>
                        <span className="look-index-summary">
                          LOOK {String(l.slot || visibleSource.indexOf(l) + 1).padStart(2, '0')}
                        </span>
                        <b>{l.title}</b>
                        {(dimensionsOf(l) || l.adjusted) && (
                          <span className="look-secondary-meta">
                            {dimensionsOf(l) ? `${dimensionsOf(l)} px` : ''}
                            {l.adjusted && <em>已调整</em>}
                          </span>
                        )}
                      </div>
                      <IconButton label={`查看 ${l.title}`} onClick={() => setPreview(l)}>
                        <Columns2 size={15} />
                      </IconButton>
                    </div>
                    <div
                      className={`card-actions ${filter === 'archived' ? 'archived-actions' : ''}`}
                    >
                      {filter === 'archived' ? (
                        <>
                          <button
                            className="primary-card-action"
                            disabled={locked}
                            onClick={() => manageLook(l, 'restore')}
                          >
                            <RefreshCw size={13} />
                            恢复
                          </button>
                          <ActionMenu label={`${l.title}的更多操作`}>
                            <button disabled={busy} onClick={() => downloadLook(l)}>
                              <ArrowDownToLine size={14} />
                              下载图片
                            </button>
                            <button
                              className="danger-action"
                              disabled={locked}
                              onClick={() => setDeleting({ looks: [l], archived: true })}
                            >
                              <Trash2 size={14} />
                              永久删除
                            </button>
                          </ActionMenu>
                        </>
                      ) : (
                        <>
                          <button
                            className="primary-card-action"
                            disabled={lookLocked(l)}
                            onClick={() => onRestyle(l.id)}
                          >
                            <SlidersHorizontal size={13} />
                            款式调整
                          </button>
                          <button
                            disabled={lookLocked(l)}
                            onClick={() => queue({ kind: 'white', lookIds: [l.id] })}
                          >
                            {l.white ? '更新白底' : '生成白底'}
                          </button>
                          <button disabled={busy} onClick={() => downloadLook(l)}>
                            <ArrowDownToLine size={13} />
                            下载
                          </button>
                          <ActionMenu label={`${l.title}的更多操作`}>
                            <button
                              aria-pressed={l.feedback === 'liked'}
                              onClick={() => safe(() => rememberLook(l, 'liked'))}
                            >
                              <ThumbsUp size={14} />
                              {l.feedback === 'liked' ? '已喜欢，点击取消' : '喜欢，记住这个方向'}
                            </button>
                            <button
                              aria-pressed={l.feedback === 'disliked'}
                              onClick={() => safe(() => rememberLook(l, 'disliked'))}
                            >
                              <ThumbsDown size={14} />
                              {l.feedback === 'disliked'
                                ? '已标记避免，点击取消'
                                : '不喜欢，后续避免'}
                            </button>
                            <button
                              disabled={lookLocked(l)}
                              onClick={() =>
                                queue({
                                  kind: 'refine',
                                  lookIds: [l.id],
                                  background: 'scene',
                                  instruction:
                                    '根据原造型设计重新生成，保持人物身份、品牌与服装设计方向。',
                                })
                              }
                            >
                              <RefreshCw size={14} />
                              重新生成
                            </button>
                            <button
                              disabled={locked || l.live}
                              onClick={() => manageLook(l, 'archive')}
                            >
                              <Archive size={14} />
                              归档
                            </button>
                            <button
                              className="danger-action"
                              disabled={locked || l.live}
                              onClick={() => setDeleting({ looks: [l], archived: false })}
                            >
                              <Trash2 size={14} />
                              删除成片
                            </button>
                          </ActionMenu>
                        </>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <Empty
                title={
                  filter === 'archived'
                    ? '归档中没有成片'
                    : workspaceLooks.length
                      ? '没有符合条件的成片'
                      : '还没有生成成片'
                }
              >
                <p>
                  {filter === 'archived'
                    ? '先在成片卡片上点击归档，之后可在这里恢复或删除。'
                    : workspaceLooks.length
                      ? '请调整筛选条件或搜索关键词。'
                      : '完成趋势与素材准备后，在系列生成中创建任务。'}
                </p>
              </Empty>
            )}
            {filter !== 'archived' && (
              <div className="delivery-bar library-delivery">
                <div>
                  <strong>
                    已选择 {selection.size} / {p.looks.length}
                  </strong>
                  <span>实际生成结果与原图均会保留</span>
                  <span>
                    {selection.size
                      ? `将交付所选 ${selection.size} 套；其中 ${pendingWhite.length} 套待白底处理`
                      : '未选择时，交付包包含整个系列'}
                  </span>
                </div>
                <div>
                  <button className="outline-action" onClick={() => setHistory(true)}>
                    历史版本
                  </button>
                  <button
                    className="outline-action danger-action"
                    disabled={!selection.size || locked || busy}
                    onClick={() => setDeleting({ looks: selectedLooks, archived: false })}
                  >
                    <Trash2 size={14} />
                    删除所选 {selection.size || ''}
                  </button>
                  <button
                    className="outline-action"
                    disabled={!selection.size || busy}
                    onClick={() =>
                      exportZip(filter === 'white' ? 'white' : 'scene', [...selection])
                    }
                  >
                    <ArrowDownToLine size={14} />
                    批量下载 {selection.size || ''}
                  </button>
                  <button
                    className="outline-action"
                    disabled={!p.looks.length || busy}
                    onClick={() => exportZip('all', [...selection])}
                  >
                    交付包
                  </button>
                  <button
                    className="outline-action"
                    disabled={!selection.size || pendingWhite.length > 0 || busy}
                    title={pendingWhite.length ? '请先完成所选素材的白底处理' : '下载所选白底图'}
                    onClick={() => exportZip('white', [...selection])}
                  >
                    <ArrowDownToLine size={14} />
                    导出白底
                  </button>
                  <button
                    className="primary-action"
                    disabled={!pendingWhite.length || pendingWhite.some(lookLocked)}
                    onClick={() => queue({ kind: 'white', lookIds: pendingWhite.map((l) => l.id) })}
                  >
                    补齐白底 {pendingWhite.length || ''}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}
      {picker && (
        <ReferencePicker
          kind={picker}
          data={data}
          draft={draft}
          onPatch={patch}
          onClose={() => setPicker(null)}
          onManage={() => {
            setPicker(null);
            setStep(picker === 'trend' ? 'trend' : 'assets');
          }}
        />
      )}
      {editAnalysis && (
        <AnalysisEditor
          analysis={p.analysis}
          onClose={() => setEditAnalysis(false)}
          onSave={(analysis) =>
            safe(() =>
              doWork(async () => {
                await request(`/projects/${p.id}/analysis`, {
                  method: 'PATCH',
                  body: { analysis, expectedRevision: p.revision || 0 },
                });
                setEditAnalysis(false);
              }),
            )
          }
        />
      )}
      {preview && (
        <GeneratedImagePreview
          look={preview}
          showWhite={filter === 'white'}
          onClose={() => setPreview(null)}
          onPrevious={() => movePreview(-1)}
          onNext={() => movePreview(1)}
          onSetPrimary={(item) =>
            safe(() =>
              doWork(async () => {
                const updated = await request(`/projects/${p.id}/looks/${preview.id}/primary`, {
                  method: 'POST',
                  body: { assetId: item.assetId },
                });
                setPreview(updated);
                return updated;
              }),
            )
          }
          onDownload={(item) => downloadLook(preview, item.assetId, item.label || item.title)}
          onDownloadSelected={(items) =>
            safe(() =>
              doWork(async () => {
                for (const item of items) {
                  await downloadLookAsset(preview, item.assetId, item.label || item.title);
                }
              }),
            )
          }
        />
      )}
      {deleting && (
        <Modal title="删除成片" onClose={() => setDeleting(null)}>
          <div className="confirm-delete">
            <span className="danger-icon">
              <Trash2 size={20} />
            </span>
            <h2>
              {deleting.looks.length === 1
                ? `确定删除成片“${deleting.looks[0].title}”吗？`
                : `确定删除所选 ${deleting.looks.length} 张成片吗？`}
            </h2>
            <p>
              成片会从当前列表移除并保存到项目历史；原图文件、白底图、历史版本和任务记录仍会保留，避免误删后无法追溯。
            </p>
            <div className="modal-actions">
              <button onClick={() => setDeleting(null)}>取消</button>
              <button
                className="danger"
                disabled={busy}
                onClick={() =>
                  safe(() =>
                    doWork(async () => {
                      const lookIds = deleting.looks.map((look) => look.id);
                      if (!deleting.archived)
                        await request(`/projects/${p.id}/looks/archive`, {
                          method: 'POST',
                          body: { lookIds },
                        });
                      await request(`/projects/${p.id}/looks`, {
                        method: 'DELETE',
                        body: { lookIds },
                      });
                      setSelection((current) => {
                        const next = new Set(current);
                        lookIds.forEach((lookId) => next.delete(lookId));
                        return next;
                      });
                      if (lookIds.includes(selected)) setSelected(null);
                      if (lookIds.includes(preview?.id)) setPreview(null);
                      setDeleting(null);
                    }),
                  )
                }
              >
                删除成片
              </button>
            </div>
          </div>
        </Modal>
      )}
      {history && (
        <Modal title="历史版本" onClose={() => setHistory(false)}>
          <div className="history-panel">
            {p.history.map((entry, i) => (
              <section key={i}>
                <h3>
                  {new Date(entry.createdAt).toLocaleString()} · {entry.reason}
                </h3>
                <div
                  className="history-grid"
                  role="region"
                  tabIndex={0}
                  aria-label="系列历史缩略图"
                  onKeyDown={(event) => activateAdjacentThumbnail(event, event.currentTarget)}
                >
                  {entry.looks.map((l) => (
                    <button
                      key={l.id}
                      onClick={() => openHistoryPreview(assetUrl(l.white || l.scene), l.title)}
                    >
                      <img src={assetUrl(l.white || l.scene)} alt={l.title} />
                      <span>{l.title} · 查看大图</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
            {p.looks
              .filter((l) => l.versions.length)
              .map((l) => (
                <section key={l.id}>
                  <h3>{l.title}</h3>
                  <div
                    className="history-grid"
                    role="region"
                    tabIndex={0}
                    aria-label={`${l.title}历史缩略图`}
                    onKeyDown={(event) => activateAdjacentThumbnail(event, event.currentTarget)}
                  >
                    {l.versions.map((v, i) => (
                      <button
                        key={i}
                        onClick={() =>
                          openHistoryPreview(
                            assetUrl(v.white || v.scene),
                            `${l.title} · 历史版本 ${i + 1}`,
                          )
                        }
                      >
                        <img
                          src={assetUrl(v.white || v.scene)}
                          alt={`${l.title} 历史版本 ${i + 1}`}
                        />
                        <span>版本 {i + 1} · 查看大图</span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            {!p.history.length && !p.looks.some((l) => l.versions.length) && (
              <p>尚无历史版本。重新生成与精修会自动保留原图。</p>
            )}
          </div>
        </Modal>
      )}
      {historyPreview && (
        <ImageLightbox
          src={historyPreview.src}
          title={historyPreview.title}
          items={historyPreview.items}
          initialIndex={historyPreview.index}
          onClose={() => setHistoryPreview(null)}
        />
      )}
    </>
  );
}
