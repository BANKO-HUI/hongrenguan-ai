import path from 'node:path';
import sharp from 'sharp';
import { ensure } from './schema.js';

const inputOptions = { limitInputPixels: 40_000_000, animated: false };

const strokePixels = (annotation, width, height) =>
  Math.max(2, ((annotation.strokeWidth || 38) / 1000) * Math.max(width, height));

const shapeMarkup = (annotation, width, height, left, top, { mask = false } = {}) => {
  const color = mask ? (annotation.mode === 'lock' ? '#000000' : '#ffffff') : annotation.color;
  const opacity = mask ? 1 : annotation.mode === 'lock' ? 0.2 : 0.32;
  if (annotation.type === 'circle' || annotation.type === 'rect') {
    const [start, end] = annotation.points;
    const x = Math.min(start.x, end.x) * width - left;
    const y = Math.min(start.y, end.y) * height - top;
    const shapeWidth = Math.max(2, Math.abs(end.x - start.x) * width);
    const shapeHeight = Math.max(2, Math.abs(end.y - start.y) * height);
    if (annotation.type === 'rect')
      return `<rect x="${x}" y="${y}" width="${shapeWidth}" height="${shapeHeight}" fill="${color}" fill-opacity="${opacity}"/>`;
    return `<ellipse cx="${x + shapeWidth / 2}" cy="${y + shapeHeight / 2}" rx="${shapeWidth / 2}" ry="${shapeHeight / 2}" fill="${color}" fill-opacity="${opacity}"/>`;
  }
  const points = annotation.points
    .map((point) => `${point.x * width - left},${point.y * height - top}`)
    .join(' ');
  return `<polyline points="${points}" fill="none" stroke="${color}" stroke-opacity="${mask ? 1 : 0.82}" stroke-linecap="round" stroke-linejoin="round" stroke-width="${strokePixels(annotation, width, height)}"/>`;
};

const annotationSvg = (annotations, sourceWidth, sourceHeight, bounds, { mask = false } = {}) => {
  const ordered = mask
    ? [
        ...annotations.filter((annotation) => annotation.mode === 'adjust'),
        ...annotations.filter((annotation) => annotation.mode === 'lock'),
      ]
    : annotations;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="0 0 ${bounds.width} ${bounds.height}">${
      mask ? `<rect width="100%" height="100%" fill="#000000"/>` : ''
    }${ordered
      .map((annotation) =>
        shapeMarkup(annotation, sourceWidth, sourceHeight, bounds.left, bounds.top, { mask }),
      )
      .join('')}</svg>`,
  );
};

const annotationBounds = (annotation, width, height) => {
  const xs = annotation.points.map((point) => point.x * width);
  const ys = annotation.points.map((point) => point.y * height);
  const radius = annotation.type === 'brush' ? strokePixels(annotation, width, height) / 2 : 0;
  return {
    left: Math.min(...xs) - radius,
    top: Math.min(...ys) - radius,
    right: Math.max(...xs) + radius,
    bottom: Math.max(...ys) + radius,
  };
};

const fitAxis = (minimum, maximum, total, minimumContext) => {
  const center = (minimum + maximum) / 2;
  const size = Math.min(total, Math.max(maximum - minimum, minimumContext));
  const start = Math.max(0, Math.min(total - size, center - size / 2));
  return [Math.floor(start), Math.ceil(Math.min(total, start + size))];
};

export function regionalRestyleEnabled(annotations = [], background = 'scene') {
  return background !== 'white' && annotations.some((annotation) => annotation.mode === 'adjust');
}

export function regionalRestyleBounds(annotations, width, height) {
  const targets = annotations
    .filter((annotation) => annotation.mode === 'adjust')
    .map((annotation) => annotationBounds(annotation, width, height));
  ensure(targets.length, '局部改款至少需要一个调整区');
  const target = {
    left: Math.max(0, Math.min(...targets.map((item) => item.left))),
    top: Math.max(0, Math.min(...targets.map((item) => item.top))),
    right: Math.min(width, Math.max(...targets.map((item) => item.right))),
    bottom: Math.min(height, Math.max(...targets.map((item) => item.bottom))),
  };
  const targetWidth = Math.max(2, target.right - target.left);
  const targetHeight = Math.max(2, target.bottom - target.top);
  const contextWidth = Math.min(width, Math.max(512, targetWidth * 1.7));
  const contextHeight = Math.min(height, Math.max(512, targetHeight * 1.7));
  const [left, right] = fitAxis(target.left, target.right, width, contextWidth);
  const [top, bottom] = fitAxis(target.top, target.bottom, height, contextHeight);
  return { left, top, width: right - left, height: bottom - top };
}

export async function prepareRegionalRestyle({ source, annotations, directory }) {
  const normalizedPath = path.join(directory, 'regional-original.png');
  const sourcePath = path.join(directory, 'regional-source.png');
  const guidePath = path.join(directory, 'regional-guide.png');
  const maskPath = path.join(directory, 'regional-mask.png');
  await sharp(source, inputOptions).rotate().png().toFile(normalizedPath);
  const metadata = await sharp(normalizedPath).metadata();
  ensure(metadata.width && metadata.height, '无法读取局部改款原图尺寸');
  const bounds = regionalRestyleBounds(annotations, metadata.width, metadata.height);
  const crop = await sharp(normalizedPath).extract(bounds).png().toBuffer();
  const guide = annotationSvg(annotations, metadata.width, metadata.height, bounds);
  const mask = annotationSvg(annotations, metadata.width, metadata.height, bounds, { mask: true });
  await sharp(crop).png().toFile(sourcePath);
  await sharp(crop)
    .composite([{ input: guide }])
    .png()
    .toFile(guidePath);
  await sharp(mask).removeAlpha().greyscale().png().toFile(maskPath);
  return {
    normalizedPath,
    sourcePath,
    guidePath,
    maskPath,
    bounds,
    sourceWidth: metadata.width,
    sourceHeight: metadata.height,
  };
}

export async function composeRegionalRestyle({ generated, prepared }) {
  const { bounds, normalizedPath, maskPath, sourceWidth, sourceHeight } = prepared;
  const editedCrop = await sharp(generated, inputOptions)
    .rotate()
    .resize(bounds.width, bounds.height, { fit: 'fill' })
    .removeAlpha()
    .png()
    .toBuffer();
  const hard = await sharp(maskPath).removeAlpha().greyscale().raw().toBuffer();
  const featherRadius = Math.max(
    1,
    Math.min(8, Math.round(Math.min(bounds.width, bounds.height) / 180)),
  );
  const softened = await sharp(maskPath)
    .blur(featherRadius)
    .removeAlpha()
    .greyscale()
    .raw()
    .toBuffer();
  const alpha = Buffer.alloc(hard.length);
  for (let index = 0; index < hard.length; index++)
    alpha[index] = hard[index] ? softened[index] : 0;
  const alphaPixels = Buffer.alloc(alpha.length * 4);
  for (let index = 0; index < alpha.length; index++) {
    const offset = index * 4;
    alphaPixels[offset] = 255;
    alphaPixels[offset + 1] = 255;
    alphaPixels[offset + 2] = 255;
    alphaPixels[offset + 3] = alpha[index];
  }
  const alphaMask = await sharp(alphaPixels, {
    raw: { width: bounds.width, height: bounds.height, channels: 4 },
  })
    .png()
    .toBuffer();
  const patch = await sharp(editedCrop)
    .ensureAlpha()
    .composite([{ input: alphaMask, blend: 'dest-in' }])
    .png()
    .toBuffer();
  const layer = await sharp({
    create: {
      width: sourceWidth,
      height: sourceHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: patch, left: bounds.left, top: bounds.top }])
    .png()
    .toBuffer();
  const composite = await sharp(normalizedPath)
    .composite([{ input: patch, left: bounds.left, top: bounds.top }])
    .png()
    .toBuffer();
  return { composite, layer, bounds };
}
