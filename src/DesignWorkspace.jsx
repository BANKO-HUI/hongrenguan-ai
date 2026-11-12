import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AtSign,
  ArrowUp,
  Brush,
  Check,
  ChevronDown,
  Circle,
  Eye,
  EyeOff,
  ImagePlus,
  Layers3,
  Lock,
  MousePointer2,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Square,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { assetUrl, isActive, request, statusNames } from './api.js';
import { Empty, ImageLightbox, ImageScrollRail, ZoomableImage } from './components.jsx';
import { activateAdjacentThumbnail } from './thumbnailNavigation.js';
import { clampZoom, zoomOffsetAtPoint } from './zoomMath.js';
import { groupAnnotationsByColor, removeAnnotationGroup } from './annotationGroups.js';
import { insertMentionToken, uniqueMention } from './referenceMentions.js';
import { LookLayerPanel } from './LookLayerPanel.jsx';
import { GenerationSlotRail } from './GenerationSlotRail.jsx';
import { mergePreviewBySource } from './generationSlots.js';

const RESTYLE_BASE_INSTRUCTION =
  '在保持未标记区域和人物身份稳定的前提下，按标记与参考精细调整服装。';
const restyleDraftKey = (projectId) => `bomi-restyle-draft:${projectId}`;
const readRestyleDraft = (projectId) => {
  try {
    const draft = JSON.parse(localStorage.getItem(restyleDraftKey(projectId)) || '{}');
    return draft && typeof draft === 'object' ? draft : {};
  } catch {
    return {};
  }
};

const directions = {
  restyle: [
    '款式细节',
    '结构版型',
    '面料质感',
    '颜色',
    '衣服比例',
    '图案',
    '搭配',
    '配饰',
    '妆发',
    '动作',
    '场景',
    '道具',
  ],
  viral: ['款式结构', '面料', '配色', '搭配', '功能细节', '图案工艺', '场景氛围'],
};

const annotationColors = [
  { name: '红色', color: '#ef4444' },
  { name: '绿色', color: '#22a06b' },
  { name: '蓝色', color: '#2474e5' },
  { name: '黄色', color: '#e6a700' },
  { name: '橙色', color: '#f97316' },
  { name: '紫色', color: '#8b5cf6' },
  { name: '青色', color: '#0891b2' },
  { name: '黑色', color: '#202124' },
];
const annotationColorName = (color) =>
  annotationColors.find((item) => item.color.toLowerCase() === color.toLowerCase())?.name ||
  `自定义色 ${color.toUpperCase()}`;

function extractTrendPrompts(project, data) {
  return (project.trendRefs || []).flatMap((reference) => {
    const trend = data.trendLibrary.items.find((item) => item.id === reference.trendId);
    const analysis = trend?.analysis;
    if (!analysis) return [];
    const role = reference.role === 'primary' ? '主趋势' : '辅助趋势';
    const colors = (analysis.colors || []).map((color) => `${color.name}${color.hex}`).join('、');
    return [
      {
        id: `${trend.id}:theme`,
        title: `${role} · 核心主题`,
        source: analysis.theme,
        prompt: `围绕“${analysis.theme}”延展，吸收其核心气质：${analysis.summary}`,
      },
      {
        id: `${trend.id}:silhouette`,
        title: `${role} · 廓形结构`,
        source: trend.title,
        prompt: `裂变廓形方向：${analysis.silhouettes}`,
      },
      {
        id: `${trend.id}:material`,
        title: `${role} · 面料工艺`,
        source: trend.title,
        prompt: `裂变面料与工艺方向：${analysis.functions}；${analysis.techniques}`,
      },
      {
        id: `${trend.id}:palette`,
        title: `${role} · 色彩方向`,
        source: trend.title,
        prompt: `裂变色彩方向：${colors}`,
      },
      {
        id: `${trend.id}:keywords`,
        title: `${role} · 趋势关键词`,
        source: trend.title,
        prompt: `裂变关键词：${(analysis.keywords || []).join('、')}`,
      },
    ];
  });
}

function GenerationPulse({ task, busy }) {
  if (!task && !busy) return null;
  return (
    <div className="generation-pulse" role="status">
      <span className="generation-orbit">
        <Sparkles size={18} />
      </span>
      <div>
        <strong>{busy ? '正在准备参考内容' : task.message}</strong>
        <small>
          {task
            ? `已回传 ${task.results.length} / ${task.total} 张，可继续在当前页面工作`
            : '文件上传完成后会立即开始'}
        </small>
      </div>
    </div>
  );
}

function AnnotationStage({ src, annotations, setAnnotations }) {
  const [tool, setTool] = useState('circle');
  const [mode, setMode] = useState('adjust');
  const [color, setColor] = useState(annotationColors[0].color);
  const [brushSize, setBrushSize] = useState(10);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const drawing = useRef(null);
  const pan = useRef(null);
  const spacePan = useRef(false);
  const stage = useRef(null);
  const surface = useRef(null);
  const zoomRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    zoomRef.current = 1;
    offsetRef.current = { x: 0, y: 0 };
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setPanning(false);
    drawing.current = null;
    pan.current = null;
    spacePan.current = false;
  }, [src]);

  const changeZoom = (requested, clientPoint = null) => {
    const currentZoom = zoomRef.current;
    const nextZoom = clampZoom(requested);
    if (nextZoom === currentZoom) return;
    let nextOffset = offsetRef.current;
    if (nextZoom === 1) nextOffset = { x: 0, y: 0 };
    else if (clientPoint && stage.current) {
      const bounds = stage.current.getBoundingClientRect();
      nextOffset = zoomOffsetAtPoint({
        currentZoom,
        nextZoom,
        offset: offsetRef.current,
        pointer: {
          x: clientPoint.x - bounds.left - bounds.width / 2,
          y: clientPoint.y - bounds.top - bounds.height / 2,
        },
      });
    }
    zoomRef.current = nextZoom;
    offsetRef.current = nextOffset;
    setZoom(nextZoom);
    setOffset(nextOffset);
  };

  useLayoutEffect(() => {
    const viewport = stage.current;
    if (!viewport) return undefined;
    const handleWheel = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.deltaY === 0) return;
      changeZoom(zoomRef.current + (event.deltaY < 0 ? 0.25 : -0.25), {
        x: event.clientX,
        y: event.clientY,
      });
    };
    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, [src]);

  const point = (event) => {
    const bounds = surface.current.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
  };
  const begin = (event) => {
    if (!src) return;
    const panGesture =
      zoomRef.current > 1 && (event.button === 1 || event.altKey || spacePan.current);
    if (panGesture) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      pan.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        offset: offsetRef.current,
      };
      setPanning(true);
      return;
    }
    if (event.button !== 0) return;
    const bounds = surface.current?.getBoundingClientRect();
    if (
      !bounds ||
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    )
      return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const first = point(event);
    const annotation = {
      id: crypto.randomUUID(),
      type: tool,
      mode,
      color,
      colorName: annotationColorName(color),
      label: mode === 'lock' ? '保持不变' : '需要调整',
      strokeWidth: tool === 'brush' ? brushSize * 4 : 6,
      points: [first, first],
    };
    drawing.current = { pointerId: event.pointerId, id: annotation.id };
    setAnnotations((current) => {
      const sameColor = current.find(
        (item) => item.color.toLowerCase() === annotation.color.toLowerCase(),
      );
      return [...current, sameColor ? { ...annotation, label: sameColor.label } : annotation];
    });
  };
  const move = (event) => {
    if (pan.current?.pointerId === event.pointerId) {
      const nextOffset = {
        x: pan.current.offset.x + event.clientX - pan.current.x,
        y: pan.current.offset.y + event.clientY - pan.current.y,
      };
      offsetRef.current = nextOffset;
      setOffset(nextOffset);
      return;
    }
    if (drawing.current?.pointerId !== event.pointerId) return;
    const next = point(event);
    setAnnotations((current) =>
      current.map((annotation) => {
        if (annotation.id !== drawing.current.id) return annotation;
        return {
          ...annotation,
          points:
            annotation.type === 'circle' || annotation.type === 'rect'
              ? [annotation.points[0], next]
              : [...annotation.points, next].slice(0, 500),
        };
      }),
    );
  };
  const end = (event) => {
    if (
      drawing.current?.pointerId !== event.pointerId &&
      pan.current?.pointerId !== event.pointerId
    )
      return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (drawing.current?.pointerId === event.pointerId) drawing.current = null;
    if (pan.current?.pointerId === event.pointerId) {
      pan.current = null;
      setPanning(false);
    }
  };
  return (
    <section className="annotation-panel">
      <div className="annotation-toolbar">
        <div className="segmented">
          <button className={tool === 'circle' ? 'active' : ''} onClick={() => setTool('circle')}>
            <Circle size={14} /> 圆形
          </button>
          <button className={tool === 'rect' ? 'active' : ''} onClick={() => setTool('rect')}>
            <Square size={14} /> 方形
          </button>
          <button className={tool === 'brush' ? 'active' : ''} onClick={() => setTool('brush')}>
            <Brush size={14} /> 涂鸦
          </button>
        </div>
        <div className="segmented region-mode">
          <button
            className={mode === 'adjust' ? 'active adjust' : ''}
            onClick={() => {
              setMode('adjust');
              setColor(annotationColors[0].color);
            }}
          >
            <MousePointer2 size={14} /> 调整区
          </button>
          <button
            className={mode === 'lock' ? 'active lock' : ''}
            onClick={() => {
              setMode('lock');
              setColor(annotationColors[1].color);
            }}
          >
            <Lock size={14} /> 锁定区
          </button>
        </div>
        <button
          className="quiet-icon"
          aria-label={showAnnotations ? '隐藏标注色块' : '显示标注色块'}
          title={showAnnotations ? '隐藏标注色块' : '显示标注色块'}
          disabled={!annotations.length}
          aria-pressed={!showAnnotations}
          onClick={() => setShowAnnotations((current) => !current)}
        >
          {showAnnotations ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
        <button
          className="quiet-icon"
          aria-label="撤销上一个标注"
          disabled={!annotations.length}
          onClick={() => setAnnotations((current) => current.slice(0, -1))}
        >
          <RotateCcw size={14} />
        </button>
        <button
          className="quiet-icon"
          aria-label="清空标注"
          disabled={!annotations.length}
          onClick={() => setAnnotations([])}
        >
          <Trash2 size={14} />
        </button>
        <button
          className="annotation-zoom-reset"
          aria-label="重置大图缩放"
          disabled={zoom === 1}
          onClick={() => changeZoom(1)}
        >
          {Math.round(zoom * 100)}%
        </button>
      </div>
      <div className="annotation-color-bar">
        <span>画笔颜色</span>
        <div className="annotation-swatches" role="group" aria-label="画笔颜色">
          {annotationColors.map((item) => (
            <button
              type="button"
              key={item.color}
              className={color.toLowerCase() === item.color ? 'active' : ''}
              style={{ '--swatch': item.color }}
              aria-label={`选择${item.name}画笔`}
              title={item.name}
              onClick={() => setColor(item.color)}
            />
          ))}
          <label className="custom-annotation-color" title="自定义颜色">
            <input
              type="color"
              aria-label="自定义画笔颜色"
              value={color}
              onChange={(event) => setColor(event.target.value)}
            />
            <span style={{ '--swatch': color }} />
          </label>
        </div>
        <b>{annotationColorName(color)}</b>
        {tool === 'brush' && (
          <div className="annotation-brush-presets" role="group" aria-label="涂鸦笔粗细">
            {[
              ['细', 6],
              ['中', 10],
              ['粗', 18],
            ].map(([label, value]) => (
              <button
                type="button"
                key={value}
                className={brushSize === value ? 'active' : ''}
                aria-label={`涂鸦${label}笔`}
                aria-pressed={brushSize === value}
                title={`${label}笔`}
                onClick={() => setBrushSize(value)}
              >
                <i style={{ '--brush-dot': `${Math.max(4, value / 2)}px` }} />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className={`annotation-stage ${src ? '' : 'empty'}`}>
        {src ? (
          <div
            ref={stage}
            className={`annotation-image-wrap ${panning ? 'panning' : ''}`.trim()}
            data-zoom={zoom.toFixed(2)}
            role="group"
            tabIndex={0}
            aria-label="改款大图，可用鼠标滚轮缩放，放大后按住空格或 Option 拖动查看"
            onKeyDown={(event) => {
              if (event.code !== 'Space') return;
              event.preventDefault();
              spacePan.current = true;
            }}
            onKeyUp={(event) => {
              if (event.code === 'Space') spacePan.current = false;
            }}
            onBlur={() => {
              spacePan.current = false;
            }}
            onPointerDown={begin}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          >
            <div
              ref={surface}
              className="annotation-image-content"
              style={{
                transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})`,
              }}
            >
              <img src={src} alt="待改款原图" draggable="false" />
              {showAnnotations && (
                <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="区域标注层">
                  {annotations.map((annotation) => {
                    if (annotation.type === 'circle' || annotation.type === 'rect') {
                      const [start, finish] = annotation.points;
                      const x = Math.min(start.x, finish.x) * 1000;
                      const y = Math.min(start.y, finish.y) * 1000;
                      const width = Math.abs(finish.x - start.x) * 1000;
                      const height = Math.abs(finish.y - start.y) * 1000;
                      return annotation.type === 'circle' ? (
                        <ellipse
                          key={annotation.id}
                          cx={x + width / 2}
                          cy={y + height / 2}
                          rx={Math.max(2, width / 2)}
                          ry={Math.max(2, height / 2)}
                          fill={annotation.color}
                          fillOpacity={annotation.mode === 'lock' ? 0.2 : 0.3}
                        />
                      ) : (
                        <rect
                          key={annotation.id}
                          x={x}
                          y={y}
                          width={Math.max(2, width)}
                          height={Math.max(2, height)}
                          fill={annotation.color}
                          fillOpacity={annotation.mode === 'lock' ? 0.2 : 0.3}
                        />
                      );
                    }
                    return (
                      <polyline
                        key={annotation.id}
                        points={annotation.points
                          .map((item) => `${item.x * 1000},${item.y * 1000}`)
                          .join(' ')}
                        fill="none"
                        stroke={annotation.color}
                        strokeOpacity=".72"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={annotation.strokeWidth || 38}
                      />
                    );
                  })}
                </svg>
              )}
            </div>
          </div>
        ) : (
          <div>
            <ImagePlus size={28} />
            <p>先选择或上传一张需要调整的图片</p>
          </div>
        )}
      </div>
      <div className="annotation-legend">
        <small>滚轮以光标为中心缩放；可隐藏色块查看整体，放大后按住空格或 Option 拖动</small>
      </div>
    </section>
  );
}

function AnnotationRegionChips({ annotations, setAnnotations, onMention }) {
  const groups = groupAnnotationsByColor(annotations);
  if (!groups.length) return null;
  return (
    <div className="restyle-region-list" aria-label="已标注区域">
      {groups.map((group) => {
        const modeLabel = group.modes
          .map((item) => (item === 'lock' ? '锁定' : '调整'))
          .join(' + ');
        const colorName = group.colorName || annotationColorName(group.color);
        return (
          <span className="restyle-region-chip" key={group.key}>
            <button
              type="button"
              aria-label={`在调整说明中调用 @${colorName}区域`}
              onClick={() => onMention(`${colorName}区域`)}
            >
              <i style={{ background: group.color }} />
              <b>{colorName}</b>
              <small>
                {modeLabel} · {group.ids.length} 个区域
              </small>
              <AtSign size={12} />
            </button>
            <button
              type="button"
              aria-label={`删除${colorName}全部区域`}
              onClick={() => setAnnotations((current) => removeAnnotationGroup(current, group.key))}
            >
              <X size={12} />
            </button>
          </span>
        );
      })}
    </div>
  );
}

function ReferenceShelf({ references, setReferences, addMention }) {
  const input = useRef(null);
  const addFiles = (files) => {
    setReferences((current) => [
      ...current,
      ...files.map((file, index) => ({
        id: crypto.randomUUID(),
        file,
        url: URL.createObjectURL(file),
        label: `参考${current.length + index + 1}`,
      })),
    ]);
  };
  return (
    <section className="named-references">
      <input
        ref={input}
        hidden
        multiple
        type="file"
        accept="image/png,image/jpeg,image/webp,image/heic,image/heif,image/tiff"
        onChange={(event) => {
          addFiles([...(event.target.files || [])]);
          event.target.value = '';
        }}
      />
      <header>
        <div>
          <strong>命名参考图</strong>
          <span>可导入多张，用 @名称 指定用途</span>
        </div>
        <button onClick={() => input.current?.click()}>
          <ImagePlus size={14} /> 添加参考
        </button>
      </header>
      {references.length ? (
        <div className="named-reference-grid">
          {references.map((reference) => (
            <article key={reference.id}>
              <img src={reference.url} alt={reference.label} />
              <input
                aria-label="参考图名称"
                value={reference.label}
                maxLength={80}
                onChange={(event) =>
                  setReferences((current) =>
                    current.map((item) =>
                      item.id === reference.id ? { ...item, label: event.target.value } : item,
                    ),
                  )
                }
              />
              <div>
                <button onClick={() => addMention(reference.label)}>
                  <AtSign size={12} /> 引用
                </button>
                <button
                  aria-label={`移除 ${reference.label}`}
                  onClick={() => {
                    URL.revokeObjectURL(reference.url);
                    setReferences((current) => current.filter((item) => item.id !== reference.id));
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p>参考图不是必选项，可用于面料、款式、搭配、配饰或场景。</p>
      )}
    </section>
  );
}

function RestyleComposer({
  annotations,
  setAnnotations,
  references,
  setReferences,
  instruction,
  setInstruction,
  hasProjectTrends,
  onPreview,
  onStart,
  disabled,
  busy,
  hint,
}) {
  const input = useRef(null);
  const textarea = useRef(null);
  const knownRegionLabels = useRef(new Map());
  const [referenceError, setReferenceError] = useState('');
  const groups = groupAnnotationsByColor(annotations);
  const mentionMatch = instruction.match(/(?:^|\s)@([^\s@]*)$/);
  const mentionSuggestions = mentionMatch
    ? references.filter(({ label }) =>
        label.toLocaleLowerCase().includes(mentionMatch[1].toLocaleLowerCase()),
      )
    : [];
  const previewItems = references.map((reference) => ({
    src: reference.url,
    title: `@${reference.label}`,
  }));

  useEffect(() => {
    const currentRegions = new Map(
      groups.map((group) => [
        group.key,
        `${group.colorName || annotationColorName(group.color)}区域`,
      ]),
    );
    const addedRegions = [...currentRegions].filter(([key]) => !knownRegionLabels.current.has(key));
    const removedRegions = [...knownRegionLabels.current].filter(
      ([key]) => !currentRegions.has(key),
    );
    knownRegionLabels.current = currentRegions;
    if (!addedRegions.length && !removedRegions.length) return;
    setInstruction((current) => {
      let next = current;
      removedRegions.forEach(([, label]) => {
        next = next.replaceAll(`@${label}`, '').replace(/ {2,}/g, ' ').trimStart();
      });
      addedRegions.forEach(([, label]) => {
        next = insertMentionToken(next, label);
      });
      return next;
    });
    if (addedRegions.length) window.requestAnimationFrame(() => textarea.current?.focus());
  }, [annotations, setInstruction]);

  const addFiles = (selected) => {
    setReferences((current) => {
      const known = new Set(
        current.map(({ file }) => `${file.name}:${file.size}:${file.lastModified}:${file.type}`),
      );
      const additions = selected.filter((file) => {
        const key = `${file.name}:${file.size}:${file.lastModified}:${file.type}`;
        if (known.has(key)) return false;
        known.add(key);
        return true;
      });
      const accepted = additions;
      const usedMentions = current.map(({ label }) => label);
      setReferenceError('');
      return [
        ...current,
        ...accepted.map((file) => {
          const label = uniqueMention(file.name, usedMentions);
          usedMentions.push(label);
          return { id: crypto.randomUUID(), file, url: URL.createObjectURL(file), label };
        }),
      ];
    });
  };

  const insertReferenceMention = (label) => {
    setInstruction((current) => insertMentionToken(current, label));
    window.requestAnimationFrame(() => textarea.current?.focus());
  };

  const removeReference = (id) => {
    setReferences((current) => {
      const removed = current.find((reference) => reference.id === id);
      if (removed) URL.revokeObjectURL(removed.url);
      return current.filter((reference) => reference.id !== id);
    });
    setReferenceError('');
  };

  return (
    <section
      className={`restyle-composer chat-composer-surface ${references.length ? 'has-files' : ''}`}
      aria-label="改款统一调整对话框"
    >
      <input
        ref={input}
        hidden
        multiple
        type="file"
        accept="image/png,image/jpeg,image/webp,image/heic,image/heif,image/tiff"
        onChange={(event) => {
          addFiles(Array.from(event.target.files || []));
          event.target.value = '';
        }}
      />
      {groups.length > 0 && (
        <div className="restyle-composer-context restyle-region-context">
          <div className="chat-compose-context-head">
            <span className="chat-intent region">已标注区域 {groups.length}</span>
            <small>点击区域标签，在下方唯一输入框中调用</small>
          </div>
          <AnnotationRegionChips
            annotations={annotations}
            setAnnotations={setAnnotations}
            onMention={insertReferenceMention}
          />
        </div>
      )}
      {references.length > 0 && (
        <div className="chat-compose-context restyle-reference-context">
          <div className="chat-compose-context-head">
            <span className="chat-intent image">参考图片 {references.length}</span>
            <small>点击预览 · @ 调用到下方调整说明</small>
          </div>
          <div className="chat-compose-files">
            {references.map((reference, index) => (
              <article
                className="chat-compose-file"
                key={reference.id}
                title={`@${reference.label}`}
              >
                <button
                  type="button"
                  className="chat-compose-preview"
                  aria-label={`放大参考图 ${reference.file.name}`}
                  onClick={() =>
                    onPreview({
                      src: reference.url,
                      title: `@${reference.label}`,
                      items: previewItems,
                      index,
                    })
                  }
                >
                  <img src={reference.url} alt="" />
                </button>
                <button
                  type="button"
                  className="chat-compose-mention"
                  aria-label={`在调整说明中调用 @${reference.label}`}
                  title={`@${reference.label}`}
                  onClick={() => insertReferenceMention(reference.label)}
                >
                  <AtSign size={12} />
                </button>
                <button
                  type="button"
                  className="chat-compose-remove"
                  aria-label={`移除 ${reference.file.name}`}
                  onClick={() => removeReference(reference.id)}
                >
                  <X size={12} />
                </button>
              </article>
            ))}
            <button
              type="button"
              className="chat-compose-add"
              aria-label="继续批量添加参考图"
              onClick={() => input.current?.click()}
            >
              <ImagePlus size={16} />
              <span>批量添加</span>
            </button>
          </div>
        </div>
      )}
      {referenceError && (
        <p className="restyle-composer-error" role="alert">
          {referenceError}
        </p>
      )}
      <form
        className="chat-native-composer restyle-native-composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (!disabled) onStart();
        }}
      >
        <button
          type="button"
          className="chat-file-trigger"
          aria-label="添加参考资料"
          title="添加本地参考图"
          onClick={() => input.current?.click()}
        >
          <ImagePlus size={20} />
        </button>
        <div className="chat-input-column">
          {mentionSuggestions.length > 0 && (
            <div className="chat-mention-menu" role="listbox" aria-label="调用参考资料">
              {mentionSuggestions.map((reference) => (
                <button
                  type="button"
                  role="option"
                  aria-selected="false"
                  key={reference.id}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => insertReferenceMention(reference.label)}
                >
                  <img src={reference.url} alt="" />
                  <span>@{reference.label}</span>
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={textarea}
            aria-label="改款调整说明"
            rows={2}
            value={instruction}
            placeholder="输入需要修改的内容，可使用 @区域 或 @参考图"
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                if (!disabled) onStart();
              }
            }}
          />
        </div>
        <button
          type="submit"
          className="chat-native-send"
          aria-label="开始改款"
          title="开始改款"
          disabled={disabled}
        >
          {busy ? <span className="button-spinner" /> : <ArrowUp size={18} />}
        </button>
      </form>
      <div className="restyle-composer-copy">
        <div className="restyle-composer-caption">
          <strong>调整说明</strong>
          <span>圈选与涂鸦区域会自动加入上方输入框</span>
        </div>
        <details className="restyle-prompt-examples">
          <summary>提示词案例</summary>
          <div className="direction-chips">
            {directions.restyle.map((direction) => (
              <button
                type="button"
                key={direction}
                onClick={() =>
                  setInstruction((current) => `${current.trim()} 重点调整${direction}。`)
                }
              >
                {direction}
              </button>
            ))}
            {hasProjectTrends && (
              <button
                type="button"
                onClick={() =>
                  setInstruction((current) => insertMentionToken(current, '当前项目趋势'))
                }
              >
                @当前项目趋势
              </button>
            )}
          </div>
        </details>
      </div>
      <small className="restyle-composer-footnote">{hint}</small>
    </section>
  );
}

import { sortImages } from './imageSort.js';
import { ImageSortControl, useImageSort } from './ImageSortControl.jsx';

export function DesignWorkspace({ type, project, data, act, safe, onTask, initialSourceLookId }) {
  const [imageOrder, setImageOrder] = useImageSort('design');
  const sortedLooks = sortImages(project.looks, imageOrder, data.assets);
  const isRestyle = type === 'restyle';
  const [savedRestyleDraft] = useState(() => (isRestyle ? readRestyleDraft(project.id) : {}));
  const preferredLookId = project.looks.some((look) => look.id === initialSourceLookId)
    ? initialSourceLookId
    : project.looks.some((look) => look.id === savedRestyleDraft.sourceLookId)
      ? savedRestyleDraft.sourceLookId
      : sortedLooks[0]?.id || '';
  const restoreSavedSource = isRestyle && savedRestyleDraft.sourceLookId === preferredLookId;
  const [sourceMode, setSourceMode] = useState(project.looks.length ? 'look' : 'upload');
  const [sourceLookId, setSourceLookId] = useState(preferredLookId);
  const [sourceFile, setSourceFile] = useState(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [references, setReferences] = useState([]);
  const [annotations, setAnnotations] = useState(() =>
    restoreSavedSource && Array.isArray(savedRestyleDraft.annotations)
      ? savedRestyleDraft.annotations
      : [],
  );
  const [layerMode, setLayerMode] = useState(
    restoreSavedSource && typeof savedRestyleDraft.layerMode === 'boolean'
      ? savedRestyleDraft.layerMode
      : false,
  );
  const [instruction, setInstruction] = useState(
    isRestyle
      ? restoreSavedSource && typeof savedRestyleDraft.instruction === 'string'
        ? savedRestyleDraft.instruction
        : ''
      : '保留原款的热销气质与核心识别，结合当前趋势做成风格相近但结构、面料和搭配有明显区别的新款。',
  );
  const [count, setCount] = useState(4);
  const [background, setBackground] = useState('scene');
  const [colorIntensity, setColorIntensity] = useState(50);
  const [fitLevel, setFitLevel] = useState(50);
  const [selectedTrendPrompts, setSelectedTrendPrompts] = useState(new Set());
  const [launchedTaskId, setLaunchedTaskId] = useState('');
  const [busy, setBusy] = useState(false);
  const [referencePreview, setReferencePreview] = useState(null);
  const [resultCanvasIndex, setResultCanvasIndex] = useState(null);
  const sourceInput = useRef(null);
  const sourceUrlRef = useRef('');
  const referencesRef = useRef([]);
  useEffect(() => {
    referencesRef.current = references;
  }, [references]);
  useEffect(() => {
    sourceUrlRef.current = sourceUrl;
  }, [sourceUrl]);
  useEffect(() => {
    if (!isRestyle || sourceMode !== 'look' || !sourceLookId) return;
    localStorage.setItem(
      restyleDraftKey(project.id),
      JSON.stringify({ sourceLookId, annotations, layerMode, instruction }),
    );
  }, [isRestyle, project.id, sourceMode, sourceLookId, annotations, layerMode, instruction]);
  useEffect(
    () => () => {
      if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
      referencesRef.current.forEach((reference) => URL.revokeObjectURL(reference.url));
    },
    [],
  );
  const sourceLook = project.looks.find((look) => look.id === sourceLookId);
  const source = sourceMode === 'look' ? assetUrl(sourceLook?.scene) : sourceUrl;
  const trendPromptOptions = isRestyle ? [] : extractTrendPrompts(project, data);
  const typeTasks = data.tasks.filter(
    (task) => task.projectId === project.id && task.kind === type,
  );
  const relevantTasks = typeTasks.filter((task) => {
    if (sourceMode === 'look') return task.lookIds.includes(sourceLookId);
    return task.id === launchedTaskId;
  });
  const activeTask = isRestyle ? relevantTasks.find(isActive) : typeTasks.find(isActive);
  const latestTask = relevantTasks[0];
  const resultTask = activeTask || latestTask;
  const layerLook = isRestyle
    ? sourceMode === 'look'
      ? sourceLook
      : project.looks.find((look) => look.taskId === resultTask?.id)
    : null;
  const resultPreviewItems = (resultTask?.results || [])
    .filter((result) => result.assetId)
    .map((result) => ({
      assetId: result.assetId,
      src: assetUrl(result.assetId),
      title: isRestyle
        ? result.editLayer?.assetId
          ? '改款结果 · 局部图层合成'
          : '改款结果'
        : `裂变 ${result.slot}`,
      slot: result.slot,
      label: isRestyle ? '改款结果' : `裂变 ${result.slot}`,
    }));
  let restylePreviewItems = [];
  if (isRestyle) {
    const addPreview = (assetId, title, extra = {}) => {
      const src = assetId ? assetUrl(assetId) : extra.src;
      if (!src) return;
      restylePreviewItems = mergePreviewBySource(restylePreviewItems, {
        assetId,
        src,
        title,
        label: title,
        ...extra,
      });
    };
    if (sourceMode === 'look' && sourceLook) {
      addPreview(
        sourceLook.originalScene || sourceLook.versions?.[0]?.scene || sourceLook.scene,
        '未改原图',
        { kind: 'original' },
      );
      (sourceLook.versions || []).forEach((version, versionIndex) =>
        addPreview(version.scene, version.instruction || `历史版本 ${versionIndex + 1}`, {
          kind: 'history',
        }),
      );
      addPreview(sourceLook.scene, '当前主图', { kind: 'current' });
    } else if (source) {
      addPreview(null, '未改原图', { src: source, kind: 'original' });
    }
    resultPreviewItems.forEach((item) => addPreview(item.assetId, item.title, item));
  }
  const displayPreviewItems = isRestyle ? restylePreviewItems : resultPreviewItems;
  const showGenerationSlots = Boolean(resultTask);
  const secondaryPreviewItems =
    isRestyle || !showGenerationSlots
      ? displayPreviewItems.map((item, index) => ({ item, index }))
      : [];
  const resultCanvasItem =
    resultCanvasIndex !== null ? displayPreviewItems[resultCanvasIndex] || null : null;
  useEffect(() => {
    setResultCanvasIndex(null);
  }, [isRestyle, source, resultTask?.id]);
  const sourceConflict =
    isRestyle &&
    sourceMode === 'look' &&
    data.tasks.find(
      (task) =>
        task.projectId === project.id &&
        isActive(task) &&
        ['white', 'refine', 'restyle'].includes(task.kind) &&
        task.lookIds.includes(sourceLookId),
    );
  const addMention = (label) =>
    setInstruction((current) => `${current.trim()} @${label.trim() || '参考'} `);
  const updateLookLayers = (layers) =>
    layerLook &&
    act(() =>
      request(`/projects/${project.id}/looks/${layerLook.id}/layers`, {
        method: 'PATCH',
        body: { layers },
      }),
    );
  const mergeLookLayers = (layers) =>
    layerLook &&
    act(() =>
      request(`/projects/${project.id}/looks/${layerLook.id}/layers/merge`, {
        method: 'POST',
        body: { layers },
      }),
    );
  const deleteLookLayerHistory = (historyId) =>
    layerLook &&
    act(() =>
      request(`/projects/${project.id}/looks/${layerLook.id}/layers/history/${historyId}`, {
        method: 'DELETE',
      }),
    );
  const selectSourceFile = (file) => {
    if (!file) return;
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    setSourceFile(file);
    setSourceUrl(URL.createObjectURL(file));
    setSourceMode('upload');
    setLaunchedTaskId('');
    setAnnotations([]);
    setResultCanvasIndex(null);
  };
  const selectSourceFiles = (selected) => {
    if (!selected.length) return;
    const [sourceCandidate, ...referenceCandidates] = selected;
    selectSourceFile(sourceCandidate);
    if (!referenceCandidates.length) return;
    setReferences((current) => {
      const known = new Set(
        current.map(({ file }) => `${file.name}:${file.size}:${file.lastModified}:${file.type}`),
      );
      const additions = referenceCandidates.filter((file) => {
        const key = `${file.name}:${file.size}:${file.lastModified}:${file.type}`;
        if (known.has(key)) return false;
        known.add(key);
        return true;
      });
      const usedMentions = current.map(({ label }) => label);
      return [
        ...current,
        ...additions.map((file) => {
          const label = uniqueMention(file.name, usedMentions);
          usedMentions.push(label);
          return { id: crypto.randomUUID(), file, url: URL.createObjectURL(file), label };
        }),
      ];
    });
  };
  const start = () =>
    safe(async () => {
      setBusy(true);
      try {
        await act(async () => {
          const files = [
            ...(sourceMode === 'upload' && sourceFile ? [sourceFile] : []),
            ...references.map((reference) => reference.file),
          ];
          let assets = [];
          if (files.length) {
            const form = new FormData();
            files.forEach((file) => form.append('files', file));
            const uploaded = await request(`/projects/${project.id}/refine-references`, {
              method: 'POST',
              form,
            });
            assets = uploaded.assets;
          }
          const sourceAssetId = sourceMode === 'upload' ? assets.shift()?.id || null : null;
          const selectedDirections = trendPromptOptions
            .filter((option) => selectedTrendPrompts.has(option.id))
            .map((option) => option.prompt);
          const taskInstruction = isRestyle
            ? `${layerMode ? RESTYLE_BASE_INSTRUCTION : '按传统整图方式改款；标注区域仅作为调整指引，不截取局部，不创建透明补丁图层。'}\n新增调整要求：${instruction.trim()}\n调整参数：${background === 'white' ? '输出商品白底图' : '保留或按说明调整场景'}；如需应用 Logo，自动按服装廓形、版片空间与整体构图协调其大小和位置；色彩浓度 ${colorIntensity}%；服装合体度 ${fitLevel}%。`
            : `${instruction.trim()}${
                selectedDirections.length
                  ? `\n趋势报告提取方向：${selectedDirections.join('；')}`
                  : ''
              }\n统一约束：保持源图的服装品类、核心结构、基础元素、商业气质和风格家族一致，仅在所选方向上形成清晰但可控的差异。`;
          const task = await request(`/projects/${project.id}/tasks`, {
            method: 'POST',
            body: {
              kind: type,
              lookIds: sourceMode === 'look' && sourceLook ? [sourceLook.id] : [],
              sourceAssetId,
              referenceAssetIds: assets.map((asset) => asset.id),
              referenceLabels: references.map((reference) => {
                const label = reference.label.trim() || '参考';
                return isRestyle ? `@${label}` : label;
              }),
              annotations: isRestyle ? annotations : [],
              layerMode: isRestyle && layerMode,
              count: isRestyle ? 1 : count,
              instruction: taskInstruction,
              background: isRestyle ? background : 'scene',
            },
          });
          setLaunchedTaskId(task.id);
          await request('/executor/control', {
            method: 'POST',
            body: { action: 'start-task', taskId: task.id },
          });
        });
      } finally {
        setBusy(false);
      }
    });

  const startDisabled =
    busy ||
    Boolean(isRestyle ? sourceConflict || activeTask : activeTask) ||
    !source ||
    !instruction.trim() ||
    !data.executor?.ready;
  const startHint =
    sourceConflict && sourceConflict.kind !== 'restyle'
      ? '当前图片正在进行其他处理，完成或结束后即可改款。'
      : isRestyle && layerMode && annotations.some((annotation) => annotation.mode === 'adjust')
        ? background === 'white'
          ? '白底属于全图调整；结果会作为完整历史版本保存。'
          : '只截取调整区附近生成透明补丁，未选区域保持原图，完成后可在当前页的图层面板中对比与合并。'
        : isRestyle && !layerMode
          ? annotations.length
            ? '传统整图改款：标注会作为调整指引，不截取局部，结果保存为完整新版本。'
            : '传统整图改款：不截取局部，结果保存为完整新版本。'
          : '点击发送后直接执行，结果实时进入当前项目与成片管理。';

  return (
    <section className="page-scroll design-workspace">
      <input
        ref={sourceInput}
        hidden
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/heic,image/heif,image/tiff"
        onChange={(event) => {
          selectSourceFiles([...(event.target.files || [])]);
          event.target.value = '';
        }}
      />
      <div className="page-inner wide">
        <div className="page-heading design-heading">
          <div>
            <span className="eyebrow">
              {isRestyle ? 'PRECISION RESTYLE' : 'BESTSELLER VARIATION'}
            </span>
            <h1>{isRestyle ? '改款中心' : '爆款裂变'}</h1>
            <p>
              {isRestyle
                ? '用区域标注、命名参考与文字，精准调整一张服装图。'
                : '以爆款为核心，结合趋势、参考与方向生成 1–12 个差异化新款。'}
            </p>
          </div>
          {activeTask && (
            <button className="outline-action" onClick={onTask}>
              <Layers3 size={14} /> 查看任务
            </button>
          )}
        </div>
        <GenerationPulse task={activeTask} busy={busy} />
        <div className={`design-grid ${isRestyle ? '' : 'viral'}`}>
          <div className="design-source-column">
            <section className="source-selector">
              <header>
                <ImageSortControl value={imageOrder} onChange={setImageOrder} />
                <div>
                  <b>{isRestyle ? '原图' : '爆款原图'}</b>
                  <span>选择已生成图或上传图片</span>
                </div>
                <button onClick={() => sourceInput.current?.click()}>
                  <Upload size={14} /> {sourceFile ? '更换图片' : '上传图片'}
                </button>
              </header>
              {project.looks.length > 0 && (
                <>
                  <div className="segmented source-mode">
                    <button
                      className={sourceMode === 'look' ? 'active' : ''}
                      onClick={() => {
                        setSourceMode('look');
                        setLaunchedTaskId('');
                        setResultCanvasIndex(null);
                        if (isRestyle) setAnnotations([]);
                      }}
                    >
                      已生成图
                    </button>
                    <button
                      className={sourceMode === 'upload' ? 'active' : ''}
                      onClick={() => {
                        setSourceMode('upload');
                        setLaunchedTaskId('');
                        setResultCanvasIndex(null);
                        if (isRestyle) setAnnotations([]);
                      }}
                    >
                      上传图片
                    </button>
                  </div>
                  {sourceMode === 'look' && (
                    <ImageScrollRail
                      className="source-look-strip"
                      label={isRestyle ? '改款原图滚动栏' : '爆款原图滚动栏'}
                    >
                      {sortedLooks.map((look) => (
                        <button
                          className={look.id === sourceLookId ? 'active' : ''}
                          key={look.id}
                          aria-label={`选择 ${look.title}`}
                          onClick={() => {
                            setSourceLookId(look.id);
                            setLaunchedTaskId('');
                            setResultCanvasIndex(null);
                            if (isRestyle) setAnnotations([]);
                          }}
                        >
                          <img src={assetUrl(look.scene)} alt={look.title} />
                          {look.id === sourceLookId && <Check size={12} />}
                        </button>
                      ))}
                    </ImageScrollRail>
                  )}
                </>
              )}
            </section>
            {isRestyle && resultCanvasItem && resultCanvasItem.src !== source ? (
              <div
                className="viral-source-preview restyle-result-canvas"
                aria-label={`画布查看${resultCanvasItem?.title || '实时结果'}`}
              >
                <ZoomableImage
                  className="viral-source-zoom"
                  src={resultCanvasItem?.src}
                  alt={resultCanvasItem?.title || '改款实时结果'}
                  label={resultCanvasItem?.title || '改款实时结果'}
                />
              </div>
            ) : isRestyle ? (
              <AnnotationStage
                src={source}
                annotations={annotations}
                setAnnotations={setAnnotations}
              />
            ) : source ? (
              <div className="viral-source-preview">
                <ZoomableImage
                  className="viral-source-zoom"
                  src={resultCanvasItem?.src || source}
                  alt={resultCanvasItem?.title || '爆款原图'}
                  label={resultCanvasItem?.title || '爆款原图'}
                />
              </div>
            ) : (
              <Empty title="请上传爆款图">
                <p>原图只作为款式核心参考，不会被覆盖。</p>
              </Empty>
            )}
          </div>
          <aside className="design-controls">
            {isRestyle && (
              <LookLayerPanel
                look={layerLook}
                enabled={layerMode}
                onToggleEnabled={setLayerMode}
                onUpdate={updateLookLayers}
                onMerge={mergeLookLayers}
                onDeleteHistory={deleteLookLayerHistory}
              />
            )}
            {isRestyle ? (
              <RestyleComposer
                annotations={annotations}
                setAnnotations={setAnnotations}
                references={references}
                setReferences={setReferences}
                instruction={instruction}
                setInstruction={setInstruction}
                hasProjectTrends={project.trendRefs?.length > 0}
                onPreview={setReferencePreview}
                onStart={start}
                disabled={startDisabled}
                busy={busy}
                hint={startHint}
              />
            ) : (
              <ReferenceShelf
                references={references}
                setReferences={setReferences}
                addMention={addMention}
              />
            )}
            {!isRestyle && (
              <section className="trend-prompt-panel">
                <header>
                  <div>
                    <strong>趋势报告方向</strong>
                    <span>从已解析报告提取，可多选并冻结到本次裂变</span>
                  </div>
                  {selectedTrendPrompts.size > 0 && (
                    <button onClick={() => setSelectedTrendPrompts(new Set())}>清除</button>
                  )}
                </header>
                {trendPromptOptions.length ? (
                  <div className="trend-prompt-options">
                    {trendPromptOptions.map((option) => (
                      <button
                        className={selectedTrendPrompts.has(option.id) ? 'selected' : ''}
                        key={option.id}
                        onClick={() =>
                          setSelectedTrendPrompts((current) => {
                            const next = new Set(current);
                            next.has(option.id) ? next.delete(option.id) : next.add(option.id);
                            return next;
                          })
                        }
                      >
                        <span>
                          <b>{option.title}</b>
                          <small>{option.source}</small>
                        </span>
                        {selectedTrendPrompts.has(option.id) && <Check size={13} />}
                        <p>{option.prompt}</p>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="trend-prompt-empty">
                    当前项目没有已解析的趋势报告；仍可用文字和参考图指定裂变方向。
                  </p>
                )}
              </section>
            )}
            {!isRestyle && (
              <section className="direction-editor">
                <header>
                  <strong>裂变方向</strong>
                  <span>可输入 @参考名称</span>
                </header>
                <textarea
                  aria-label="爆款裂变方向"
                  value={instruction}
                  onChange={(event) => setInstruction(event.target.value)}
                />
                <div className="direction-chips">
                  {directions.viral.map((direction) => (
                    <button
                      key={direction}
                      onClick={() =>
                        setInstruction((current) => `${current.trim()} 重点调整${direction}。`)
                      }
                    >
                      {direction}
                    </button>
                  ))}
                  {project.trendRefs?.length > 0 && (
                    <button onClick={() => addMention('当前项目趋势')}>@当前项目趋势</button>
                  )}
                </div>
              </section>
            )}
            {!isRestyle && (
              <section className="variation-count">
                <label>
                  <span>生成数量</span>
                  <strong>{count}</strong>
                </label>
                <input
                  aria-label="裂变生成数量"
                  type="range"
                  min="1"
                  max="12"
                  value={count}
                  onChange={(event) => setCount(Number(event.target.value))}
                />
                <div>
                  <span>1</span>
                  <span>12</span>
                </div>
              </section>
            )}
            {isRestyle && (
              <details className="restyle-advanced">
                <summary>
                  <span>
                    <SlidersHorizontal size={14} />
                    <b>更多调整</b>
                    <small>背景、Logo、色彩与合体度</small>
                  </span>
                  <ChevronDown size={15} />
                </summary>
                <div className="restyle-advanced-controls">
                  <div className="advanced-background">
                    <span>输出背景</span>
                    <div className="segmented">
                      <button
                        className={background === 'scene' ? 'active' : ''}
                        onClick={() => setBackground('scene')}
                      >
                        场景图
                      </button>
                      <button
                        className={background === 'white' ? 'active' : ''}
                        onClick={() => setBackground('white')}
                      >
                        商品白底
                      </button>
                    </div>
                  </div>
                  {[
                    ['色彩浓度', colorIntensity, setColorIntensity],
                    ['服装合体度', fitLevel, setFitLevel],
                  ].map(([label, value, setter]) => (
                    <label className="advanced-range" key={label}>
                      <span>
                        {label}
                        <b>{value}%</b>
                      </span>
                      <input
                        aria-label={label}
                        type="range"
                        min="20"
                        max="80"
                        value={value}
                        onChange={(event) => setter(Number(event.target.value))}
                      />
                    </label>
                  ))}
                </div>
              </details>
            )}
            {!isRestyle && (
              <div className="design-start">
                <button className="generate-button" disabled={startDisabled} onClick={start}>
                  {busy ? <span className="button-spinner" /> : <Play size={16} />}
                  {busy ? '正在启动…' : `开始裂变 ${count} 款`}
                </button>
                <small>点击后直接执行，结果实时进入当前项目与成片管理。</small>
              </div>
            )}
          </aside>
        </div>
        {(showGenerationSlots || displayPreviewItems.length > (isRestyle ? 1 : 0)) && (
          <section className="design-results">
            <header>
              <strong>实时结果</strong>
              <span>{resultTask ? statusNames[resultTask.status] : '版本记录'}</span>
            </header>
            {showGenerationSlots ? (
              <GenerationSlotRail
                task={resultTask}
                label="实时图片生成进度"
                slotOffset={0}
                selectLabel={isRestyle ? '在画布查看改款结果' : '在画布查看裂变'}
                onSelect={(slot) => {
                  const index = displayPreviewItems.findIndex(
                    (item) => item.assetId === slot.assetId || item.slot === slot.slot,
                  );
                  if (index >= 0) setResultCanvasIndex(index);
                }}
              />
            ) : null}
            {secondaryPreviewItems.length > 0 && (
              <div
                role="region"
                tabIndex={0}
                aria-label="实时结果缩略图"
                onKeyDown={(event) => activateAdjacentThumbnail(event, event.currentTarget)}
              >
                {secondaryPreviewItems.map(({ item: result, index }) => (
                  <button
                    className={`inline-preview ${resultCanvasIndex === index ? 'active' : ''}`.trim()}
                    key={`${result.src}-${index}`}
                    aria-label={`在画布查看${result.title}`}
                    aria-pressed={resultCanvasIndex === index}
                    onClick={() => setResultCanvasIndex(index)}
                  >
                    <img src={result.src} alt={`结果 ${result.slot}`} />
                    <span>{isRestyle ? result.label : `裂变 ${result.slot}`}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
      {isRestyle && referencePreview && (
        <ImageLightbox
          src={referencePreview.src}
          title={referencePreview.title}
          items={referencePreview.items}
          initialIndex={referencePreview.index}
          onClose={() => setReferencePreview(null)}
        />
      )}
    </section>
  );
}
