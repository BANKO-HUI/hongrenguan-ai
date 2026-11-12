export function groupAnnotationsByColor(annotations = []) {
  const groups = new Map();
  for (const annotation of annotations) {
    const key = String(annotation.color || '').toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        color: annotation.color,
        colorName: annotation.colorName,
        label: annotation.label || '',
        modes: [],
        ids: [],
      });
    }
    const group = groups.get(key);
    group.ids.push(annotation.id);
    if (!group.modes.includes(annotation.mode)) group.modes.push(annotation.mode);
    if (!group.label && annotation.label) group.label = annotation.label;
  }
  return [...groups.values()];
}

export function updateAnnotationGroup(annotations, colorKey, label) {
  return annotations.map((annotation) =>
    String(annotation.color || '').toLowerCase() === colorKey
      ? { ...annotation, label }
      : annotation,
  );
}

export function removeAnnotationGroup(annotations, colorKey) {
  return annotations.filter(
    (annotation) => String(annotation.color || '').toLowerCase() !== colorKey,
  );
}
