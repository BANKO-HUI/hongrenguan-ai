import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Eye, EyeOff, Image, Layers3, Trash2 } from 'lucide-react';
import { assetUrl } from './api.js';

const layerPayload = (layers) =>
  layers.map(({ id, name, visible, opacity }, index) => ({
    id,
    name: name.trim() || `局部改款 ${index + 1}`,
    visible,
    opacity,
  }));

export function LookLayerPanel({
  look,
  enabled,
  onToggleEnabled,
  onUpdate,
  onMerge,
  onDeleteHistory,
}) {
  const [layers, setLayers] = useState(() => structuredClone(look?.editLayers || []));
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  useEffect(
    () => setLayers(structuredClone(look?.editLayers || [])),
    [look?.scene, look?.editLayers],
  );

  const commit = async (next, action = 'preview') => {
    setBusy(action);
    setError('');
    try {
      const payload = layerPayload(next);
      const updated = await (action === 'merge' ? onMerge(payload) : onUpdate(payload));
      if (updated?.editLayers) setLayers(structuredClone(updated.editLayers));
    } catch (caught) {
      setError(caught.message || '图层更新失败，请重试。');
    } finally {
      setBusy('');
    }
  };
  const change = (id, patch, save = true) => {
    const next = layers.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer));
    setLayers(next);
    if (save) void commit(next);
  };
  const move = (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= layers.length) return;
    const next = [...layers];
    [next[index], next[target]] = [next[target], next[index]];
    setLayers(next);
    void commit(next);
  };
  const history = [...(look?.layerHistory || [])].reverse();
  const removeHistory = async (entry) => {
    setBusy(`history-${entry.id}`);
    setError('');
    try {
      await onDeleteHistory(entry.id);
    } catch (caught) {
      setError(caught.message || '图层历史删除失败，请重试。');
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="look-layer-panel restyle-layer-panel" aria-label="改款图层面板">
      <header>
        <div>
          <strong>
            <Layers3 size={14} /> 图层
          </strong>
          <small>
            {enabled
              ? '标注区会截取生成并保留为独立图层'
              : '关闭时标注仍参与整图改款，不创建局部图层'}
          </small>
        </div>
        <button
          type="button"
          className={`layer-mode-toggle ${enabled ? 'active' : ''}`}
          aria-label={`${enabled ? '关闭' : '开启'}局部图层`}
          aria-pressed={enabled}
          onClick={() => onToggleEnabled(!enabled)}
        >
          <span />
          {enabled ? '已开启' : '已关闭'}
        </button>
      </header>
      {(look || layers.length > 0) && (
        <div className="look-layer-list">
          {layers.map((layer, index) => (
            <article className={layer.visible ? 'visible' : ''} key={layer.id}>
              <button
                type="button"
                className="layer-visibility"
                aria-label={`${layer.visible ? '取消勾选' : '勾选'} ${layer.name}`}
                aria-pressed={layer.visible}
                disabled={Boolean(busy)}
                onClick={() => change(layer.id, { visible: !layer.visible })}
              >
                {layer.visible ? <Eye size={15} /> : <EyeOff size={15} />}
              </button>
              <span className="layer-thumbnail">
                <img src={assetUrl(layer.assetId)} alt="" />
              </span>
              <div className="layer-copy">
                <input
                  aria-label={`图层名称 ${index + 1}`}
                  value={layer.name}
                  onChange={(event) => change(layer.id, { name: event.target.value }, false)}
                  onBlur={() => void commit(layers)}
                />
                <label>
                  <span>不透明度</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round(layer.opacity * 100)}
                    aria-label={`${layer.name}不透明度`}
                    onChange={(event) =>
                      change(layer.id, { opacity: Number(event.target.value) / 100 }, false)
                    }
                    onPointerUp={() => void commit(layers)}
                    onKeyUp={() => void commit(layers)}
                  />
                  <b>{Math.round(layer.opacity * 100)}%</b>
                </label>
              </div>
              <div className="layer-order-actions">
                <button
                  type="button"
                  aria-label={`上移 ${layer.name}`}
                  disabled={Boolean(busy) || index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ChevronUp size={13} />
                </button>
                <button
                  type="button"
                  aria-label={`下移 ${layer.name}`}
                  disabled={Boolean(busy) || index === layers.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ChevronDown size={13} />
                </button>
                <button
                  type="button"
                  aria-label={`删除 ${layer.name}`}
                  disabled={Boolean(busy)}
                  onClick={() => void commit(layers.filter((item) => item.id !== layer.id))}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </article>
          ))}
          {look && (
            <article className="layer-base visible">
              <span className="layer-visibility">
                <Eye size={15} />
              </span>
              <span className="layer-thumbnail base">
                {look.layerBaseScene || look.scene ? (
                  <img src={assetUrl(look.layerBaseScene || look.scene)} alt="" />
                ) : (
                  <Image size={14} />
                )}
              </span>
              <div className="layer-copy">
                <b>背景 / 已确认主图</b>
                <small>始终保留，不会被局部生成覆盖</small>
              </div>
            </article>
          )}
        </div>
      )}
      {layers.length > 0 && (
        <footer>
          <button
            type="button"
            className="outline-action"
            disabled={Boolean(busy)}
            onClick={() => void commit(layers)}
          >
            {busy === 'preview' ? '正在更新…' : '更新预览'}
          </button>
          <button
            type="button"
            className="primary-action"
            disabled={Boolean(busy) || !layers.some((layer) => layer.visible && layer.opacity > 0)}
            onClick={() => void commit(layers, 'merge')}
          >
            {busy === 'merge' ? '正在合并…' : '合并已勾选图层'}
          </button>
        </footer>
      )}
      {error && <p role="alert">{error}</p>}
      {history.length > 0 && (
        <details className="layer-history">
          <summary>历史操作 {history.length}</summary>
          <ol>
            {history.map((entry) => (
              <li key={entry.id}>
                <span>{entry.action === 'merge' ? '已合并' : '已放弃'}</span>
                <b>{entry.layers?.length || 0} 个图层</b>
                <time>{new Date(entry.createdAt).toLocaleString()}</time>
                <button
                  type="button"
                  aria-label={`删除图层历史 ${new Date(entry.createdAt).toLocaleString()}`}
                  disabled={Boolean(busy)}
                  onClick={() => void removeHistory(entry)}
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
