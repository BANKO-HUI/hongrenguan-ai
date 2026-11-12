import React, { useState } from 'react';
import { imageSortOptions } from './imageSort.js';

export function useImageSort(scope) {
  const key = `badmark-image-sort:${scope}`;
  const [order, setOrder] = useState(() => {
    try {
      const saved = localStorage.getItem(key);
      return imageSortOptions.some(([id]) => id === saved) ? saved : 'newest';
    } catch {
      return 'newest';
    }
  });
  return [
    order,
    (value) => {
      setOrder(value);
      try {
        localStorage.setItem(key, value);
      } catch {
        /* Storage may be unavailable. */
      }
    },
  ];
}

export function ImageSortControl({ value, onChange }) {
  return (
    <select
      className="image-sort-control"
      aria-label="图片排序"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {imageSortOptions.map(([id, label]) => (
        <option key={id} value={id}>
          {label}
        </option>
      ))}
    </select>
  );
}
