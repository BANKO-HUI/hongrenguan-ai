import React, { useEffect, useId, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Gauge,
  Images,
  Moon,
  MoreHorizontal,
  Pause,
  Play,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { request, assetUrl, isActive, modelLabel, taskNames, statusNames } from './api.js';
import { computeScrollRailMetrics, scrollLeftFromRailPointer } from './scrollRail.js';
import { activateAdjacentThumbnail } from './thumbnailNavigation.js';
import { clampZoom, zoomOffsetAtPoint } from './zoomMath.js';
import { GenerationSlotRail } from './GenerationSlotRail.jsx';

export function IconButton({ label, onClick, children, ...props }) {
  return (
    <button
      className="icon-button"
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      {...props}
    >
      {children}
    </button>
  );
}

export function SmartConcurrencyStatus({ executor, className = '' }) {
  const smart = executor?.smartConcurrency || {
    enabled: true,
    unlimited: true,
    state: 'balancing',
    image: { current: executor?.concurrency || 3, min: 1, max: null },
    tasks: { current: executor?.taskConcurrency || 3, min: 1, max: null },
    message: '系统会根据服务状态自动调整生成速度。',
  };
  const stateLabel = {
    boost: '高速运行',
    balancing: '自动提速中',
    recovering: '稳态恢复中',
    fixed: '固定并发',
  }[smart.state];
  const imagePercent = smart.unlimited
    ? 100
    : Math.max(12, Math.round((smart.image.current / Math.max(1, smart.image.max)) * 100));
  return (
    <div
      className={`smart-concurrency-card ${smart.state} ${className}`.trim()}
      role="status"
      aria-label="智能并发状态"
    >
      <div className="smart-concurrency-icon">
        <Gauge size={18} />
      </div>
      <div className="smart-concurrency-copy">
        <span>
          <b>智能并发</b>
          <em>{smart.unlimited ? '不限上限' : stateLabel}</em>
        </span>
        <strong>
          同时生成 {smart.image.current} 张 · 并行任务 {smart.tasks.current} 项
        </strong>
        <small>{smart.message}</small>
        <i aria-hidden="true">
          <span style={{ width: `${imagePercent}%` }} />
        </i>
      </div>
    </div>
  );
}

export function ThemeToggle({ theme, onToggle, className = '' }) {
  const light = theme === 'light';
  const label = light ? '切换为深色模式' : '切换为浅色模式';
  return (
    <IconButton
      className={`icon-button theme-toggle ${className}`.trim()}
      label={label}
      onClick={onToggle}
      aria-pressed={light}
    >
      {light ? <Moon size={18} /> : <Sun size={18} />}
    </IconButton>
  );
}

export function ZoomableImage({ src, alt, label = alt, className = '', onLoad }) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const stageRef = useRef(null);
  const zoomRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef(null);

  useEffect(() => {
    zoomRef.current = 1;
    offsetRef.current = { x: 0, y: 0 };
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setDragging(false);
    dragRef.current = null;
  }, [src]);

  const changeZoom = (requested, clientPoint = null) => {
    const currentZoom = zoomRef.current;
    const next = clampZoom(requested);
    if (next === currentZoom) return;
    let nextOffset = offsetRef.current;
    if (next === 1) nextOffset = { x: 0, y: 0 };
    else if (clientPoint && stageRef.current) {
      const rect = stageRef.current.getBoundingClientRect();
      nextOffset = zoomOffsetAtPoint({
        currentZoom,
        nextZoom: next,
        offset: offsetRef.current,
        pointer: {
          x: clientPoint.x - rect.left - rect.width / 2,
          y: clientPoint.y - rect.top - rect.height / 2,
        },
      });
    }
    zoomRef.current = next;
    offsetRef.current = nextOffset;
    setOffset(nextOffset);
    setZoom(next);
  };

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const handleWheel = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.deltaY === 0) return;
      changeZoom(zoomRef.current + (event.deltaY < 0 ? 0.25 : -0.25), {
        x: event.clientX,
        y: event.clientY,
      });
    };
    stage.addEventListener('wheel', handleWheel, { passive: false });
    return () => stage.removeEventListener('wheel', handleWheel);
  }, [src]);

  const endPan = (event) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    setDragging(false);
  };

  return (
    <div
      ref={stageRef}
      className={`zoomable-image ${zoom > 1 ? 'zoomed' : ''} ${dragging ? 'dragging' : ''} ${className}`.trim()}
      data-zoom={zoom.toFixed(2)}
      role="group"
      aria-label={`${label}，可用鼠标滚轮缩放，放大后可拖动查看`}
      tabIndex={0}
      onDoubleClick={() => changeZoom(1)}
      onKeyDown={(event) => {
        if (['+', '='].includes(event.key)) changeZoom(zoomRef.current + 0.25);
        else if (event.key === '-') changeZoom(zoomRef.current - 0.25);
        else if (event.key === '0') changeZoom(1);
        else return;
        event.preventDefault();
      }}
      onPointerDown={(event) => {
        if (zoomRef.current <= 1 || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          offset: offsetRef.current,
        };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const nextOffset = {
          x: drag.offset.x + event.clientX - drag.x,
          y: drag.offset.y + event.clientY - drag.y,
        };
        offsetRef.current = nextOffset;
        setOffset(nextOffset);
      }}
      onPointerUp={endPan}
      onPointerCancel={endPan}
    >
      <img
        src={src}
        alt={alt}
        draggable="false"
        onLoad={onLoad}
        style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})` }}
      />
      <span className="zoomable-image-status">{Math.round(zoom * 100)}% · 滚轮缩放 · 拖动查看</span>
    </div>
  );
}

export function ImageScrollRail({ className = '', label, children }) {
  const viewportRef = useRef(null);
  const trackRef = useRef(null);
  const thumbRef = useRef(null);
  const dragRef = useRef(null);
  const reactId = useId();
  const viewportId = `image-scroll-rail-${reactId.replace(/:/g, '')}`;
  const [metrics, setMetrics] = useState({
    scrollable: false,
    maxScroll: 0,
    currentScroll: 0,
    thumbWidth: 0,
    thumbLeft: 0,
  });

  useEffect(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return undefined;
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = computeScrollRailMetrics({
          clientWidth: viewport.clientWidth,
          scrollWidth: viewport.scrollWidth,
          scrollLeft: viewport.scrollLeft,
          trackWidth: track.clientWidth,
        });
        setMetrics((current) =>
          Object.keys(next).every((key) => current[key] === next[key]) ? current : next,
        );
      });
    };
    const resizeObserver = new ResizeObserver(sync);
    resizeObserver.observe(viewport);
    resizeObserver.observe(track);
    const mutationObserver = new MutationObserver(sync);
    mutationObserver.observe(viewport, { childList: true, subtree: true });
    viewport.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    sync();
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      viewport.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, []);

  const moveToPointer = (clientX, grabOffset) => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;
    const rect = track.getBoundingClientRect();
    viewport.scrollLeft = scrollLeftFromRailPointer({
      clientX,
      trackLeft: rect.left,
      trackWidth: rect.width,
      thumbWidth: metrics.thumbWidth,
      grabOffset,
      maxScroll: Math.max(0, viewport.scrollWidth - viewport.clientWidth),
    });
  };

  const scrollByKeyboard = (event) => {
    const viewport = viewportRef.current;
    if (!viewport || !metrics.scrollable) return;
    const step = Math.max(80, viewport.clientWidth * 0.8);
    if (event.key === 'ArrowLeft') viewport.scrollBy({ left: -step, behavior: 'smooth' });
    else if (event.key === 'ArrowRight') viewport.scrollBy({ left: step, behavior: 'smooth' });
    else if (event.key === 'Home') viewport.scrollTo({ left: 0, behavior: 'smooth' });
    else if (event.key === 'End')
      viewport.scrollTo({ left: viewport.scrollWidth, behavior: 'smooth' });
    else return;
    event.preventDefault();
  };

  return (
    <div className="image-scroll-rail-shell" data-scrollable={metrics.scrollable}>
      <div
        id={viewportId}
        ref={viewportRef}
        className={`image-scroll-rail ${className}`.trim()}
        role="region"
        tabIndex={0}
        aria-label={label}
        onKeyDown={(event) => activateAdjacentThumbnail(event, event.currentTarget)}
      >
        {children}
      </div>
      <div
        ref={trackRef}
        className="image-scrollbar"
        data-scrollable={metrics.scrollable}
        role="scrollbar"
        tabIndex={metrics.scrollable ? 0 : -1}
        aria-label={`${label}滚动条`}
        aria-controls={viewportId}
        aria-orientation="horizontal"
        aria-disabled={!metrics.scrollable}
        aria-valuemin={0}
        aria-valuemax={Math.round(metrics.maxScroll)}
        aria-valuenow={Math.round(metrics.currentScroll)}
        onKeyDown={scrollByKeyboard}
        onPointerDown={(event) => {
          if (!metrics.scrollable) return;
          event.preventDefault();
          const thumbRect = thumbRef.current.getBoundingClientRect();
          const onThumb = event.target === thumbRef.current;
          const grabOffset = onThumb ? event.clientX - thumbRect.left : thumbRect.width / 2;
          dragRef.current = { pointerId: event.pointerId, grabOffset };
          event.currentTarget.setPointerCapture(event.pointerId);
          moveToPointer(event.clientX, grabOffset);
        }}
        onPointerMove={(event) => {
          if (dragRef.current?.pointerId !== event.pointerId) return;
          moveToPointer(event.clientX, dragRef.current.grabOffset);
        }}
        onPointerUp={(event) => {
          if (dragRef.current?.pointerId !== event.pointerId) return;
          dragRef.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
      >
        <span
          ref={thumbRef}
          className="image-scrollbar-thumb"
          style={{ width: metrics.thumbWidth, transform: `translateX(${metrics.thumbLeft}px)` }}
        />
      </div>
    </div>
  );
}

export function ActionMenu({ label = '更多操作', children }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);
  return (
    <div className={`action-menu ${open ? 'open' : ''}`} ref={ref}>
      <button
        type="button"
        className="action-menu-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal size={17} />
        <span className="visually-hidden">{label}</span>
      </button>
      {open && (
        <div
          className="action-menu-popover"
          role="menu"
          onClick={(event) => {
            if (event.target.closest('button:not(:disabled)')) setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
export function Modal({ title, onClose, children, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector('button,input,textarea')?.focus();
    const handler = (event) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const items = [
          ...ref.current.querySelectorAll('button:not(:disabled),input,select,textarea,a[href]'),
        ];
        if (!items.length) return;
        const first = items[0],
          last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
      previous?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        ref={ref}
        className={`modal ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <strong>{title}</strong>
          <IconButton label="关闭" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        {children}
      </section>
    </div>
  );
}

export function ImageLightbox({
  src,
  title,
  items = [],
  initialIndex = 0,
  actions = null,
  beforeSrc = '',
  beforeTitle = '未改前原图',
  comparisonItems = [],
  selectable = false,
  onSetPrimary = null,
  onDownload = null,
  onDownloadSelected = null,
  onPreviousGroup,
  onNextGroup,
  onClose,
}) {
  const dialogRef = useRef(null);
  const sequence = items.filter((item) => item?.src);
  if (!sequence.length && src) sequence.push({ src, title });
  const requestedIndex = sequence.length
    ? Math.max(0, Math.min(initialIndex, sequence.length - 1))
    : 0;
  const [index, setIndex] = useState(requestedIndex);
  const [viewMode, setViewMode] = useState('gallery');
  const [galleryVersion, setGalleryVersion] = useState('after');
  const [comparePosition, setComparePosition] = useState(50);
  const sequenceKey = sequence.map((item) => `${item.src}:${item.title || ''}`).join('|');
  const comparisonCandidates = [];
  const comparisonSeen = new Set();
  const addComparisonCandidate = (item) => {
    if (!item?.src || comparisonSeen.has(item.src)) return;
    comparisonSeen.add(item.src);
    comparisonCandidates.push(item);
  };
  if (comparisonItems.length) comparisonItems.forEach(addComparisonCandidate);
  else if (beforeSrc) {
    addComparisonCandidate({ src: beforeSrc, title: beforeTitle, label: beforeTitle });
    sequence.forEach(addComparisonCandidate);
  }
  const comparisonKey = comparisonCandidates.map((item) => item.src).join('|');
  const [comparisonPair, setComparisonPair] = useState(() => ({
    left: comparisonCandidates[0]?.src || '',
    right: comparisonCandidates.at(-1)?.src || '',
  }));
  const [selectedSources, setSelectedSources] = useState(() => new Set());
  const boundaryDirectionRef = useRef(0);
  const previousSequenceKeyRef = useRef(sequenceKey);
  const sequenceChanged = previousSequenceKeyRef.current !== sequenceKey;
  const currentIndex = sequenceChanged
    ? boundaryDirectionRef.current < 0
      ? Math.max(0, sequence.length - 1)
      : requestedIndex
    : Math.max(0, Math.min(index, sequence.length - 1));
  useEffect(() => {
    const nextIndex =
      boundaryDirectionRef.current < 0 ? Math.max(0, sequence.length - 1) : requestedIndex;
    previousSequenceKeyRef.current = sequenceKey;
    boundaryDirectionRef.current = 0;
    setIndex(nextIndex);
  }, [sequenceKey, requestedIndex, sequence.length]);
  useEffect(() => {
    setComparisonPair({
      left: comparisonCandidates[0]?.src || '',
      right: comparisonCandidates.at(-1)?.src || '',
    });
    setSelectedSources(new Set());
  }, [comparisonKey]);
  const navigate = (delta) => {
    const nextIndex = currentIndex + delta;
    if (nextIndex >= 0 && nextIndex < sequence.length) {
      setIndex(nextIndex);
      return;
    }
    if (delta < 0 && onPreviousGroup) {
      boundaryDirectionRef.current = delta;
      onPreviousGroup();
      return;
    }
    if (delta > 0 && onNextGroup) {
      boundaryDirectionRef.current = delta;
      onNextGroup();
      return;
    }
    setIndex((currentIndex + delta + sequence.length) % sequence.length);
  };
  useEffect(() => {
    document.documentElement.classList.add('image-gallery-open');
    document.body.classList.add('image-gallery-open');
    const previous = document.activeElement;
    window.requestAnimationFrame(() =>
      dialogRef.current?.querySelector('button,[tabindex="0"]')?.focus(),
    );
    return () => {
      document.documentElement.classList.remove('image-gallery-open');
      document.body.classList.remove('image-gallery-open');
      previous?.focus?.();
    };
  }, []);
  useEffect(() => {
    const handleKeyboard = (event) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Tab') {
        const focusable = [
          ...(dialogRef.current?.querySelectorAll(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]',
          ) || []),
        ];
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      } else if (event.key === 'Escape') onClose();
      else if (event.target?.closest?.('input,select,textarea')) return;
      else if (event.key === 'ArrowLeft' && (sequence.length > 1 || onPreviousGroup)) {
        event.preventDefault();
        navigate(-1);
      } else if (event.key === 'ArrowRight' && (sequence.length > 1 || onNextGroup)) {
        event.preventDefault();
        navigate(1);
      } else if (event.key === 'ArrowUp' && onPreviousGroup) {
        event.preventDefault();
        onPreviousGroup();
      } else if (event.key === 'ArrowDown' && onNextGroup) {
        event.preventDefault();
        onNextGroup();
      }
    };
    document.addEventListener('keydown', handleKeyboard);
    return () => document.removeEventListener('keydown', handleKeyboard);
  }, [currentIndex, onClose, onPreviousGroup, onNextGroup, sequenceKey]);
  const current = sequence[currentIndex] || sequence[0];
  if (!current?.src) return null;
  const comparisonActive =
    comparisonCandidates.length > 1 &&
    comparisonCandidates.some((item) => item.src !== comparisonCandidates[0].src);
  const leftComparison =
    comparisonCandidates.find((item) => item.src === comparisonPair.left) ||
    comparisonCandidates[0];
  const rightComparison =
    comparisonCandidates.find((item) => item.src === comparisonPair.right) ||
    comparisonCandidates.at(-1);
  const galleryBeforeSwitch = Boolean(
    comparisonActive && !comparisonItems.length && sequence.length === 1 && beforeSrc,
  );
  const visibleGallerySrc =
    galleryBeforeSwitch && galleryVersion === 'before' ? beforeSrc : current.src;
  const visibleGalleryTitle =
    galleryBeforeSwitch && galleryVersion === 'before' ? beforeTitle : current.title || title;
  const selectedItems = sequence.filter((item) => selectedSources.has(item.src));
  const primaryTarget = viewMode === 'gallery' ? current : rightComparison;
  const currentActions = typeof actions === 'function' ? actions(current, currentIndex) : actions;
  return (
    <div
      ref={dialogRef}
      className={`lightbox image-gallery ${sequence.length > 1 ? 'has-thumbnails' : ''}`.trim()}
      role="dialog"
      aria-modal="true"
      aria-label={`${current.title || title} 大图预览`}
      onClick={onClose}
    >
      <header className="image-gallery-bar" onClick={(event) => event.stopPropagation()}>
        <div className="image-gallery-title">
          <strong>{current.title || title}</strong>
          {sequence.length > 1 && (
            <span>
              {currentIndex + 1} / {sequence.length}
            </span>
          )}
        </div>
        {comparisonActive && (
          <div className="image-comparison-modes" role="group" aria-label="原图对比查看模式">
            {[
              ['gallery', '画廊'],
              ['slider', '轴线'],
              ['split', '并排'],
            ].map(([mode, label]) => (
              <button
                type="button"
                key={mode}
                className={viewMode === mode ? 'active' : ''}
                aria-pressed={viewMode === mode}
                onClick={() => setViewMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {comparisonActive && viewMode !== 'gallery' && (
          <div className="image-comparison-pair" aria-label="选择两张对比图片">
            <select
              aria-label="对比左图"
              value={leftComparison?.src || ''}
              onChange={(event) =>
                setComparisonPair((currentPair) => ({
                  ...currentPair,
                  left: event.target.value,
                }))
              }
            >
              {comparisonCandidates.map((item, itemIndex) => (
                <option key={`left-${item.src}`} value={item.src}>
                  {item.label || item.title || `图片 ${itemIndex + 1}`}
                </option>
              ))}
            </select>
            <span>对比</span>
            <select
              aria-label="对比右图"
              value={rightComparison?.src || ''}
              onChange={(event) =>
                setComparisonPair((currentPair) => ({
                  ...currentPair,
                  right: event.target.value,
                }))
              }
            >
              {comparisonCandidates.map((item, itemIndex) => (
                <option key={`right-${item.src}`} value={item.src}>
                  {item.label || item.title || `图片 ${itemIndex + 1}`}
                </option>
              ))}
            </select>
          </div>
        )}
        {(currentActions || onSetPrimary || onDownload || onDownloadSelected) && (
          <div className="image-gallery-actions">
            {currentActions}
            {onSetPrimary && primaryTarget?.assetId && primaryTarget.canSetPrimary !== false && (
              <button
                type="button"
                className="gallery-primary-action"
                disabled={primaryTarget.isPrimary}
                onClick={() => onSetPrimary(primaryTarget)}
              >
                {primaryTarget.isPrimary ? '当前主图' : '设为主图'}
              </button>
            )}
            {onDownload && viewMode === 'gallery' && (
              <button type="button" onClick={() => onDownload(current)}>
                下载当前
              </button>
            )}
            {onDownloadSelected && viewMode === 'gallery' && selectedItems.length > 0 && (
              <button type="button" onClick={() => onDownloadSelected(selectedItems)}>
                下载所选 {selectedItems.length}
              </button>
            )}
          </div>
        )}
        <IconButton className="icon-button image-gallery-close" label="关闭大图" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </header>
      {(sequence.length > 1 || onPreviousGroup || onNextGroup) && (
        <>
          {(sequence.length > 1 || onPreviousGroup) && (
            <IconButton
              className="icon-button lightbox-nav previous"
              label="上一张图片"
              onClick={(event) => {
                event.stopPropagation();
                navigate(-1);
              }}
            >
              <ChevronLeft size={24} />
            </IconButton>
          )}
          {(sequence.length > 1 || onNextGroup) && (
            <IconButton
              className="icon-button lightbox-nav next"
              label="下一张图片"
              onClick={(event) => {
                event.stopPropagation();
                navigate(1);
              }}
            >
              <ChevronRight size={24} />
            </IconButton>
          )}
        </>
      )}
      <div className="image-gallery-workspace" onClick={(event) => event.stopPropagation()}>
        {!comparisonActive || viewMode === 'gallery' ? (
          <figure className="comparison-gallery-stage">
            <ZoomableImage
              className="lightbox-stage"
              src={visibleGallerySrc}
              alt={visibleGalleryTitle}
              label={visibleGalleryTitle}
            />
            {galleryBeforeSwitch && (
              <div
                className="comparison-version-switch"
                role="group"
                aria-label="查看改前或改后图片"
              >
                <button
                  type="button"
                  className={galleryVersion === 'before' ? 'active' : ''}
                  aria-pressed={galleryVersion === 'before'}
                  onClick={() => setGalleryVersion('before')}
                >
                  改前
                </button>
                <button
                  type="button"
                  className={galleryVersion === 'after' ? 'active' : ''}
                  aria-pressed={galleryVersion === 'after'}
                  onClick={() => setGalleryVersion('after')}
                >
                  改后
                </button>
              </div>
            )}
          </figure>
        ) : viewMode === 'slider' ? (
          <figure className="image-comparison-slider" aria-label="轴线对比">
            <img
              src={leftComparison.src}
              alt={leftComparison.title || leftComparison.label || '左侧图片'}
              draggable="false"
            />
            <span
              className="image-comparison-after"
              style={{ clipPath: `inset(0 ${100 - comparePosition}% 0 0)` }}
            >
              <img
                src={rightComparison.src}
                alt={rightComparison.title || rightComparison.label || '右侧图片'}
                draggable="false"
              />
            </span>
            <span className="comparison-label before">
              {leftComparison.label || leftComparison.title || '左图'}
            </span>
            <span className="comparison-label after">
              {rightComparison.label || rightComparison.title || '右图'}
            </span>
            <span className="comparison-axis" style={{ left: `${comparePosition}%` }} />
            <input
              type="range"
              min="0"
              max="100"
              value={comparePosition}
              aria-label="拖动原图对比轴线"
              onChange={(event) => setComparePosition(Number(event.target.value))}
            />
          </figure>
        ) : (
          <div className="image-comparison-split" aria-label="并排对比">
            <figure>
              <ZoomableImage
                className="lightbox-stage"
                src={leftComparison.src}
                alt={leftComparison.title || leftComparison.label || '左侧图片'}
                label={leftComparison.label || leftComparison.title || '左图'}
              />
              <figcaption>{leftComparison.label || leftComparison.title || '左图'}</figcaption>
            </figure>
            <figure>
              <ZoomableImage
                className="lightbox-stage"
                src={rightComparison.src}
                alt={rightComparison.title || rightComparison.label || '右侧图片'}
                label={rightComparison.label || rightComparison.title || '右图'}
              />
              <figcaption>{rightComparison.label || rightComparison.title || '右图'}</figcaption>
            </figure>
          </div>
        )}
      </div>
      {sequence.length > 1 && (
        <div className="image-gallery-footer" onClick={(event) => event.stopPropagation()}>
          {selectable && viewMode === 'gallery' && (
            <div className="image-gallery-selection" aria-label="批量选择图片">
              <span>已选 {selectedItems.length}</span>
              <button
                type="button"
                onClick={() => setSelectedSources(new Set(sequence.map((item) => item.src)))}
              >
                全选
              </button>
              <button
                type="button"
                onClick={() =>
                  setSelectedSources(
                    new Set(
                      sequence
                        .filter((item) => !selectedSources.has(item.src))
                        .map((item) => item.src),
                    ),
                  )
                }
              >
                反选
              </button>
            </div>
          )}
          <div
            className="image-gallery-thumbnails"
            role="region"
            tabIndex={0}
            aria-label="画廊缩略图"
            onKeyDown={(event) => {
              if (!selectable) {
                activateAdjacentThumbnail(event, event.currentTarget);
                return;
              }
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              event.stopPropagation();
              if (event.key === 'Home') setIndex(0);
              else if (event.key === 'End') setIndex(sequence.length - 1);
              else navigate(event.key === 'ArrowLeft' ? -1 : 1);
            }}
          >
            {sequence.map((item, itemIndex) =>
              selectable ? (
                <span className="image-gallery-thumb" key={`${item.src}-${itemIndex}`}>
                  <button
                    type="button"
                    className={`thumbnail-view ${itemIndex === currentIndex ? 'active' : ''}`}
                    aria-label={`查看${item.label || item.title || `图片 ${itemIndex + 1}`}`}
                    onClick={() => setIndex(itemIndex)}
                  >
                    <img src={item.thumbnailSrc || item.src} alt="" />
                  </button>
                  <button
                    type="button"
                    className={`thumbnail-select ${selectedSources.has(item.src) ? 'active' : ''}`}
                    aria-label={`${selectedSources.has(item.src) ? '取消选择' : '选择'}${item.label || item.title || `图片 ${itemIndex + 1}`}`}
                    aria-pressed={selectedSources.has(item.src)}
                    onClick={() =>
                      setSelectedSources((currentSources) => {
                        const nextSources = new Set(currentSources);
                        if (nextSources.has(item.src)) nextSources.delete(item.src);
                        else nextSources.add(item.src);
                        return nextSources;
                      })
                    }
                  >
                    {selectedSources.has(item.src) ? '✓' : ''}
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className={itemIndex === currentIndex ? 'active' : ''}
                  aria-label={`查看${item.label || item.title || `图片 ${itemIndex + 1}`}`}
                  key={`${item.src}-${itemIndex}`}
                  onClick={() => setIndex(itemIndex)}
                >
                  <img src={item.thumbnailSrc || item.src} alt="" />
                </button>
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}
export function Empty({ title, children }) {
  return (
    <div className="work-empty">
      <Images size={32} />
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export function AnalysisEditor({ analysis, onClose, onSave }) {
  const [draft, setDraft] = useState(() => structuredClone(analysis));
  const [keywords, setKeywords] = useState(analysis.keywords.join('、'));
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="调整设计方向" onClose={onClose}>
      <form
        className="analysis-editor"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            await onSave({
              ...draft,
              keywords: keywords
                .split(/[、,，\n]/)
                .map((s) => s.trim())
                .filter(Boolean),
            });
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>调整用于生成的设计简报，不改写报告原文和引用依据。原解析版本会保留。</p>
        {[
          ['theme', '核心主题'],
          ['summary', '方向概述'],
          ['silhouettes', '关键廓形'],
          ['functions', '功能细节'],
          ['techniques', '表面工艺'],
        ].map(([key, label]) => (
          <label key={key}>
            {label}
            <textarea
              aria-label={label}
              required
              maxLength={key === 'theme' ? 200 : 10000}
              value={draft[key]}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            />
          </label>
        ))}
        <label>
          关键词（用顿号分隔）
          <input required value={keywords} onChange={(e) => setKeywords(e.target.value)} />
        </label>
        <div className="analysis-colors">
          {draft.colors.map((color, i) => (
            <label key={i}>
              配色 {i + 1}
              <input
                aria-label={`配色 ${i + 1} 名称`}
                required
                value={color.name}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    colors: draft.colors.map((c, n) =>
                      n === i ? { ...c, name: e.target.value } : c,
                    ),
                  })
                }
              />
              <input
                aria-label={`配色 ${i + 1} 色值`}
                type="color"
                value={color.hex}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    colors: draft.colors.map((c, n) =>
                      n === i ? { ...c, hex: e.target.value } : c,
                    ),
                  })
                }
              />
            </label>
          ))}
        </div>
        <button className="primary-action" disabled={busy}>
          {busy ? '保存中…' : '保存设计方向'}
        </button>
      </form>
    </Modal>
  );
}

export function TaskCenter({
  tasks,
  projects,
  executor,
  projectId,
  onView,
  act,
  safe,
  showConfiguration = true,
}) {
  const [scope, setScope] = useState(() =>
    tasks.some((t) => t.projectId === projectId && isActive(t)) ? 'project' : 'all',
  );
  const [busy, setBusy] = useState(null);
  const [preview, setPreview] = useState(null);
  const [deletingTask, setDeletingTask] = useState(null);
  const perform = (key, fn) =>
    safe(async () => {
      setBusy(key);
      try {
        await act(fn);
      } finally {
        setBusy(null);
      }
    });
  const visible = tasks.filter((t) => scope === 'all' || t.projectId === projectId);
  const selectedModel = executor?.models?.find((model) => model.id === executor.model);
  const activeTaskIds =
    executor?.activeTaskIds || (executor?.activeTaskId ? [executor.activeTaskId] : []);
  const controlTask = (action, taskId) =>
    perform(`${action}:${taskId}`, () =>
      request('/executor/control', { method: 'POST', body: { action, taskId } }),
    );
  const conflictsWith = (task, other) => {
    if (!isActive(other) || task.id === other.id) return false;
    if (task.trendId) return task.trendId === other.trendId;
    if (task.projectId !== other.projectId) return false;
    if (task.kind === 'analysis') return other.kind === 'analysis';
    if (['series', 'viral'].includes(task.kind)) return other.kind === task.kind;
    if (['white', 'refine', 'restyle'].includes(task.kind)) {
      return (
        ['white', 'refine', 'restyle'].includes(other.kind) &&
        task.lookIds.some((lookId) => other.lookIds.includes(lookId))
      );
    }
    return false;
  };
  return (
    <div className="task-center">
      <div className="execution-handoff">
        <h3>
          {executor?.ready
            ? activeTaskIds.length
              ? `${activeTaskIds.length} 个任务并行执行中`
              : executor.paused
                ? '已连接，等待开始'
                : '任务队列执行中'
            : '检查执行连接'}
        </h3>
        <p>{executor?.message}</p>
        <p>
          暂停会保留已完成结果，继续时只处理剩余步骤。
          {!showConfiguration && '模型可在 API 管理中调整，并发速度由系统自动优化。'}
        </p>
        {showConfiguration && (
          <div className="task-execution-settings">
            <label>
              任务模型
              <select
                aria-label="任务模型"
                value={executor?.model || ''}
                disabled={Boolean(busy) || activeTaskIds.length > 0}
                onChange={(event) =>
                  perform('model', () =>
                    request('/executor/control', {
                      method: 'POST',
                      body: { action: 'model', model: event.target.value },
                    }),
                  )
                }
              >
                {!executor?.models?.length && <option value="">暂无可用模型</option>}
                {executor?.models?.map((model) => (
                  <option key={model.id} value={model.id}>
                    {modelLabel(model)}
                    {model.id === executor?.recommendedModel ? ' · 推荐快速' : ''}
                  </option>
                ))}
              </select>
            </label>
            <SmartConcurrencyStatus executor={executor} className="task-smart-concurrency" />
            <small>{selectedModel?.description || '模型信息将在连接检测完成后显示。'}</small>
          </div>
        )}
        <div className="task-execution-actions">
          <button
            className="primary-action"
            disabled={Boolean(busy) || !executor?.ready || !executor?.paused}
            onClick={() =>
              perform('resume', () =>
                request('/executor/control', { method: 'POST', body: { action: 'resume' } }),
              )
            }
          >
            <Play size={14} />
            {busy === 'resume' ? '正在开始…' : '开始任务'}
          </button>
          <button
            className="outline-action"
            disabled={
              Boolean(busy) || !executor?.ready || (executor?.paused && activeTaskIds.length === 0)
            }
            onClick={() =>
              perform('pause', () =>
                request('/executor/control', { method: 'POST', body: { action: 'pause' } }),
              )
            }
          >
            <Pause size={14} />
            {busy === 'pause' ? '正在暂停…' : '暂停任务'}
          </button>
          <ActionMenu label="任务中心更多操作">
            <button
              disabled={Boolean(busy)}
              onClick={() => perform('check', () => request('/executor/check', { method: 'POST' }))}
            >
              {busy === 'check' ? '检测中…' : '重新检测连接'}
            </button>
          </ActionMenu>
        </div>
      </div>
      <div className="task-scope">
        <button className={scope === 'project' ? 'active' : ''} onClick={() => setScope('project')}>
          当前项目
        </button>
        <button className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>
          全部任务 · {tasks.filter(isActive).length} 项进行中
        </button>
      </div>
      {visible.length ? (
        visible.map((t) => {
          const project = projects.find((p) => p.id === t.projectId);
          const remaining = Math.max(0, t.total - t.results.length);
          const previewItems = t.results
            .filter((result) => result.assetId)
            .map((result) => {
              const src = assetUrl(result.assetId);
              const label = `LOOK ${(t.slotOffset || 0) + result.slot}`;
              return {
                src,
                thumbnailSrc: src,
                label,
                title: `${taskNames[t.kind]} · ${label}`,
              };
            });
          const resultCurrent =
            t.kind === 'analysis'
              ? project?.analysis?.taskId === t.id
              : project?.looks.some(
                  (l) =>
                    l.taskId === t.id ||
                    (t.kind !== 'series' &&
                      t.results.some((r) => r.assetId === l.scene || r.assetId === l.white)),
                );
          return (
            <article className="task-card" key={t.id}>
              <header>
                <div>
                  <strong>
                    {taskNames[t.kind]} · {t.projectName}
                  </strong>
                  <small>{new Date(t.createdAt).toLocaleString()}</small>
                </div>
                <span className={`task-status ${t.status}`}>{statusNames[t.status]}</span>
              </header>
              <p role="status">
                {t.status === 'failed'
                  ? `上次执行中断。已保留 ${t.results.length} / ${t.total} 项结果，仍缺 ${remaining} 项。`
                  : t.message}
              </p>
              {t.status === 'failed' && (
                <details className="task-error-details">
                  <summary>查看技术错误</summary>
                  <code>{t.message}</code>
                </details>
              )}
              {t.retryNote && <p>{t.retryNote}</p>}
              {t.status === 'pending' && (
                <small>
                  {!executor?.ready
                    ? '等待连接恢复，可点击上方重新检测'
                    : executor.paused
                      ? '队列已暂停，可单独开始此任务或点击上方开始全部'
                      : '轮到后自动执行'}
                </small>
              )}
              {t.status === 'paused' && <small>点击“继续此任务”处理剩余步骤</small>}
              <progress
                value={t.status === 'completed' ? t.total : t.results.length}
                max={t.total}
              />
              <div className="task-meta">
                {t.results.length} / {t.total} 项结果 · 尝试 {t.attempts} 次
              </div>
              {t.kind !== 'analysis' && (
                <GenerationSlotRail
                  task={t}
                  label={`${taskNames[t.kind]}图片生成进度`}
                  selectLabel="放大查看任务结果"
                  onSelect={(slot) =>
                    setPreview({
                      src: assetUrl(slot.assetId),
                      title: `${taskNames[t.kind]} · LOOK ${(t.slotOffset || 0) + slot.slot}`,
                      items: previewItems,
                      index: previewItems.findIndex((item) => item.src === assetUrl(slot.assetId)),
                    })
                  }
                />
              )}
              <footer>
                {(project || (t.trendId && !t.sourceDeletedAt)) && (
                  <button className="secondary-card-action" onClick={() => onView(t)}>
                    {t.trendId
                      ? '查看趋势卡片'
                      : t.status === 'completed' && resultCurrent
                        ? '查看结果 / 继续工作'
                        : '返回项目'}
                  </button>
                )}
                {t.status === 'pending' && (
                  <button
                    className="primary-card-action"
                    disabled={Boolean(busy) || !executor?.ready}
                    onClick={() => controlTask('start-task', t.id)}
                  >
                    单独开始
                  </button>
                )}
                {t.status === 'running' && (
                  <>
                    <button
                      className="primary-card-action"
                      disabled={Boolean(busy)}
                      onClick={() => controlTask('pause-task', t.id)}
                    >
                      暂停此任务
                    </button>
                  </>
                )}
                {t.status === 'paused' && (
                  <button
                    className="primary-card-action"
                    disabled={Boolean(busy) || !executor?.ready}
                    onClick={() => controlTask('start-task', t.id)}
                  >
                    继续此任务
                  </button>
                )}
                {t.canRetry && ['failed', 'cancelled'].includes(t.status) && (
                  <button
                    className="primary-card-action"
                    disabled={Boolean(busy) || tasks.some((other) => conflictsWith(t, other))}
                    onClick={() =>
                      perform(t.id, () => request(`/tasks/${t.id}/retry`, { method: 'POST' }))
                    }
                  >
                    {['series', 'viral'].includes(t.kind)
                      ? `继续缺少的 ${remaining} 张`
                      : '保留结果并重试'}
                  </button>
                )}
                <ActionMenu label={`${taskNames[t.kind]}任务的更多操作`}>
                  {t.status === 'running' && (
                    <button
                      disabled={Boolean(busy)}
                      onClick={() => controlTask('restart-task', t.id)}
                    >
                      卡住时重启
                    </button>
                  )}
                  {isActive(t) ? (
                    <button
                      className="danger-action"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        perform(t.id, () => request(`/tasks/${t.id}/cancel`, { method: 'POST' }))
                      }
                    >
                      结束任务
                    </button>
                  ) : (
                    <button
                      className="danger-action"
                      disabled={Boolean(busy)}
                      onClick={() => setDeletingTask(t)}
                    >
                      <Trash2 size={14} /> 删除任务记录
                    </button>
                  )}
                </ActionMenu>
              </footer>
            </article>
          );
        })
      ) : (
        <Empty title="没有待处理任务">
          <p>在工作台中上传报告、开始生成或进行精修，进度和结果会自动显示在这里。</p>
        </Empty>
      )}
      {preview && (
        <ImageLightbox
          src={preview.src}
          title={preview.title}
          items={preview.items}
          initialIndex={preview.index}
          onClose={() => setPreview(null)}
        />
      )}
      {deletingTask && (
        <Modal title="删除任务记录" onClose={() => setDeletingTask(null)}>
          <div className="confirm-delete">
            <span className="danger-icon">
              <Trash2 size={20} />
            </span>
            <h2>确定删除这条{taskNames[deletingTask.kind]}任务记录吗？</h2>
            <p>该记录会从任务中心移除；项目、趋势资料和已生成图片都会保留。</p>
            <div className="modal-actions">
              <button disabled={Boolean(busy)} onClick={() => setDeletingTask(null)}>
                取消
              </button>
              <button
                className="danger"
                disabled={Boolean(busy)}
                onClick={() =>
                  perform(`delete:${deletingTask.id}`, async () => {
                    await request(`/tasks/${deletingTask.id}`, { method: 'DELETE' });
                    setDeletingTask(null);
                  })
                }
              >
                {busy === `delete:${deletingTask.id}` ? '删除中…' : '删除记录'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
