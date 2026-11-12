import React from 'react';
import { AlertCircle, Pause, Sparkles } from 'lucide-react';
import { assetUrl } from './api.js';
import { buildGenerationSlots } from './generationSlots.js';

const stateLabel = {
  generating: '正在生成',
  paused: '等待继续',
  failed: '生成未完成',
  ready: '生成完成',
};

export function GenerationSlotRail({
  task,
  label = '图片生成进度',
  className = '',
  compact = false,
  slotOffset = task?.slotOffset || 0,
  selectLabel = '查看生成结果',
  onSelect,
}) {
  const slots = buildGenerationSlots(task);
  if (!slots.length) return null;
  const ready = slots.filter((slot) => slot.state === 'ready').length;

  return (
    <div
      className={`generation-slot-rail ${compact ? 'compact' : ''} ${className}`.trim()}
      role="region"
      aria-label={label}
    >
      <span className="generation-slot-live" role="status" aria-live="polite">
        已完成 {ready} / {slots.length} 张，
        {stateLabel[slots.find((slot) => !slot.assetId)?.state] || '全部生成完成'}
      </span>
      {slots.map((slot) => {
        const number = slotOffset + slot.slot;
        const content = (
          <>
            <span className="generation-slot-visual">
              {slot.assetId ? (
                <img src={assetUrl(slot.assetId)} alt={`生成结果 ${number}`} />
              ) : (
                <span className={`generation-slot-motion ${slot.state}`} aria-hidden="true">
                  {slot.state === 'generating' && <span className="generation-slot-sweep" />}
                  {slot.state === 'paused' ? (
                    <Pause size={20} />
                  ) : slot.state === 'failed' ? (
                    <AlertCircle size={20} />
                  ) : (
                    <Sparkles size={22} />
                  )}
                </span>
              )}
            </span>
            <span className="generation-slot-caption">
              <b>LOOK {String(number).padStart(2, '0')}</b>
              {!compact && <small>{stateLabel[slot.state]}</small>}
            </span>
          </>
        );

        return slot.assetId && onSelect ? (
          <button
            type="button"
            className="generation-slot ready"
            data-slot-state={slot.state}
            aria-label={`${selectLabel} ${number}`}
            key={slot.slot}
            onClick={() => onSelect(slot, slots)}
          >
            {content}
          </button>
        ) : (
          <div
            className={`generation-slot ${slot.state}`}
            data-slot-state={slot.state}
            aria-label={`图片位置 ${number}，${stateLabel[slot.state]}`}
            key={slot.slot}
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}
