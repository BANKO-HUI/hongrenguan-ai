import { z } from 'zod';

export const text = z.string().trim().min(1).max(10000);
export const DEFAULT_SERIES_PROMPT =
  '分析所选流行趋势报告，并根据趋势方向将模特生成指定数量的同类风格款式。服装搭配、配饰、妆发均可调整；Logo 需根据服装风格协调调整大小、颜色、工艺和表现风格。其他要求或限制以本系列描述为准。';
export const projectInput = z.object({
  name: text.max(100),
  group: text.max(80).default('进行中'),
  prompt: z.string().max(10000).default(DEFAULT_SERIES_PROMPT),
  lookCount: z.number().int().min(1).max(12).default(12),
  logoMethod: z.enum(['刺绣', '反光印花', '织章']).default('刺绣'),
  logoScale: z.number().min(20).max(80).default(42),
  patternCoverage: z.number().min(10).max(100).default(50),
  trendRefs: z
    .array(
      z.object({
        trendId: z.string().trim().min(1).max(100),
        role: z.enum(['primary', 'secondary']),
      }),
    )
    .max(3)
    .default([]),
  modelRefId: z.string().trim().min(1).max(100).nullable().default(null),
  brandRefId: z.string().trim().min(1).max(100).nullable().default(null),
  patternRefId: z.string().trim().min(1).max(100).nullable().default(null),
  fabricRefId: z.string().trim().min(1).max(100).nullable().default(null),
  backgroundRefId: z.string().trim().min(1).max(100).nullable().default(null),
  customRefIds: z.array(z.string().trim().min(1).max(100)).default([]),
  keepIdentity: z.boolean().default(true),
  logoHarmony: z.boolean().default(true),
  autoInvert: z.boolean().default(true),
});
export const projectPatch = projectInput.partial().strict();
export const analysisInput = z.object({
  theme: text.max(200),
  summary: text,
  keywords: z.array(text.max(100)).min(1).max(20),
  colors: z
    .array(z.object({ name: text.max(80), hex: z.string().regex(/^#[0-9a-fA-F]{6}$/) }))
    .min(1)
    .max(12),
  silhouettes: text,
  functions: text,
  techniques: text,
  evidence: z
    .array(
      z.object({
        sourceKind: z.enum(['pdf-page', 'image']).optional(),
        page: z.number().int().min(1).optional(),
        note: text,
      }),
    )
    .min(1)
    .max(40),
});
export const libraryMetaInput = z.object({
  title: text.max(160).optional(),
  group: text.max(80).optional(),
  tags: z.array(text.max(40)).max(20).optional(),
});
export const libraryMetaPatch = libraryMetaInput.partial().strict();
export const materialKind = z.enum(['model', 'logo', 'pattern', 'fabric', 'custom']);
const normalizedCropRect = z
  .object({
    left: z.number().min(0).max(1),
    top: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .strict()
  .refine((rect) => rect.left + rect.width <= 1.000001, '裁剪框超出图片右边界')
  .refine((rect) => rect.top + rect.height <= 1.000001, '裁剪框超出图片下边界');
export const materialCropInput = z
  .object({
    aspect: z.enum(['free', 'original', '1:1', '3:4', '4:5', '16:9']),
    zoom: z.number().min(1).max(3),
    x: z.number().min(-100).max(100),
    y: z.number().min(-100).max(100),
    cropRect: normalizedCropRect.optional(),
    expectedRevision: z.number().int().min(0),
  })
  .strict()
  .refine((input) => input.aspect !== 'free' || input.cropRect, '自由裁剪需要有效裁剪框');
export const materialCropResetInput = z
  .object({ expectedRevision: z.number().int().min(0) })
  .strict();
export const lookDeleteInput = z.object({ lookIds: z.array(text.max(100)).min(1) }).strict();
export const lookPrimaryInput = z.object({ assetId: text.max(100) }).strict();
export const lookLayerStackInput = z
  .object({
    layers: z
      .array(
        z
          .object({
            id: text.max(100),
            name: z.string().trim().min(1).max(80),
            visible: z.boolean(),
            opacity: z.number().min(0).max(1),
          })
          .strict(),
      )
      .max(50),
  })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.layers.map((layer) => layer.id)).size !== input.layers.length)
      context.addIssue({ code: 'custom', path: ['layers'], message: '图层不能重复' });
  });
export const memoryCategory = z.enum([
  'brand',
  'aesthetic',
  'color',
  'silhouette',
  'material',
  'styling',
  'workflow',
  'constraint',
]);
export const memoryInput = z
  .object({
    title: z.string().trim().max(100).default(''),
    text: text.max(1200),
    scope: z.enum(['global', 'project']).default('global'),
    projectId: z.string().trim().min(1).max(100).nullable().default(null),
    category: memoryCategory.default('aesthetic'),
    polarity: z.enum(['rule', 'positive', 'negative']).default('rule'),
  })
  .strict();
export const memoryPatch = z
  .object({
    title: z.string().trim().max(100).optional(),
    text: text.max(1200).optional(),
    scope: z.enum(['global', 'project']).optional(),
    projectId: z.string().trim().min(1).max(100).nullable().optional(),
    category: memoryCategory.optional(),
    polarity: z.enum(['rule', 'positive', 'negative']).optional(),
    status: z.enum(['active', 'archived']).optional(),
    expectedRevision: z.number().int().min(0).optional(),
  })
  .strict();
export const lookFeedbackInput = z
  .object({
    value: z.enum(['liked', 'disliked', 'clear']),
    note: z.string().trim().max(500).default(''),
  })
  .strict();
const annotationPoint = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
export const regionAnnotation = z
  .object({
    id: z.string().trim().min(1).max(100),
    type: z.enum(['brush', 'circle', 'rect']),
    mode: z.enum(['lock', 'adjust']),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    colorName: z.string().trim().max(40).default(''),
    label: z.string().trim().max(80).default(''),
    strokeWidth: z.number().int().min(2).max(100).optional(),
    points: z.array(annotationPoint).min(2).max(500),
  })
  .strict();
export const taskInput = z
  .object({
    kind: z.enum(['analysis', 'series', 'white', 'refine', 'restyle', 'viral']),
    channel: z.enum(['workbench', 'chat']).default('workbench'),
    lookIds: z.array(text.max(100)).default([]),
    sourceAssetId: z.string().trim().min(1).max(100).nullable().default(null),
    layerMode: z.boolean().default(true),
    referenceAssetIds: z.array(text.max(100)).default([]),
    referenceLabels: z.array(z.string().trim().min(1).max(80)).default([]),
    annotations: z.array(regionAnnotation).max(50).default([]),
    count: z.number().int().min(1).max(12).default(1),
    instruction: z.string().max(10000).default(''),
    background: z.enum(['scene', 'white']).default('scene'),
  })
  .superRefine((input, context) => {
    if (
      input.channel === 'chat' &&
      (input.sourceAssetId || input.lookIds.length ? 1 : 0) + input.referenceAssetIds.length > 5
    )
      context.addIssue({
        code: 'custom',
        path: ['referenceAssetIds'],
        message: 'Chat 模式最多使用 5 张参考图',
      });
    if (
      input.referenceLabels.length &&
      input.referenceLabels.length !== input.referenceAssetIds.length
    )
      context.addIssue({
        code: 'custom',
        path: ['referenceLabels'],
        message: '参考图名称需与图片数量一致',
      });
    if (new Set(input.referenceLabels).size !== input.referenceLabels.length)
      context.addIssue({
        code: 'custom',
        path: ['referenceLabels'],
        message: '参考图名称不能重复',
      });
  });
export const planInput = z
  .array(
    z.object({
      slot: z.number().int().min(1).max(12),
      title: text.max(100),
      prompt: text,
      designNotes: text,
    }),
  )
  .min(1)
  .max(12);

export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export function ensure(condition, message, status = 400) {
  if (!condition) throw new AppError(message, status);
}
