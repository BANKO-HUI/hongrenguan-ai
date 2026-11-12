import React, { useEffect, useRef, useState } from 'react';
import {
  Archive,
  ArrowRight,
  Check,
  Crop,
  FileText,
  Image as ImageIcon,
  Pause,
  Play,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { request, assetUrl } from './api.js';
import {
  ActionMenu,
  AnalysisEditor,
  Empty,
  ImageLightbox,
  Modal,
  ZoomableImage,
} from './components.jsx';

const labels = {
  model: '模特',
  logo: 'Logo',
  pattern: '图案',
  fabric: '面料',
  custom: '自定义素材',
};
const statusLabel = {
  pending: '等待解析',
  running: '正在解析',
  paused: '已暂停',
  uploaded: '待解析',
  ready: '解析完成',
  failed: '解析失败',
  cancelled: '已结束',
};
const trendPreview = (item) =>
  item.coverAssetId ? assetUrl(item.coverAssetId) : `${assetUrl(item.assetId)}?preview=1`;
const cropRatios = { '1:1': 1, '3:4': 3 / 4, '4:5': 4 / 5, '16:9': 16 / 9 };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function fittedCrop(width, height, aspect) {
  if (aspect === 'free') return { left: 0.1, top: 0.1, width: 0.8, height: 0.8 };
  const targetRatio = aspect === 'original' ? width / height : cropRatios[aspect];
  const normalizedRatio = (targetRatio * height) / width;
  let cropWidth = 1;
  let cropHeight = 1 / normalizedRatio;
  if (cropHeight > 1) {
    cropHeight = 1;
    cropWidth = normalizedRatio;
  }
  return {
    left: (1 - cropWidth) / 2,
    top: (1 - cropHeight) / 2,
    width: cropWidth,
    height: cropHeight,
  };
}

function CropEditor({ item, onClose, onSave, onReset }) {
  const [aspect, setAspect] = useState(item.kind === 'model' ? '3:4' : '1:1');
  const [size, setSize] = useState(null);
  const [rect, setRect] = useState(null);
  const stage = useRef(null);
  const drag = useRef(null);
  useEffect(() => {
    const image = new window.Image();
    image.onload = () => {
      const nextSize = { width: image.naturalWidth, height: image.naturalHeight };
      setSize(nextSize);
    };
    image.src = assetUrl(item.assetId);
    return () => {
      image.onload = null;
    };
  }, [item.assetId]);
  useEffect(() => {
    if (size) setRect(fittedCrop(size.width, size.height, aspect));
  }, [aspect, size]);

  const beginDrag = (event, mode) => {
    if (!rect || !stage.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      mode,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      bounds: stage.current.getBoundingClientRect(),
      rect,
    };
  };
  const moveDrag = (event) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const dx = (event.clientX - active.x) / active.bounds.width;
    const dy = (event.clientY - active.y) / active.bounds.height;
    if (active.mode === 'move') {
      setRect({
        ...active.rect,
        left: clamp(active.rect.left + dx, 0, 1 - active.rect.width),
        top: clamp(active.rect.top + dy, 0, 1 - active.rect.height),
      });
      return;
    }
    const east = active.mode.includes('e');
    const south = active.mode.includes('s');
    const anchorX = east ? active.rect.left : active.rect.left + active.rect.width;
    const anchorY = south ? active.rect.top : active.rect.top + active.rect.height;
    const pointerX = clamp(active.rect.left + (east ? active.rect.width : 0) + dx, 0, 1);
    const pointerY = clamp(active.rect.top + (south ? active.rect.height : 0) + dy, 0, 1);
    const maxWidth = east ? 1 - anchorX : anchorX;
    const maxHeight = south ? 1 - anchorY : anchorY;
    let nextWidth;
    let nextHeight;
    if (aspect === 'free') {
      nextWidth = clamp(Math.abs(pointerX - anchorX), Math.min(0.08, maxWidth), maxWidth);
      nextHeight = clamp(Math.abs(pointerY - anchorY), Math.min(0.08, maxHeight), maxHeight);
    } else {
      const targetRatio = aspect === 'original' ? size.width / size.height : cropRatios[aspect];
      const normalizedRatio = (targetRatio * size.height) / size.width;
      const requestedWidth = Math.max(
        Math.abs(pointerX - anchorX),
        Math.abs(pointerY - anchorY) * normalizedRatio,
      );
      const maximum = Math.min(maxWidth, maxHeight * normalizedRatio);
      nextWidth = clamp(requestedWidth, Math.min(0.08, maximum), maximum);
      nextHeight = nextWidth / normalizedRatio;
    }
    setRect({
      left: east ? anchorX : anchorX - nextWidth,
      top: south ? anchorY : anchorY - nextHeight,
      width: nextWidth,
      height: nextHeight,
    });
  };
  const endDrag = (event) => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  };
  const crop =
    size && rect
      ? {
          left: Math.round(size.width * rect.left),
          top: Math.round(size.height * rect.top),
          width: Math.max(1, Math.round(size.width * rect.width)),
          height: Math.max(1, Math.round(size.height * rect.height)),
        }
      : null;
  return (
    <Modal title={`裁剪 · ${item.title}`} onClose={onClose}>
      <div className="crop-editor">
        <div className="crop-canvas-wrap">
          <div
            ref={stage}
            className="crop-image-stage"
            style={
              size
                ? {
                    aspectRatio: `${size.width} / ${size.height}`,
                    width:
                      size.width > size.height
                        ? '100%'
                        : `min(100%, ${(58 * size.width) / size.height}vh)`,
                  }
                : undefined
            }
          >
            <img src={assetUrl(item.assetId)} alt={item.title} draggable="false" />
            {rect && (
              <div
                className="crop-frame"
                aria-label="可拖动裁剪框"
                style={{
                  left: `${rect.left * 100}%`,
                  top: `${rect.top * 100}%`,
                  width: `${rect.width * 100}%`,
                  height: `${rect.height * 100}%`,
                }}
                onPointerDown={(event) => beginDrag(event, 'move')}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                <i className="crop-grid vertical first" />
                <i className="crop-grid vertical second" />
                <i className="crop-grid horizontal first" />
                <i className="crop-grid horizontal second" />
                {['nw', 'ne', 'sw', 'se'].map((corner) => (
                  <button
                    type="button"
                    className={`crop-handle ${corner}`}
                    aria-label={`调整裁剪框 ${corner}`}
                    key={corner}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      beginDrag(event, corner);
                    }}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="crop-controls">
          <label>
            画幅
            <select
              aria-label="裁剪画幅"
              value={aspect}
              onChange={(event) => {
                const next = event.target.value;
                setAspect(next);
              }}
            >
              <option value="free">自由比例</option>
              <option value="original">原始比例</option>
              <option value="1:1">1:1 方形</option>
              <option value="3:4">3:4 竖版</option>
              <option value="4:5">4:5 商品图</option>
              <option value="16:9">16:9 横版</option>
            </select>
          </label>
          <div className="crop-instructions">
            <b>直接调整取景</b>
            <span>拖动裁图框移动位置，拖动四个角调整范围。</span>
          </div>
          <p>
            {crop
              ? `输出 ${crop.width} × ${crop.height} px · 起点 ${crop.left}, ${crop.top} · 原件和历史裁剪均会保留`
              : '正在读取图片尺寸…'}
          </p>
          <button
            className="crop-fit"
            type="button"
            disabled={!size}
            onClick={() => setRect(fittedCrop(size.width, size.height, aspect))}
          >
            重置裁图框
          </button>
          <div className="modal-actions">
            {item.sourceAssetId && (
              <button className="crop-reset" type="button" onClick={onReset}>
                恢复原图
              </button>
            )}
            <button type="button" onClick={onClose}>
              取消
            </button>
            <button
              className="primary"
              disabled={!crop}
              onClick={() => onSave({ aspect, zoom: 1, x: 0, y: 0, cropRect: rect })}
            >
              保存裁剪
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function MetaEditor({ item, onClose, onSave }) {
  const [title, setTitle] = useState(item.title);
  const [group, setGroup] = useState(item.group);
  const [tags, setTags] = useState(item.tags.join('，'));
  return (
    <Modal title="整理资料卡片" onClose={onClose}>
      <form
        className="library-meta-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({
            title,
            group,
            tags: tags
              .split(/[,，]/)
              .map((tag) => tag.trim())
              .filter(Boolean),
          });
        }}
      >
        <label>
          卡片标题
          <input
            aria-label="卡片标题"
            required
            maxLength={160}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          主分组
          <input
            aria-label="主分组"
            required
            maxLength={80}
            value={group}
            onChange={(e) => setGroup(e.target.value)}
          />
        </label>
        <label>
          标签
          <input
            aria-label="卡片标签"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="户外，轻量，2027 春夏"
          />
        </label>
        <p>多个标签请使用逗号分隔；新分组会自动加入筛选器。</p>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary">保存整理</button>
        </div>
      </form>
    </Modal>
  );
}

import { sortImages } from './imageSort.js';
import { ImageSortControl, useImageSort } from './ImageSortControl.jsx';

export function LibraryWorkspace({ type, data, project, act, safe }) {
  const [imageOrder, setImageOrder] = useImageSort('library');
  const isTrend = type === 'trend';
  const root = isTrend ? data.trendLibrary : data.materialLibrary;
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const [kind, setKind] = useState('all');
  const [archived, setArchived] = useState(false);
  const [detail, setDetail] = useState(null);
  const [editing, setEditing] = useState(null);
  const [analysisEdit, setAnalysisEdit] = useState(null);
  const [cropping, setCropping] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [uploadKind, setUploadKind] = useState(isTrend ? 'trend' : 'model');
  const [uploading, setUploading] = useState(false);
  const [controlling, setControlling] = useState(null);
  const input = useRef(null);
  const items = sortImages(root.items, imageOrder, data.assets).filter((item) => {
    const haystack =
      `${item.title} ${item.group} ${item.tags.join(' ')} ${item.analysis?.summary || ''}`.toLowerCase();
    return (
      Boolean(item.archivedAt) === archived &&
      (group === 'all' || item.group === group) &&
      (isTrend || kind === 'all' || item.kind === kind) &&
      haystack.includes(query.toLowerCase())
    );
  });
  useEffect(() => {
    if (!isTrend || !detail || editing || analysisEdit || cropping || deleting || items.length < 2)
      return undefined;
    const moveDetail = (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      setDetail((current) => {
        const index = items.findIndex((item) => item.id === current?.id);
        const delta = event.key === 'ArrowLeft' ? -1 : 1;
        return items[(Math.max(0, index) + delta + items.length) % items.length];
      });
    };
    document.addEventListener('keydown', moveDetail);
    return () => document.removeEventListener('keydown', moveDetail);
  }, [
    detail?.id,
    editing,
    analysisEdit,
    cropping,
    deleting,
    items.map((item) => item.id).join('|'),
  ]);
  const upload = async (files) => {
    if (!files.length) return;
    setUploading(true);
    try {
      for (const file of files) {
        const form = new FormData();
        form.append('file', file);
        await act(() =>
          request(isTrend ? '/library/trends' : `/library/materials/${uploadKind}`, {
            method: 'POST',
            form,
          }),
        );
      }
    } finally {
      setUploading(false);
    }
  };
  const patchProject = (changes) =>
    project &&
    safe(() =>
      act(() =>
        request(`/projects/${project.id}`, {
          method: 'PATCH',
          body: { ...changes, expectedRevision: project.revision || 0 },
        }),
      ),
    );
  const useTrend = (item, role) => {
    const without = (project.trendRefs || []).filter((ref) => ref.trendId !== item.id);
    let next;
    if (role === 'primary') {
      next = [
        { trendId: item.id, role: 'primary' },
        ...without.filter((ref) => ref.role === 'secondary'),
      ].slice(0, 3);
    } else {
      next = [...without, { trendId: item.id, role: 'secondary' }].slice(0, 3);
    }
    patchProject({ trendRefs: next });
  };
  const activeTask = (item) =>
    data.tasks.find(
      (task) => task.trendId === item.id && ['pending', 'running', 'paused'].includes(task.status),
    );
  const latestTask = (item) => data.tasks.find((task) => task.trendId === item.id);
  const controlAnalysis = (item) =>
    safe(async () => {
      setControlling(item.id);
      try {
        await act(async () => {
          const task = activeTask(item);
          if (task?.status === 'running')
            return request('/executor/control', {
              method: 'POST',
              body: { action: 'pause-task', taskId: task.id },
            });
          if (task)
            return request('/executor/control', {
              method: 'POST',
              body: { action: 'start-task', taskId: task.id },
            });
          const created = await request(`/library/trends/${item.id}/analyze`, {
            method: 'POST',
          });
          return request('/executor/control', {
            method: 'POST',
            body: { action: 'start-task', taskId: created.id },
          });
        });
      } finally {
        setControlling(null);
      }
    });
  const deletingReferences = deleting
    ? data.projects.filter((candidate) =>
        candidate.trendRefs?.some((reference) => reference.trendId === deleting.id),
      )
    : [];
  const deletingTask = deleting ? activeTask(deleting) : null;
  const deleteTrend = () =>
    safe(() =>
      act(async () => {
        await request(`/library/trends/${deleting.id}`, { method: 'DELETE' });
        if (detail?.id === deleting.id) setDetail(null);
        setDeleting(null);
      }, '趋势资料已删除'),
    );

  return (
    <section className="page-scroll shared-library-page">
      <input
        ref={input}
        hidden
        multiple
        type="file"
        accept={
          isTrend
            ? 'application/pdf,image/jpeg,image/png,image/webp'
            : 'image/jpeg,image/png,image/webp,image/svg+xml'
        }
        onChange={(event) => {
          const files = [...(event.target.files || [])];
          event.target.value = '';
          safe(() => upload(files));
        }}
      />
      <div className="page-inner wide">
        <div className="page-heading library-heading">
          <div>
            <span className="eyebrow">GLOBAL LIBRARY</span>
            <h1>{isTrend ? '趋势资料库' : '素材库'}</h1>
            <p>
              {isTrend
                ? '上传趋势文件，在卡片中控制解析并整理为可复用的设计方向。'
                : '集中管理模特、Logo、图案、面料与其它参考素材，所有项目都可直接复用。'}
            </p>
          </div>
          <div className="library-upload-actions">
            {!isTrend && (
              <select
                aria-label="上传素材类型"
                value={uploadKind}
                onChange={(e) => setUploadKind(e.target.value)}
              >
                <option value="model">模特</option>
                <option value="logo">Logo</option>
                <option value="pattern">图案</option>
                <option value="fabric">面料</option>
                <option value="custom">自定义素材</option>
              </select>
            )}
            <button
              className="primary-action"
              disabled={uploading}
              onClick={() => input.current.click()}
            >
              <Upload size={15} />
              {uploading ? '上传中…' : `批量上传${isTrend ? '趋势文件' : labels[uploadKind]}`}
            </button>
          </div>
        </div>
        <div className="shared-library-toolbar">
          <ImageSortControl value={imageOrder} onChange={setImageOrder} />
          <label className="library-search">
            <Search size={14} />
            <input
              aria-label={isTrend ? '搜索趋势资料' : '搜索参考素材'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索标题、摘要或标签"
            />
          </label>
          <select aria-label="筛选主分组" value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="all">全部分组</option>
            {root.groups.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          {!isTrend && (
            <select
              aria-label="筛选素材类型"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="all">全部类型</option>
              <option value="model">模特</option>
              <option value="logo">Logo</option>
              <option value="pattern">图案</option>
              <option value="fabric">面料</option>
              <option value="custom">自定义素材</option>
            </select>
          )}
          <button
            className={archived ? 'active' : ''}
            onClick={() => setArchived((value) => !value)}
          >
            <Archive size={13} />
            {archived
              ? '返回资料库'
              : `归档 ${root.items.filter((item) => item.archivedAt).length}`}
          </button>
        </div>
        {items.length ? (
          <div className={`masonry-library ${isTrend ? 'trend-masonry' : ''}`}>
            {items.map((item) => {
              const running = activeTask(item);
              const relatedTask = running || latestTask(item);
              const analysisStatus = running?.status || item.status;
              const selectedAs = isTrend
                ? project?.trendRefs?.find((ref) => ref.trendId === item.id)?.role
                : project?.modelRefId === item.id ||
                  project?.brandRefId === item.id ||
                  project?.patternRefId === item.id ||
                  project?.fabricRefId === item.id ||
                  project?.backgroundRefId === item.id ||
                  project?.customRefIds?.includes(item.id);
              return (
                <article className={`shared-card ${selectedAs ? 'selected' : ''}`} key={item.id}>
                  <button className="shared-card-cover" onClick={() => setDetail(item)}>
                    <img
                      src={isTrend ? trendPreview(item) : assetUrl(item.assetId)}
                      alt={item.title}
                    />
                    <span>{isTrend ? statusLabel[analysisStatus] : labels[item.kind]}</span>
                  </button>
                  <div className="shared-card-body">
                    <div className="shared-card-kicker">
                      <b>{item.group}</b>
                      <time>{new Date(item.updatedAt).toLocaleDateString()}</time>
                    </div>
                    <h2>{item.analysis?.theme || item.title}</h2>
                    {item.analysis?.summary && <p>{item.analysis.summary}</p>}
                    {isTrend && (
                      <div className={`trend-analysis-state ${analysisStatus}`} role="status">
                        <span />
                        <strong>{statusLabel[analysisStatus] || '等待解析'}</strong>
                        <small>{relatedTask?.message || '文件已就绪'}</small>
                      </div>
                    )}
                    {item.analysis?.colors?.length > 0 && (
                      <div className="card-swatches">
                        {item.analysis.colors.slice(0, 6).map((color) => (
                          <i key={color.hex} title={color.name} style={{ background: color.hex }} />
                        ))}
                      </div>
                    )}
                    <div className="card-tags">
                      {item.tags.slice(0, 8).map((tag) => (
                        <span key={tag}>#{tag}</span>
                      ))}
                    </div>
                  </div>
                  <div className="shared-card-actions">
                    {isTrend && !archived && analysisStatus !== 'ready' && (
                      <button
                        className="analysis-control primary-card-action"
                        disabled={controlling === item.id || !data.executor?.ready}
                        onClick={() => controlAnalysis(item)}
                      >
                        {running?.status === 'running' ? (
                          <Pause size={12} />
                        ) : ['ready', 'failed', 'cancelled'].includes(analysisStatus) ? (
                          <RotateCcw size={12} />
                        ) : (
                          <Play size={12} />
                        )}
                        {controlling === item.id
                          ? '处理中…'
                          : running?.status === 'running'
                            ? '暂停解析'
                            : running?.status === 'paused'
                              ? '继续解析'
                              : running?.status === 'pending'
                                ? '开始解析'
                                : analysisStatus === 'ready'
                                  ? '重新解析'
                                  : ['failed', 'cancelled'].includes(analysisStatus)
                                    ? '重试解析'
                                    : '解析'}
                      </button>
                    )}
                    {isTrend && item.status === 'ready' && project && (
                      <button
                        className={`primary-card-action ${selectedAs === 'primary' ? 'selected-action' : ''}`}
                        onClick={() => useTrend(item, 'primary')}
                      >
                        {selectedAs === 'primary' ? <Check size={13} /> : null}
                        {selectedAs === 'primary' ? '已选主趋势' : '设为主趋势'}
                      </button>
                    )}
                    {isTrend && item.status === 'ready' && project && (
                      <button
                        className={selectedAs === 'secondary' ? 'selected-action' : ''}
                        onClick={() => useTrend(item, 'secondary')}
                      >
                        {selectedAs === 'secondary' ? <Check size={13} /> : null}
                        {selectedAs === 'secondary' ? '已选辅助' : '设为辅助'}
                      </button>
                    )}
                    {!isTrend && project && (
                      <button
                        className={`primary-card-action ${selectedAs ? 'selected-action' : ''}`}
                        onClick={() =>
                          patchProject(
                            item.kind === 'custom' && project.backgroundRefId === item.id
                              ? { backgroundRefId: null }
                              : item.kind === 'custom'
                                ? {
                                    customRefIds: selectedAs
                                      ? project.customRefIds.filter((id) => id !== item.id)
                                      : [...(project.customRefIds || []), item.id],
                                  }
                                : item.kind === 'model'
                                  ? { modelRefId: selectedAs ? null : item.id }
                                  : item.kind === 'logo'
                                    ? { brandRefId: selectedAs ? null : item.id }
                                    : item.kind === 'pattern'
                                      ? { patternRefId: selectedAs ? null : item.id }
                                      : { fabricRefId: selectedAs ? null : item.id },
                          )
                        }
                      >
                        {selectedAs ? <Check size={13} /> : null}
                        {selectedAs ? '已用于项目' : '用于项目'}
                      </button>
                    )}
                    {!isTrend && !archived && (
                      <button onClick={() => setCropping(item)}>
                        <Crop size={13} /> 裁剪
                      </button>
                    )}
                    {archived && (
                      <button
                        className="primary-card-action"
                        onClick={() =>
                          safe(() =>
                            act(() =>
                              request(
                                `/library/${isTrend ? 'trends' : 'materials'}/${item.id}/restore`,
                                { method: 'POST' },
                              ),
                            ),
                          )
                        }
                      >
                        恢复
                      </button>
                    )}
                    {(!archived || isTrend) && (
                      <ActionMenu label={`${item.title}的更多操作`}>
                        {isTrend && !archived && analysisStatus === 'ready' && (
                          <button
                            disabled={controlling === item.id || !data.executor?.ready}
                            onClick={() => controlAnalysis(item)}
                          >
                            <RotateCcw size={14} /> 重新解析
                          </button>
                        )}
                        {!archived && <button onClick={() => setEditing(item)}>整理资料</button>}
                        {!archived && (
                          <button
                            onClick={() =>
                              safe(() =>
                                act(() =>
                                  request(
                                    `/library/${isTrend ? 'trends' : 'materials'}/${item.id}/archive`,
                                    { method: 'POST' },
                                  ),
                                ),
                              )
                            }
                          >
                            <Archive size={14} /> 归档
                          </button>
                        )}
                        {isTrend && archived && (
                          <button className="danger-action" onClick={() => setDeleting(item)}>
                            <Trash2 size={14} /> 永久删除
                          </button>
                        )}
                      </ActionMenu>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <Empty title={archived ? '归档中没有资料' : `还没有${isTrend ? '趋势文件' : '参考素材'}`}>
            <p>使用右上角批量上传，文件会安全保存在本机。</p>
          </Empty>
        )}
      </div>
      {editing && (
        <MetaEditor
          item={editing}
          onClose={() => setEditing(null)}
          onSave={(body) =>
            safe(() =>
              act(async () => {
                await request(`/library/${isTrend ? 'trends' : 'materials'}/${editing.id}`, {
                  method: 'PATCH',
                  body,
                });
                setEditing(null);
              }),
            )
          }
        />
      )}
      {detail && !isTrend && (
        <ImageLightbox
          src={assetUrl(detail.assetId)}
          title={detail.title}
          items={items.map((item) => ({
            src: assetUrl(item.assetId),
            title: item.title,
          }))}
          initialIndex={Math.max(
            0,
            items.findIndex((item) => item.id === detail.id),
          )}
          onClose={() => setDetail(null)}
        />
      )}
      {detail && isTrend && (
        <Modal title={detail.title} onClose={() => setDetail(null)}>
          <div className="library-detail">
            <ZoomableImage
              className="library-detail-image"
              src={trendPreview(detail)}
              alt={detail.title}
            />
            <div>
              {detail.analysis ? (
                <>
                  <h2>{detail.analysis.theme}</h2>
                  <p>{detail.analysis.summary}</p>
                  <h3>关键廓形</h3>
                  <p>{detail.analysis.silhouettes}</p>
                  <h3>功能细节</h3>
                  <p>{detail.analysis.functions}</p>
                  <h3>表面工艺</h3>
                  <p>{detail.analysis.techniques}</p>
                  <details>
                    <summary>查看依据与历史</summary>
                    {detail.analysis.evidence.map((e, i) => (
                      <p key={i}>
                        {e.page ? `第 ${e.page} 页：` : '图片依据：'}
                        {e.note}
                      </p>
                    ))}
                    <p>已有 {detail.analysisHistory.length} 个历史版本</p>
                  </details>
                  <button className="outline-action" onClick={() => setAnalysisEdit(detail)}>
                    修订提炼内容
                  </button>
                </>
              ) : (
                <p>
                  <Sparkles size={15} /> {statusLabel[detail.status] || '正在处理'}
                </p>
              )}
              <a
                className="outline-action"
                href={`${assetUrl(detail.assetId)}?download=1`}
                download
              >
                下载原文件 <ArrowRight size={12} />
              </a>
              {detail.archivedAt && (
                <button
                  className="outline-action danger-action"
                  onClick={() => setDeleting(detail)}
                >
                  <Trash2 size={12} /> 删除趋势
                </button>
              )}
              {items.length > 1 && <small>滚轮缩放 · ← → 切换资料</small>}
            </div>
          </div>
        </Modal>
      )}
      {analysisEdit && (
        <AnalysisEditor
          analysis={analysisEdit.analysis}
          onClose={() => setAnalysisEdit(null)}
          onSave={(analysis) =>
            safe(() =>
              act(async () => {
                await request(`/library/trends/${analysisEdit.id}/analysis`, {
                  method: 'PATCH',
                  body: { analysis, expectedRevision: analysisEdit.revision || 0 },
                });
                setAnalysisEdit(null);
                setDetail(null);
              }),
            )
          }
        />
      )}
      {deleting && (
        <Modal title="删除趋势资料" onClose={() => setDeleting(null)}>
          <div className="confirm-delete">
            <span className="danger-icon">
              <Trash2 size={20} />
            </span>
            <h2>确定移除“{deleting.analysis?.theme || deleting.title}”吗？</h2>
            <p>
              {deletingTask
                ? '该趋势仍有提炼任务在运行，请先在任务中心暂停后结束任务。'
                : deletingReferences.length
                  ? `该趋势正被 ${deletingReferences.length} 个项目使用，请先在系列工作台更换或移除引用。`
                  : '趋势卡片会从归档中移除；原文件、提炼历史和任务快照仍会安全保留。'}
            </p>
            <div className="modal-actions">
              <button onClick={() => setDeleting(null)}>取消</button>
              <button
                className="danger"
                disabled={Boolean(deletingTask) || deletingReferences.length > 0}
                onClick={deleteTrend}
              >
                删除趋势
              </button>
            </div>
          </div>
        </Modal>
      )}
      {cropping && (
        <CropEditor
          item={cropping}
          onClose={() => setCropping(null)}
          onSave={(crop) =>
            safe(() =>
              act(async () => {
                await request(`/library/materials/${cropping.id}/crop`, {
                  method: 'POST',
                  body: { ...crop, expectedRevision: cropping.revision || 0 },
                });
                setCropping(null);
                setDetail(null);
              }, '素材裁剪已保存'),
            )
          }
          onReset={() =>
            safe(() =>
              act(async () => {
                await request(`/library/materials/${cropping.id}/reset-crop`, {
                  method: 'POST',
                  body: { expectedRevision: cropping.revision || 0 },
                });
                setCropping(null);
                setDetail(null);
              }, '已恢复原图'),
            )
          }
        />
      )}
    </section>
  );
}
