import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import {
  accessSync,
  constants,
  copyFileSync,
  readFileSync,
  realpathSync,
  writeFileSync,
  existsSync,
  statSync,
} from 'node:fs';
import sharp from 'sharp';
import { zipSync, strToU8 } from 'fflate';
import { Store } from './store.js';
import {
  ensure,
  projectInput,
  projectPatch,
  taskInput,
  analysisInput,
  planInput,
  libraryMetaInput,
  libraryMetaPatch,
  materialKind,
  materialCropInput,
  materialCropResetInput,
  lookDeleteInput,
  lookPrimaryInput,
  lookLayerStackInput,
  memoryInput,
  memoryPatch,
  lookFeedbackInput,
} from './schema.js';

const now = () => new Date().toISOString();
const safeFilePart = (value, fallback = '未命名') =>
  String(value || fallback)
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80) || fallback;
const outputKindNames = {
  series: '系列生成',
  viral: '爆款裂变',
  restyle: '改款',
  refine: '精修',
  white: '白底',
};
const changed = (project) => {
  project.revision = (project.revision || 0) + 1;
  project.updatedAt = now();
};
export const active = (task) => ['pending', 'running', 'paused'].includes(task.status);
const findProject = (state, id) => {
  const p = state.projects.find((p) => p.id === id);
  ensure(p, '项目不存在', 404);
  return p;
};
const findTask = (state, id) => {
  const t = state.tasks.find((t) => t.id === id);
  ensure(t, '任务不存在', 404);
  return t;
};
const findTrend = (state, id) => {
  const item = state.trendLibrary.items.find((item) => item.id === id);
  ensure(item, '趋势资料不存在', 404);
  return item;
};
const findMaterial = (state, id) => {
  const item = state.materialLibrary.items.find((item) => item.id === id);
  ensure(item, '素材不存在', 404);
  return item;
};
const findMemory = (state, id) => {
  const item = state.memory.entries.find((item) => item.id === id);
  ensure(item, '记忆不存在', 404);
  return item;
};
const memoryContextFor = (state, projectId = null) => {
  if (state.memory?.enabled === false) return [];
  return (state.memory?.entries || [])
    .filter(
      (item) =>
        item.status === 'active' &&
        (item.scope === 'global' || (projectId && item.projectId === projectId)),
    )
    .sort(
      (left, right) =>
        (right.confidence || 0) - (left.confidence || 0) ||
        String(right.updatedAt).localeCompare(String(left.updatedAt)),
    )
    .slice(0, 24)
    .map(({ id, title, text, scope, category, polarity, confidence, source }) => ({
      id,
      title,
      text,
      scope,
      category,
      polarity,
      confidence,
      source,
    }));
};
const idle = (state, id) =>
  ensure(
    !state.tasks.some((t) => t.projectId === id && active(t)),
    '请先完成或结束当前项目的任务',
    409,
  );
const trendIdle = (state, id) =>
  ensure(
    !state.tasks.some((task) => task.trendId === id && active(task)),
    '趋势资料正在提炼，请完成或结束任务后再修改',
    409,
  );
const assetUrl = (id) => (id ? `/api/files/${id}` : null);
const newProject = (input) => ({
  ...projectInput.parse(input),
  id: randomUUID(),
  revision: 0,
  assets: {},
  analysis: null,
  confirmed: false,
  looks: [],
  archivedLooks: [],
  history: [],
  nextLookSlot: 1,
  createdAt: now(),
  updatedAt: now(),
});
const syncProjectRefs = (state, project) => {
  const primary = project.trendRefs?.find((ref) => ref.role === 'primary');
  const trend = primary && state.trendLibrary.items.find((item) => item.id === primary.trendId);
  const model = state.materialLibrary.items.find((item) => item.id === project.modelRefId);
  const brand = state.materialLibrary.items.find((item) => item.id === project.brandRefId);
  const pattern = state.materialLibrary.items.find((item) => item.id === project.patternRefId);
  const fabric = state.materialLibrary.items.find((item) => item.id === project.fabricRefId);
  const background = state.materialLibrary.items.find(
    (item) => item.id === project.backgroundRefId,
  );
  project.assets ||= {};
  project.assets.report = trend?.assetId || null;
  project.assets.model = model?.assetId || null;
  project.assets.logo = brand?.assetId || null;
  project.assets.pattern = pattern?.assetId || null;
  project.assets.fabric = fabric?.assetId || null;
  project.assets.background = background?.assetId || null;
  project.analysis = trend?.analysis || null;
  project.confirmed = true;
};
const projectTasks = (state, projectId, excludeId = null) =>
  state.tasks.filter(
    (task) => task.id !== excludeId && task.projectId === projectId && active(task),
  );
const maxLookSlot = (project) =>
  Math.max(
    0,
    ...[...(project.looks || []), ...(project.archivedLooks || [])]
      .map((look) => look.slot)
      .filter((slot) => Number.isInteger(slot) && slot > 0),
  );
const ensureTaskCompatible = (state, project, task, excludeId = null) => {
  const others = projectTasks(state, project.id, excludeId);
  if (['series', 'viral'].includes(task.kind))
    ensure(
      !others.some((other) => other.kind === task.kind),
      task.kind === 'series'
        ? '当前项目已有系列生成任务，请等待完成或结束后再新增生成'
        : '当前项目已有爆款裂变任务，请等待完成或结束后再新增裂变',
      409,
    );
  if (task.kind === 'analysis')
    ensure(!others.some((other) => other.kind === 'analysis'), '当前趋势解析任务已存在', 409);
  if (['white', 'refine', 'restyle'].includes(task.kind)) {
    ensure(
      !others.some(
        (other) =>
          ['white', 'refine', 'restyle'].includes(other.kind) &&
          other.lookIds.some((lookId) => task.lookIds.includes(lookId)),
      ),
      '所选成片已有白底、精修或改款任务，请在任务中心处理后继续',
      409,
    );
  }
};
const editableLayer = (result, task, index = 0) => ({
  id: randomUUID(),
  assetId: result.editLayer.assetId,
  sourceAssetId: result.editLayer.sourceAssetId,
  bounds: structuredClone(result.editLayer.bounds),
  name: `局部改款 ${index + 1}`,
  instruction: task.instruction,
  taskId: task.id,
  visible: true,
  opacity: 1,
  createdAt: now(),
});
const publishSeriesResults = (project, task) => {
  if (!task.publishedAt) {
    project.provenance = 'AI 生成';
    task.publishedAt = now();
  }
  for (const result of [...task.results].sort((a, b) => a.slot - b.slot)) {
    if (result.lookId && project.looks.some((look) => look.id === result.lookId)) continue;
    const plan = task.plan.find((item) => item.slot === result.slot);
    ensure(plan, '生成计划缺少对应造型', 409);
    result.lookId ||= randomUUID();
    project.looks.push({
      id: result.lookId,
      slot: (task.slotOffset || 0) + result.slot,
      title: plan.title,
      designNotes: plan.designNotes,
      prompt: plan.prompt,
      scene: result.assetId,
      white: null,
      versions: [],
      taskId: task.id,
      originKind: task.kind,
      provenance: 'codex',
    });
  }
  project.looks.sort((a, b) => (a.slot || 0) - (b.slot || 0));
};
const taskInputsCurrent = (project, task) => {
  if (!project) return false;
  if (['series', 'viral'].includes(task.kind)) return true;
  if (task.kind === 'analysis') return project.assets.report === task.snapshot?.assets?.report;
  if (task.kind === 'restyle' && !task.lookIds.length) return Boolean(task.sourceAssetId);
  if (['white', 'refine', 'restyle'].includes(task.kind) && task.lookIds.length)
    return task.lookIds.every((lookId) => {
      const current = project.looks.find((look) => look.id === lookId);
      const original = task.snapshot.looks.find((look) => look.id === lookId);
      if (task.layerBaseAssetId)
        return (
          current &&
          original &&
          (current.layerBaseScene || current.scene) === task.layerBaseAssetId &&
          current.white === original.white
        );
      return (
        current && original && current.scene === original.scene && current.white === original.white
      );
    });
  return false;
};
const newTrendAnalysisTask = (item) => {
  const createdAt = now();
  return {
    kind: 'analysis',
    id: randomUUID(),
    trendId: item.id,
    projectId: null,
    projectName: item.title,
    total: 1,
    lookIds: [],
    instruction: '',
    background: 'scene',
    status: 'pending',
    message: '等待开始解析',
    results: [],
    plan: [],
    snapshot: { trend: structuredClone(item) },
    createdAt,
    updatedAt: createdAt,
    attempts: 0,
  };
};

export class Workbench {
  constructor({ root, directory, seed = true }) {
    this.root = root;
    this.store = new Store(directory);
    if (seed && !this.store.state.migrations.includes('archive-v1')) this.seedArchive();
    if (!this.store.state.migrations.includes('shared-libraries-v2')) this.migrateSharedLibraries();
    if (!this.store.state.migrations.includes('append-only-series-v3'))
      this.migrateAppendOnlySeries();
    if (!this.store.state.migrations.includes('reference-slots-v4')) this.migrateReferenceSlots();
    if (!this.store.state.migrations.includes('memory-v1')) this.migrateMemory();
    if (!this.store.state.migrations.includes('chat-results-finished-only-v1'))
      this.migrateChatResultsToFinishedOnly();
    this.store.transaction((state) => {
      for (const project of state.projects) project.archivedLooks ||= [];
      for (const project of state.projects) project.customRefIds ||= [];
      for (const project of state.projects) project.backgroundRefId ??= null;
      state.outputDirectory ||= {
        path: '',
        enabled: false,
        lastSavedAt: null,
        lastSavedFile: null,
        lastError: null,
      };
      state.outputDirectory.path ||= '';
      state.outputDirectory.enabled = Boolean(
        state.outputDirectory.enabled && state.outputDirectory.path,
      );
      state.outputDirectory.lastSavedAt ??= null;
      state.outputDirectory.lastSavedFile ??= null;
      state.outputDirectory.lastError ??= null;
      for (const task of state.tasks.filter((t) => t.status === 'running')) {
        task.status = 'paused';
        task.claim = null;
        task.message = '服务重启，任务已暂停；已完成结果保留，点击继续执行';
        if (task.trendId) {
          const trend = state.trendLibrary.items.find((item) => item.id === task.trendId);
          if (trend) trend.status = 'paused';
        }
      }
      for (const project of state.projects) {
        const partialSeries = state.tasks.find(
          (task) =>
            task.projectId === project.id &&
            ['series', 'viral'].includes(task.kind) &&
            active(task) &&
            task.results.some((result) => result.assetId),
        );
        if (partialSeries) publishSeriesResults(project, partialSeries);
      }
    });
  }
  migrateMemory() {
    const backup = path.join(this.store.directory, 'state.pre-memory-v1.backup.json');
    if (existsSync(this.store.file) && !existsSync(backup)) copyFileSync(this.store.file, backup);
    this.store.transaction((state) => {
      state.memory ||= { enabled: true, entries: [] };
      state.memory.enabled ??= true;
      state.memory.entries ||= [];
      state.migrations.push('memory-v1');
    });
  }
  migrateChatResultsToFinishedOnly() {
    const backup = path.join(
      this.store.directory,
      'state.pre-chat-results-finished-only-v1.backup.json',
    );
    if (existsSync(this.store.file) && !existsSync(backup)) copyFileSync(this.store.file, backup);
    this.store.transaction((state) => {
      const chatImageTaskIds = new Set(
        state.tasks
          .filter((task) => task.channel === 'chat' && task.kind !== 'analysis')
          .map((task) => task.id),
      );
      state.materialLibrary.items = state.materialLibrary.items.filter(
        (item) => !chatImageTaskIds.has(item.sourceTaskId),
      );
      const usedGroups = new Set(state.materialLibrary.items.map((item) => item.group));
      state.materialLibrary.groups = state.materialLibrary.groups.filter(
        (group) => group !== 'Chat 生成' || usedGroups.has(group),
      );
      state.migrations.push('chat-results-finished-only-v1');
    });
  }
  migrateReferenceSlots() {
    const backup = path.join(this.store.directory, 'state.pre-reference-slots-v4.backup.json');
    if (existsSync(this.store.file) && !existsSync(backup)) copyFileSync(this.store.file, backup);
    this.store.transaction((state) => {
      for (const project of state.projects) {
        project.patternRefId ??= null;
        project.fabricRefId ??= null;
        project.backgroundRefId ??= null;
        const legacyBrand = state.materialLibrary.items.find(
          (item) => item.id === project.brandRefId,
        );
        if (legacyBrand?.kind === 'pattern' && !project.patternRefId) {
          project.patternRefId = legacyBrand.id;
          project.brandRefId = null;
        }
        for (const look of [...(project.looks || []), ...(project.archivedLooks || [])]) {
          const sourceTask = state.tasks.find((task) => task.id === look.taskId);
          look.originKind ||= ['series', 'viral', 'restyle'].includes(sourceTask?.kind)
            ? sourceTask.kind
            : 'legacy';
        }
      }
      state.migrations.push('reference-slots-v4');
    });
  }
  migrateAppendOnlySeries() {
    const backup = path.join(this.store.directory, 'state.pre-append-only-v3.backup.json');
    if (existsSync(this.store.file) && !existsSync(backup)) copyFileSync(this.store.file, backup);
    this.store.transaction((state) => {
      for (const project of state.projects) {
        project.archivedLooks ||= [];
        const replacedSeries = project.history.filter((entry) => entry.reason === '系列重新生成');
        const archivedIds = new Set(project.archivedLooks.map((look) => look.id));
        const merged = [];
        const positions = new Map();
        for (const look of [
          ...replacedSeries.flatMap((entry) => entry.looks || []),
          ...(project.looks || []),
        ]) {
          if (!look?.id || archivedIds.has(look.id)) continue;
          if (positions.has(look.id)) merged[positions.get(look.id)] = look;
          else {
            positions.set(look.id, merged.length);
            merged.push(look);
          }
        }
        project.looks = merged;
        project.history = project.history.filter((entry) => entry.reason !== '系列重新生成');

        const assigned = new Set();
        let nextSlot = 1;
        for (const look of [...project.looks, ...project.archivedLooks]) {
          if (!Number.isInteger(look.slot) || look.slot < 1 || assigned.has(look.slot)) {
            while (assigned.has(nextSlot)) nextSlot += 1;
            look.slot = nextSlot;
          }
          assigned.add(look.slot);
          nextSlot = Math.max(nextSlot, look.slot + 1);
        }

        const projectLooks = [...project.looks, ...project.archivedLooks];
        const projectSeries = state.tasks
          .filter((task) => task.projectId === project.id && task.kind === 'series')
          .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
        for (const task of projectSeries) {
          const matchedResult = task.results?.find((result) =>
            projectLooks.some((look) => look.id === result.lookId || look.scene === result.assetId),
          );
          const matchedLook =
            matchedResult &&
            projectLooks.find(
              (look) => look.id === matchedResult.lookId || look.scene === matchedResult.assetId,
            );
          const snapshotMax = Math.max(
            0,
            ...(task.snapshot?.looks || [])
              .map((look) => look.slot)
              .filter((slot) => Number.isInteger(slot) && slot > 0),
          );
          task.slotOffset = Number.isInteger(task.slotOffset)
            ? task.slotOffset
            : matchedLook
              ? Math.max(0, matchedLook.slot - matchedResult.slot)
              : Math.max(snapshotMax, task.snapshot?.looks?.length || 0);
          nextSlot = Math.max(nextSlot, task.slotOffset + task.total + 1);
        }
        project.nextLookSlot = Math.max(nextSlot, maxLookSlot(project) + 1);
        if (replacedSeries.length) changed(project);
      }
      state.migrations.push('append-only-series-v3');
    });
  }
  migrateSharedLibraries() {
    this.store.transaction((state) => {
      state.trendLibrary ||= { groups: ['未分组'], items: [] };
      state.materialLibrary ||= { groups: ['未分组'], items: [] };
      state.trendLibrary.groups ||= ['未分组'];
      state.materialLibrary.groups ||= ['未分组'];
      state.trendLibrary.items ||= [];
      state.materialLibrary.items ||= [];
      const trendByAsset = new Map(state.trendLibrary.items.map((item) => [item.assetId, item]));
      const materialByAsset = new Map(
        state.materialLibrary.items.map((item) => [`${item.kind}:${item.assetId}`, item]),
      );
      for (const project of state.projects) {
        project.trendRefs ||= [];
        project.modelRefId ??= null;
        project.brandRefId ??= null;
        project.patternRefId ??= null;
        project.fabricRefId ??= null;
        project.backgroundRefId ??= null;
        project.customRefIds ||= [];
        project.patternCoverage ??= 50;
        const reportId = project.assets?.report;
        if (reportId) {
          let item = trendByAsset.get(reportId);
          if (!item) {
            const asset = state.assets[reportId] || {};
            item = {
              id: randomUUID(),
              assetId: reportId,
              coverAssetId: asset.mime?.startsWith('image/') ? reportId : null,
              sourceType: asset.mime === 'application/pdf' ? 'pdf' : 'image',
              title:
                project.analysis?.theme || asset.filename?.replace(/\.[^.]+$/, '') || project.name,
              group: project.group || '未分组',
              tags: project.analysis?.keywords?.slice(0, 8) || [],
              status: project.analysis ? 'ready' : 'uploaded',
              analysis: project.analysis || null,
              analysisHistory: project.analysisHistory || [],
              createdAt: asset.createdAt || project.createdAt || now(),
              updatedAt: project.updatedAt || now(),
              archivedAt: null,
            };
            state.trendLibrary.items.push(item);
            trendByAsset.set(reportId, item);
            if (!state.trendLibrary.groups.includes(item.group))
              state.trendLibrary.groups.push(item.group);
          } else if (!item.analysis && project.analysis) {
            item.analysis = project.analysis;
            item.status = 'ready';
          }
          if (!project.trendRefs.length)
            project.trendRefs = [{ trendId: item.id, role: 'primary' }];
        }
        for (const kind of ['model', 'logo']) {
          const assetId = project.assets?.[kind];
          if (!assetId) continue;
          const key = `${kind}:${assetId}`;
          let item = materialByAsset.get(key);
          if (!item) {
            const asset = state.assets[assetId] || {};
            item = {
              id: randomUUID(),
              assetId,
              kind,
              title: asset.filename?.replace(/\.[^.]+$/, '') || `${project.name} ${kind}`,
              group: project.group || '未分组',
              tags: [],
              createdAt: asset.createdAt || project.createdAt || now(),
              updatedAt: project.updatedAt || now(),
              archivedAt: null,
            };
            state.materialLibrary.items.push(item);
            materialByAsset.set(key, item);
            if (!state.materialLibrary.groups.includes(item.group))
              state.materialLibrary.groups.push(item.group);
          }
          if (kind === 'model' && !project.modelRefId) project.modelRefId = item.id;
          if (kind === 'logo' && !project.brandRefId) project.brandRefId = item.id;
        }
      }
      state.version = 2;
      state.migrations.push('shared-libraries-v2');
    });
  }
  registerBuffer(buffer, filename, mime) {
    const id = randomUUID();
    const extension =
      mime === 'application/pdf' ? '.pdf' : mime === 'application/octet-stream' ? '.bin' : '.png';
    const relativePath = `files/${id}${extension}`;
    writeFileSync(path.join(this.store.directory, relativePath), buffer, { mode: 0o600 });
    return {
      id,
      filename: path.basename(filename),
      mime,
      relativePath,
      size: buffer.length,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      createdAt: now(),
    };
  }
  seedArchive() {
    const assets = {};
    const register = (relativePath, filename) => {
      const full = path.join(this.root, relativePath);
      if (!existsSync(full)) return null;
      const id = randomUUID();
      assets[id] = {
        id,
        filename: filename || path.basename(full),
        archivePath: relativePath,
        mime: full.endsWith('.pdf')
          ? 'application/pdf'
          : full.endsWith('.svg')
            ? 'image/svg+xml'
            : full.endsWith('.jpg')
              ? 'image/jpeg'
              : 'image/png',
        size: statSync(full).size,
        createdAt: now(),
      };
      return id;
    };
    const report = register(
      '项目资料/趋势报告/Mountain Running Plan 跑山计划（2027春夏户外运动主题趋势）_WOW-TREND.pdf',
    );
    const model = register('public/assets/model-reference.jpg');
    const logo = register('public/assets/badmark-logo.svg');
    const projects = [
      {
        id: 'forest',
        name: '森林穿越系列',
        prefix: 'badmark_heavy_outdoor',
        white: true,
        prompt: '重装徒步、溯溪、穿越森林。强调防撕裂面料、储物系统与大地色功能美学。',
      },
      {
        id: 'mountain',
        name: '跑山计划系列',
        prefix: 'badmark_mountain_running',
        prompt: '山地越野跑与城市机能融合，轻量防风、动态层次与储水背心。',
      },
    ].map((config) => {
      const project = {
        ...newProject({ name: config.name, prompt: config.prompt }),
        id: config.id,
        provenance: '历史归档',
        assets: { report, model, logo },
      };
      for (let i = 1; i <= 12; i++) {
        const id = String(i).padStart(2, '0');
        const scene = register(`outputs/${config.prefix}_look_${id}.png`);
        const white = config.white
          ? register(`outputs/${config.prefix}_whitebg_look_${id}.png`)
          : null;
        if (scene)
          project.looks.push({
            id: randomUUID(),
            title: `LOOK ${id}`,
            scene,
            white,
            designNotes: '历史归档成片，未重新生成。',
            versions: [],
            provenance: 'archive',
          });
      }
      return project;
    });
    this.store.transaction((state) => {
      Object.assign(state.assets, assets);
      state.projects.push(...projects);
      state.migrations.push('archive-v1');
    });
  }
  assetPath(id) {
    const asset = this.store.state.assets[id];
    ensure(asset, '文件不存在', 404);
    return asset.archivePath
      ? path.join(this.root, asset.archivePath)
      : path.join(this.store.directory, asset.relativePath);
  }
  validateOutputDirectory(directory) {
    const requested = String(directory || '').trim();
    ensure(requested, '请选择需要绑定的本地文件夹');
    ensure(path.isAbsolute(requested), '请输入本地文件夹的完整路径');
    let resolved;
    try {
      resolved = realpathSync(requested);
      ensure(statSync(resolved).isDirectory(), '绑定位置不是文件夹');
      ensure(resolved !== path.parse(resolved).root, '不能绑定磁盘根目录，请选择一个具体文件夹');
      accessSync(resolved, constants.W_OK);
    } catch (error) {
      if (error?.status) throw error;
      ensure(false, '文件夹不存在或当前帐号没有写入权限');
    }
    return resolved;
  }
  setOutputDirectory(input = {}) {
    const enabled = input.enabled !== false;
    const directory = enabled ? this.validateOutputDirectory(input.path) : String(input.path || '');
    return this.store.transaction((state) => {
      state.outputDirectory = {
        ...(state.outputDirectory || {}),
        path: directory,
        enabled: Boolean(enabled && directory),
        updatedAt: now(),
        lastError: null,
      };
      return state.outputDirectory;
    });
  }
  generatedOutputFilename(asset, task, slot, suffix = '') {
    const project = this.store.state.projects.find((item) => item.id === task?.projectId);
    const extension = path.extname(asset.filename || '') || '.png';
    const parts = [
      '红人馆AI',
      safeFilePart(project?.name || task?.projectName || '未归档项目'),
      safeFilePart(outputKindNames[task?.kind] || task?.kind || '生成结果'),
      `LOOK_${String(slot || 1).padStart(2, '0')}`,
      suffix ? safeFilePart(suffix) : '',
      asset.id.slice(0, 8),
    ].filter(Boolean);
    return `${parts.join('_')}${extension}`;
  }
  copyGeneratedAsset(assetId, task, slot, suffix = '') {
    const config = this.store.state.outputDirectory;
    if (!config?.enabled || !config.path) return null;
    const directory = this.validateOutputDirectory(config.path);
    const asset = this.store.state.assets[assetId];
    ensure(asset, '生成文件不存在', 404);
    const filename = this.generatedOutputFilename(asset, task, slot, suffix);
    copyFileSync(this.assetPath(assetId), path.join(directory, filename));
    return filename;
  }
  recordOutputResult(filename, error = null) {
    return this.store.transaction((state) => {
      state.outputDirectory ||= { path: '', enabled: false };
      state.outputDirectory.lastError = error ? String(error.message || error) : null;
      if (filename) {
        state.outputDirectory.lastSavedAt = now();
        state.outputDirectory.lastSavedFile = filename;
      }
      return state.outputDirectory;
    });
  }
  mirrorGeneratedResult(taskId, slot, assetId, layerAssetId = null) {
    if (!this.store.state.outputDirectory?.enabled) return null;
    const task = findTask(this.store.state, taskId);
    try {
      const filename = this.copyGeneratedAsset(assetId, task, slot);
      if (layerAssetId) this.copyGeneratedAsset(layerAssetId, task, slot, '局部图层');
      this.recordOutputResult(filename);
      return filename;
    } catch (error) {
      this.recordOutputResult(null, error);
      return null;
    }
  }
  syncOutputDirectory() {
    ensure(this.store.state.outputDirectory?.enabled, '请先绑定并启用本地成片文件夹');
    const copied = [];
    const seen = new Set();
    try {
      for (const task of this.store.state.tasks) {
        if (task.kind === 'analysis') continue;
        for (const result of task.results || []) {
          if (result.assetId && !seen.has(result.assetId)) {
            seen.add(result.assetId);
            copied.push(this.copyGeneratedAsset(result.assetId, task, result.slot));
          }
          const layerAssetId = result.editLayer?.assetId;
          if (layerAssetId && !seen.has(layerAssetId)) {
            seen.add(layerAssetId);
            copied.push(this.copyGeneratedAsset(layerAssetId, task, result.slot, '局部图层'));
          }
        }
      }
      this.recordOutputResult(copied.at(-1) || null);
      return { copied: copied.length, directory: this.store.state.outputDirectory.path };
    } catch (error) {
      this.recordOutputResult(null, error);
      throw error;
    }
  }
  publicState() {
    const state = this.store.read();
    for (const a of Object.values(state.assets)) {
      delete a.relativePath;
      delete a.archivePath;
      a.url = assetUrl(a.id);
    }
    for (const t of state.tasks) {
      const project = state.projects.find((p) => p.id === t.projectId);
      const trend = t.trendId && state.trendLibrary.items.find((item) => item.id === t.trendId);
      if (['failed', 'cancelled'].includes(t.status)) {
        t.canRetry = Boolean(
          trend
            ? (trend.revision || 0) === (t.snapshot.trend?.revision || 0)
            : taskInputsCurrent(project, t),
        );
        if (!t.canRetry)
          t.retryNote = trend
            ? '趋势卡片已修改，请重新上传或创建新的提炼任务。'
            : project
              ? '项目已修改，请返回对应步骤创建新任务；此处原结果仍可下载。'
              : '原项目已删除，已完成结果仍可下载。';
      }
      delete t.claim;
      delete t.snapshot;
    }
    return state;
  }
  memoryContext(projectId = null) {
    if (projectId) findProject(this.store.state, projectId);
    return memoryContextFor(this.store.state, projectId);
  }
  setMemoryEnabled(enabled) {
    ensure(typeof enabled === 'boolean', '记忆开关无效');
    return this.store.transaction((state) => {
      state.memory.enabled = enabled;
      return state.memory;
    });
  }
  createMemory(input, metadata = {}) {
    const parsed = memoryInput.parse(input);
    return this.store.transaction((state) => {
      if (parsed.scope === 'project') {
        ensure(parsed.projectId, '项目记忆必须选择项目');
        findProject(state, parsed.projectId);
      }
      const timestamp = now();
      const entry = {
        ...parsed,
        projectId: parsed.scope === 'project' ? parsed.projectId : null,
        id: randomUUID(),
        title: parsed.title || parsed.text.slice(0, 28),
        status: 'active',
        source: metadata.source || 'manual',
        sourceId: metadata.sourceId || null,
        confidence: metadata.confidence || 1,
        evidenceCount: metadata.evidenceCount || 1,
        revision: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      state.memory.entries.unshift(entry);
      return entry;
    });
  }
  updateMemory(id, input) {
    const patch = memoryPatch.parse(input);
    return this.store.transaction((state) => {
      const entry = findMemory(state, id);
      if (patch.expectedRevision !== undefined)
        ensure(patch.expectedRevision === (entry.revision || 0), '记忆已更新，请刷新后重试', 409);
      const nextScope = patch.scope || entry.scope;
      const nextProjectId = patch.projectId === undefined ? entry.projectId : patch.projectId;
      if (nextScope === 'project') {
        ensure(nextProjectId, '项目记忆必须选择项目');
        findProject(state, nextProjectId);
      }
      Object.assign(entry, patch);
      delete entry.expectedRevision;
      entry.projectId = nextScope === 'project' ? nextProjectId : null;
      entry.revision = (entry.revision || 0) + 1;
      entry.updatedAt = now();
      return entry;
    });
  }
  deleteMemory(id) {
    return this.store.transaction((state) => {
      const entry = findMemory(state, id);
      ensure(entry.status === 'archived', '请先停用记忆后再删除', 409);
      state.memory.entries = state.memory.entries.filter((item) => item.id !== id);
      return { deleted: id };
    });
  }
  captureExplicitMemory(projectId, input) {
    const value = String(input || '').trim();
    const patterns = [
      { regex: /(?:请)?记住[：:\s]*(.+)$/i, polarity: 'rule', category: 'aesthetic' },
      { regex: /以后(?:都|请)[：:\s]*(.+)$/i, polarity: 'rule', category: 'workflow' },
      {
        regex: /我的(?:品牌|审美|设计|工作流)?偏好(?:是|为|：|:)[\s]*(.+)$/i,
        polarity: 'positive',
        category: 'aesthetic',
      },
      { regex: /不要再[：:\s]*(.+)$/i, polarity: 'negative', category: 'constraint' },
    ];
    const matched = patterns
      .map((candidate) => ({ ...candidate, match: value.match(candidate.regex) }))
      .find((candidate) => candidate.match?.[1]?.trim());
    if (!matched) return null;
    const text = matched.match[1].trim().slice(0, 1200);
    const scope = projectId ? 'project' : 'global';
    return this.store.transaction((state) => {
      if (projectId) findProject(state, projectId);
      const duplicate = state.memory.entries.find(
        (item) =>
          item.status === 'active' &&
          item.scope === scope &&
          item.projectId === (projectId || null) &&
          item.polarity === matched.polarity &&
          item.text.toLocaleLowerCase() === text.toLocaleLowerCase(),
      );
      if (duplicate) {
        duplicate.evidenceCount = (duplicate.evidenceCount || 1) + 1;
        duplicate.confidence = Math.min(1, (duplicate.confidence || 0.8) + 0.05);
        duplicate.updatedAt = now();
        duplicate.revision = (duplicate.revision || 0) + 1;
        return duplicate;
      }
      const timestamp = now();
      const entry = {
        id: randomUUID(),
        title: text.slice(0, 28),
        text,
        scope,
        projectId: projectId || null,
        category: matched.category,
        polarity: matched.polarity,
        status: 'active',
        source: 'chat-explicit',
        sourceId: null,
        confidence: 1,
        evidenceCount: 1,
        revision: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      state.memory.entries.unshift(entry);
      return entry;
    });
  }
  feedbackLook(projectId, lookId, input) {
    const feedback = lookFeedbackInput.parse(input);
    return this.store.transaction((state) => {
      const project = findProject(state, projectId);
      const look = [...project.looks, ...(project.archivedLooks || [])].find(
        (item) => item.id === lookId,
      );
      ensure(look, '成片不存在', 404);
      look.feedback = feedback.value === 'clear' ? null : feedback.value;
      const sourceId = `look:${projectId}:${lookId}`;
      const existing = state.memory.entries.find((entry) => entry.sourceId === sourceId);
      let memory = existing || null;
      if (feedback.value === 'clear') {
        if (existing) {
          existing.status = 'archived';
          existing.updatedAt = now();
          existing.revision = (existing.revision || 0) + 1;
        }
      } else {
        const positive = feedback.value === 'liked';
        const detail = feedback.note || look.designNotes || look.prompt || look.title;
        const text = positive
          ? `偏好类似“${look.title}”的设计方向：${detail}`
          : `避免类似“${look.title}”的设计方向：${detail}`;
        if (existing) {
          Object.assign(existing, {
            title: `${positive ? '喜欢' : '避免'}：${look.title}`,
            text,
            polarity: positive ? 'positive' : 'negative',
            status: 'active',
            confidence: 1,
            updatedAt: now(),
            revision: (existing.revision || 0) + 1,
          });
        } else {
          const timestamp = now();
          memory = {
            id: randomUUID(),
            title: `${positive ? '喜欢' : '避免'}：${look.title}`,
            text,
            scope: 'project',
            projectId,
            category: 'aesthetic',
            polarity: positive ? 'positive' : 'negative',
            status: 'active',
            source: 'look-feedback',
            sourceId,
            confidence: 1,
            evidenceCount: 1,
            revision: 0,
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          state.memory.entries.unshift(memory);
        }
      }
      changed(project);
      return { lookId, feedback: look.feedback, memory };
    });
  }
  createProject(input) {
    const project = newProject(input);
    return this.store.transaction((state) => {
      if (!state.groups.includes(project.group)) state.groups.push(project.group);
      state.projects.unshift(project);
      return project;
    });
  }
  updateProject(id, input) {
    const { expectedRevision, ...values } = input;
    const parsedPatch = projectPatch.parse(values);
    const patch = Object.fromEntries(
      Object.keys(values)
        .filter((key) => parsedPatch[key] !== undefined)
        .map((key) => [key, parsedPatch[key]]),
    );
    return this.store.transaction((state) => {
      const p = findProject(state, id);
      idle(state, id);
      if (expectedRevision !== undefined)
        ensure(
          expectedRevision === (p.revision || 0),
          '项目已在另一处更新，请检查新设置后重试',
          409,
        );
      if (patch.group && !state.groups.includes(patch.group)) state.groups.push(patch.group);
      if (patch.trendRefs) {
        ensure(
          new Set(patch.trendRefs.map((ref) => ref.trendId)).size === patch.trendRefs.length,
          '趋势资料不能重复选择',
        );
        ensure(
          patch.trendRefs.filter((ref) => ref.role === 'primary').length <= 1,
          '只能选择一个主趋势',
        );
        ensure(
          patch.trendRefs.every((ref) =>
            state.trendLibrary.items.some((item) => item.id === ref.trendId),
          ),
          '所选趋势资料不存在',
        );
      }
      if (patch.modelRefId)
        ensure(findMaterial(state, patch.modelRefId).kind === 'model', '请选择模特素材');
      if (patch.brandRefId) {
        const legacyBrand = findMaterial(state, patch.brandRefId);
        if (legacyBrand.kind === 'pattern' && patch.patternRefId === undefined) {
          patch.patternRefId = legacyBrand.id;
          patch.brandRefId = null;
        } else ensure(legacyBrand.kind === 'logo', '请选择 Logo 素材');
      }
      if (patch.patternRefId)
        ensure(findMaterial(state, patch.patternRefId).kind === 'pattern', '请选择图案素材');
      if (patch.fabricRefId)
        ensure(findMaterial(state, patch.fabricRefId).kind === 'fabric', '请选择面料素材');
      if (patch.backgroundRefId)
        ensure(findMaterial(state, patch.backgroundRefId).kind === 'custom', '请选择背景参考素材');
      if (patch.customRefIds) {
        ensure(
          new Set(patch.customRefIds).size === patch.customRefIds.length,
          '自定义参考素材不能重复',
        );
        ensure(
          patch.customRefIds.every((itemId) => findMaterial(state, itemId).kind === 'custom'),
          '自定义参考素材类型无效',
        );
      }
      if (
        Object.keys(patch).some(
          (k) =>
            ['logoMethod', 'logoScale', 'autoInvert', 'keepIdentity', 'logoHarmony'].includes(k) &&
            patch[k] !== p[k],
        )
      )
        p.confirmed = false;
      Object.assign(p, patch);
      syncProjectRefs(state, p);
      changed(p);
      return p;
    });
  }
  deleteProject(id) {
    return this.store.transaction((state) => {
      findProject(state, id);
      idle(state, id);
      state.projects = state.projects.filter((p) => p.id !== id);
      // Files and task history are retained for recovery, not unlinked by project deletion.
      return { deleted: id };
    });
  }
  deleteLooks(projectId, input) {
    const { lookIds } = lookDeleteInput.parse(input);
    return this.store.transaction((state) => {
      const project = findProject(state, projectId);
      idle(state, projectId);
      ensure(new Set(lookIds).size === lookIds.length, '成片不能重复选择');
      const removed = project.archivedLooks.filter((look) => lookIds.includes(look.id));
      ensure(removed.length === lookIds.length, '请先归档所选成片后再删除', 409);
      project.history.push({
        createdAt: now(),
        looks: structuredClone(removed),
        reason: '从归档删除成片',
      });
      project.archivedLooks = project.archivedLooks.filter((look) => !lookIds.includes(look.id));
      changed(project);
      // Generated assets and task snapshots remain available through history and task records.
      return {
        deleted: lookIds,
        retainedAssets: removed.flatMap((look) => [look.scene, look.white]).filter(Boolean),
      };
    });
  }
  lookAction(projectId, input, action) {
    ensure(['archive', 'restore'].includes(action), '成片操作无效');
    const { lookIds } = lookDeleteInput.parse(input);
    return this.store.transaction((state) => {
      const project = findProject(state, projectId);
      idle(state, projectId);
      ensure(new Set(lookIds).size === lookIds.length, '成片不能重复选择');
      const source = action === 'archive' ? project.looks : project.archivedLooks;
      const moving = source.filter((look) => lookIds.includes(look.id));
      ensure(moving.length === lookIds.length, '所选成片不存在', 404);
      if (action === 'archive') {
        const archivedAt = now();
        project.looks = project.looks.filter((look) => !lookIds.includes(look.id));
        project.archivedLooks.unshift(
          ...moving.map((look) => ({ ...structuredClone(look), archivedAt })),
        );
      } else {
        project.archivedLooks = project.archivedLooks.filter((look) => !lookIds.includes(look.id));
        project.looks.push(
          ...moving.map((look) => {
            const restored = structuredClone(look);
            delete restored.archivedAt;
            return restored;
          }),
        );
        project.looks.sort((a, b) => (a.slot || 0) - (b.slot || 0));
      }
      changed(project);
      return { action, lookIds };
    });
  }
  group(action, name) {
    ensure(['add', 'delete'].includes(action), '分组操作无效');
    ensure(typeof name === 'string' && name.trim() && name.length <= 80, '分组名称无效');
    name = name.trim();
    return this.store.transaction((state) => {
      if (action === 'add') {
        if (!state.groups.includes(name)) state.groups.push(name);
      } else {
        ensure(state.groups.includes(name) && state.groups.length > 1, '至少保留一个分组');
        const fallback = state.groups.find((g) => g !== name);
        state.projects
          .filter((p) => p.group === name)
          .forEach((p) => {
            idle(state, p.id);
            p.group = fallback;
            changed(p);
          });
        state.groups = state.groups.filter((g) => g !== name);
      }
      return state.groups;
    });
  }
  async validateFile(buffer, filename, kind) {
    ensure(Buffer.isBuffer(buffer) && buffer.length > 0, '文件不能为空');
    if (kind === 'report' || (kind === 'trend' && buffer.subarray(0, 5).toString() === '%PDF-')) {
      ensure(buffer.subarray(0, 5).toString() === '%PDF-', '请上传有效的 PDF 文件');
      const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const loading = getDocument({
        data: new Uint8Array(buffer),
        useSystemFonts: true,
        isEvalSupported: false,
      });
      const doc = await loading.promise;
      const pageCount = doc.numPages;
      await loading.destroy();
      return {
        ...this.registerBuffer(buffer, filename, 'application/pdf'),
        pageCount,
        sourceType: 'pdf',
      };
    }
    try {
      const image = sharp(buffer, { limitInputPixels: 40_000_000, animated: false });
      const metadata = await image.metadata();
      ensure(
        ['jpeg', 'png', 'webp', 'svg', 'heif', 'tiff'].includes(metadata.format),
        '不支持的图片格式',
      );
      const normalized = await image.rotate().png().toBuffer();
      const dimensions = await sharp(normalized).metadata();
      return {
        ...this.registerBuffer(normalized, filename.replace(/\.[^.]+$/, '') + '.png', 'image/png'),
        width: dimensions.width,
        height: dimensions.height,
        sourceType: 'image',
      };
    } catch (error) {
      ensure(false, `图片无法读取：${error.message}`);
    }
  }
  async uploadTrend(buffer, filename, input = {}) {
    const meta = libraryMetaInput.parse(input);
    const asset = await this.validateFile(buffer, filename, 'trend');
    let cover = null;
    if (asset.sourceType === 'pdf') {
      const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const { createCanvas } = await import('@napi-rs/canvas');
      const loading = getDocument({
        data: new Uint8Array(buffer),
        useSystemFonts: true,
        isEvalSupported: false,
      });
      try {
        const document = await loading.promise;
        const page = await document.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({
          scale: Math.min(1.5, 900 / Math.max(base.width, base.height)),
        });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        cover = this.registerBuffer(
          canvas.toBuffer('image/png'),
          `${filename}-cover.png`,
          'image/png',
        );
      } finally {
        await loading.destroy();
      }
    }
    const original =
      asset.sourceType === 'image'
        ? this.registerBuffer(buffer, filename, 'application/octet-stream')
        : null;
    if (original) asset.originalId = original.id;
    return this.store.transaction((state) => {
      const createdAt = now();
      if (original) state.assets[original.id] = original;
      if (cover) state.assets[cover.id] = cover;
      state.assets[asset.id] = asset;
      const item = {
        id: randomUUID(),
        assetId: asset.id,
        coverAssetId: asset.sourceType === 'image' ? asset.id : cover.id,
        sourceType: asset.sourceType,
        title: meta.title || filename.replace(/\.[^.]+$/, ''),
        group: meta.group || '未分组',
        tags: [...new Set(meta.tags || [])],
        status: 'pending',
        analysis: null,
        analysisHistory: [],
        revision: 0,
        createdAt,
        updatedAt: createdAt,
        archivedAt: null,
      };
      if (!state.trendLibrary.groups.includes(item.group))
        state.trendLibrary.groups.push(item.group);
      state.trendLibrary.items.unshift(item);
      const task = newTrendAnalysisTask(item);
      task.message = '文件已上传，可在卡片中开始解析';
      state.tasks.unshift(task);
      return { item, task: { ...task, snapshot: undefined } };
    });
  }
  createTrendAnalysisTask(id) {
    return this.store.transaction((state) => {
      trendIdle(state, id);
      const item = findTrend(state, id);
      ensure(!item.archivedAt, '请先恢复趋势资料再解析', 409);
      const task = newTrendAnalysisTask(item);
      item.status = 'pending';
      item.updatedAt = task.createdAt;
      state.tasks.unshift(task);
      return { ...task, snapshot: undefined };
    });
  }
  async uploadMaterial(kind, buffer, filename, input = {}) {
    kind = materialKind.parse(kind);
    const meta = libraryMetaInput.parse(input);
    const asset = await this.validateFile(buffer, filename, 'image');
    const original = this.registerBuffer(buffer, filename, 'application/octet-stream');
    asset.originalId = original.id;
    return this.store.transaction((state) => {
      state.assets[original.id] = original;
      state.assets[asset.id] = asset;
      const item = {
        id: randomUUID(),
        assetId: asset.id,
        kind,
        title: meta.title || filename.replace(/\.[^.]+$/, ''),
        group: meta.group || '未分组',
        tags: [...new Set(meta.tags || [])],
        revision: 0,
        createdAt: now(),
        updatedAt: now(),
        archivedAt: null,
      };
      if (!state.materialLibrary.groups.includes(item.group))
        state.materialLibrary.groups.push(item.group);
      state.materialLibrary.items.unshift(item);
      return item;
    });
  }
  async cropMaterial(id, input) {
    const crop = materialCropInput.parse(input);
    const current = findMaterial(this.store.state, id);
    ensure(crop.expectedRevision === (current.revision || 0), '素材卡片已更新，请刷新后重试', 409);
    const source = this.store.state.assets[current.assetId];
    ensure(source?.mime?.startsWith('image/'), '素材图片不存在');
    const image = sharp(this.assetPath(source.id), { limitInputPixels: 40_000_000 });
    const metadata = await image.metadata();
    ensure(metadata.width && metadata.height, '无法读取素材尺寸');
    let left, top, width, height;
    if (crop.cropRect) {
      left = Math.min(metadata.width - 1, Math.round(metadata.width * crop.cropRect.left));
      top = Math.min(metadata.height - 1, Math.round(metadata.height * crop.cropRect.top));
      width = Math.max(
        1,
        Math.min(metadata.width - left, Math.round(metadata.width * crop.cropRect.width)),
      );
      height = Math.max(
        1,
        Math.min(metadata.height - top, Math.round(metadata.height * crop.cropRect.height)),
      );
    } else {
      const ratios = { '1:1': 1, '3:4': 3 / 4, '4:5': 4 / 5, '16:9': 16 / 9 };
      const ratio =
        crop.aspect === 'original' ? metadata.width / metadata.height : ratios[crop.aspect];
      let baseWidth = metadata.width;
      let baseHeight = baseWidth / ratio;
      if (baseHeight > metadata.height) {
        baseHeight = metadata.height;
        baseWidth = baseHeight * ratio;
      }
      width = Math.max(1, Math.min(metadata.width, Math.round(baseWidth / crop.zoom)));
      height = Math.max(1, Math.min(metadata.height, Math.round(baseHeight / crop.zoom)));
      left = Math.round(((metadata.width - width) * (crop.x + 100)) / 200);
      top = Math.round(((metadata.height - height) * (crop.y + 100)) / 200);
    }
    const buffer = await image.extract({ left, top, width, height }).png().toBuffer();
    const asset = this.registerBuffer(buffer, `${current.title}-crop.png`, 'image/png');
    asset.originalId = source.originalId || current.sourceAssetId || source.id;
    return this.store.transaction((state) => {
      const item = findMaterial(state, id);
      ensure(crop.expectedRevision === (item.revision || 0), '素材卡片已更新，请刷新后重试', 409);
      state.assets[asset.id] = asset;
      item.sourceAssetId ||= item.assetId;
      item.cropHistory ||= [];
      item.cropHistory.push({ assetId: item.assetId, crop: item.crop || null, createdAt: now() });
      item.assetId = asset.id;
      item.crop = { ...crop, width, height };
      item.revision = (item.revision || 0) + 1;
      item.updatedAt = now();
      for (const project of state.projects.filter(
        (project) =>
          project.modelRefId === id ||
          project.brandRefId === id ||
          project.patternRefId === id ||
          project.fabricRefId === id,
      ))
        syncProjectRefs(state, project);
      return item;
    });
  }
  resetMaterialCrop(id, input) {
    const { expectedRevision } = materialCropResetInput.parse(input);
    return this.store.transaction((state) => {
      const item = findMaterial(state, id);
      ensure(expectedRevision === (item.revision || 0), '素材卡片已更新，请刷新后重试', 409);
      ensure(item.sourceAssetId, '当前素材没有可恢复的原图');
      item.cropHistory ||= [];
      item.cropHistory.push({ assetId: item.assetId, crop: item.crop || null, createdAt: now() });
      item.assetId = item.sourceAssetId;
      item.crop = null;
      item.revision = (item.revision || 0) + 1;
      item.updatedAt = now();
      for (const project of state.projects.filter(
        (project) =>
          project.modelRefId === id ||
          project.brandRefId === id ||
          project.patternRefId === id ||
          project.fabricRefId === id,
      ))
        syncProjectRefs(state, project);
      return item;
    });
  }
  updateLibraryItem(library, id, input) {
    ensure(['trend', 'material'].includes(library), '资料库类型无效');
    const meta = libraryMetaPatch.parse(input);
    return this.store.transaction((state) => {
      const root = library === 'trend' ? state.trendLibrary : state.materialLibrary;
      const item = library === 'trend' ? findTrend(state, id) : findMaterial(state, id);
      if (library === 'trend') trendIdle(state, id);
      if (meta.group && !root.groups.includes(meta.group)) root.groups.push(meta.group);
      Object.assign(item, meta);
      if (meta.tags) item.tags = [...new Set(meta.tags)];
      item.revision = (item.revision || 0) + 1;
      item.updatedAt = now();
      return item;
    });
  }
  updateTrendAnalysis(id, { analysis, expectedRevision }) {
    const parsed = analysisInput.parse(analysis);
    return this.store.transaction((state) => {
      const item = findTrend(state, id);
      trendIdle(state, id);
      ensure(item.analysis, '趋势资料尚未完成提炼');
      ensure(expectedRevision === (item.revision || 0), '趋势卡片已更新，请刷新后重试', 409);
      ensure(
        JSON.stringify(parsed.evidence) === JSON.stringify(item.analysis.evidence),
        '原始依据不可改写',
      );
      item.analysisHistory.push(item.analysis);
      item.analysis = { ...item.analysis, ...parsed, editedAt: now(), editedBy: 'user' };
      item.title = parsed.theme;
      item.tags = [...new Set([...item.tags, ...parsed.keywords])].slice(0, 20);
      item.revision = (item.revision || 0) + 1;
      item.updatedAt = now();
      for (const project of state.projects.filter((p) =>
        p.trendRefs?.some((ref) => ref.trendId === id),
      ))
        syncProjectRefs(state, project);
      return item;
    });
  }
  libraryAction(library, id, action) {
    ensure(['trend', 'material'].includes(library), '资料库类型无效');
    ensure(['archive', 'restore'].includes(action), '资料操作无效');
    return this.store.transaction((state) => {
      const item = library === 'trend' ? findTrend(state, id) : findMaterial(state, id);
      item.archivedAt = action === 'archive' ? now() : null;
      item.updatedAt = now();
      return item;
    });
  }
  deleteTrend(id) {
    return this.store.transaction((state) => {
      const item = findTrend(state, id);
      ensure(item.archivedAt, '请先归档趋势资料后再删除', 409);
      trendIdle(state, id);
      const references = state.projects.filter((project) =>
        project.trendRefs?.some((reference) => reference.trendId === id),
      );
      ensure(
        references.length === 0,
        `该趋势正被 ${references.length} 个项目使用，请先在系列工作台更换或移除引用`,
        409,
      );
      state.trendLibrary.items = state.trendLibrary.items.filter((trend) => trend.id !== id);
      const deletedAt = now();
      state.tasks
        .filter((task) => task.trendId === id)
        .forEach((task) => {
          task.sourceDeletedAt = deletedAt;
        });
      // Original files and completed task snapshots are intentionally retained for recovery.
      return {
        deleted: id,
        retainedAssets: [item.assetId, item.coverAssetId].filter(Boolean),
      };
    });
  }
  async upload(projectId, kind, buffer, filename) {
    ensure(['report', 'model', 'logo'].includes(kind), '素材类型无效');
    findProject(this.store.state, projectId);
    idle(this.store.state, projectId);
    const asset = await this.validateFile(buffer, filename, kind);
    const original =
      kind === 'report' ? null : this.registerBuffer(buffer, filename, 'application/octet-stream');
    if (original) asset.originalId = original.id;
    return this.store.transaction((state) => {
      const p = findProject(state, projectId);
      idle(state, projectId);
      if (original) state.assets[original.id] = original;
      state.assets[asset.id] = asset;
      p.assets[kind] = asset.id;
      if (kind === 'report') {
        if (p.analysis) (p.analysisHistory ||= []).push(p.analysis);
        p.analysis = null;
        const item = {
          id: randomUUID(),
          assetId: asset.id,
          coverAssetId: null,
          sourceType: 'pdf',
          title: filename.replace(/\.[^.]+$/, ''),
          group: p.group,
          tags: [],
          status: 'uploaded',
          analysis: null,
          analysisHistory: [],
          revision: 0,
          createdAt: now(),
          updatedAt: now(),
          archivedAt: null,
        };
        state.trendLibrary.items.unshift(item);
        p.trendRefs = [{ trendId: item.id, role: 'primary' }];
      } else p.confirmed = false;
      if (kind !== 'report') {
        const item = {
          id: randomUUID(),
          assetId: asset.id,
          kind,
          title: filename.replace(/\.[^.]+$/, ''),
          group: p.group,
          tags: [],
          revision: 0,
          createdAt: now(),
          updatedAt: now(),
          archivedAt: null,
        };
        state.materialLibrary.items.unshift(item);
        if (kind === 'model') p.modelRefId = item.id;
        else if (kind === 'logo') p.brandRefId = item.id;
        else if (kind === 'pattern') p.patternRefId = item.id;
        else if (kind === 'fabric') p.fabricRefId = item.id;
      }
      syncProjectRefs(state, p);
      changed(p);
      return p;
    });
  }
  async uploadRefinementReferences(projectId, files) {
    findProject(this.store.state, projectId);
    ensure(Array.isArray(files) && files.length > 0, '请选择至少一张参考图');
    const assets = await Promise.all(
      files.map((file) => this.validateFile(file.buffer, file.filename, 'image')),
    );
    return this.store.transaction((state) => {
      findProject(state, projectId);
      for (const asset of assets) state.assets[asset.id] = asset;
      return { assets };
    });
  }
  setLookPrimary(projectId, lookId, input) {
    const { assetId } = lookPrimaryInput.parse(input);
    return this.store.transaction((state) => {
      const project = findProject(state, projectId);
      const look = project.looks.find((item) => item.id === lookId);
      ensure(look, '成片不存在', 404);
      ensure(!(look.editLayers || []).length, '请先合并或清空待确认图层后再切换历史版本', 409);
      ensure(
        !state.tasks.some(
          (task) =>
            task.projectId === projectId &&
            active(task) &&
            ['white', 'refine', 'restyle'].includes(task.kind) &&
            task.lookIds.includes(lookId),
        ),
        '成片正在处理，请等待任务完成后切换主图',
        409,
      );
      if (look.scene === assetId) return look;
      look.originalScene ||= look.versions?.[0]?.scene || look.scene;
      const index = (look.versions || []).map((version) => version.scene).lastIndexOf(assetId);
      const selectingOriginal = assetId === look.originalScene;
      ensure(index >= 0 || selectingOriginal, '所选版本不存在', 404);
      const selected =
        index >= 0
          ? look.versions.splice(index, 1)[0]
          : {
              scene: look.originalScene,
              white: null,
              editLayer: null,
              instruction: '未改原图',
            };
      look.versions.push({
        scene: look.scene,
        white: look.white,
        editLayer: look.editLayer || null,
        instruction: look.detail || '当前主图',
        taskId: look.taskId,
        createdAt: now(),
      });
      look.scene = selected.scene;
      look.white = selected.white || null;
      look.editLayer = selected.editLayer || null;
      look.detail = selected.instruction || '';
      look.adjusted = look.scene !== look.originalScene;
      changed(project);
      return look;
    });
  }
  async composeLookLayers(baseAssetId, layers) {
    const base = this.store.state.assets[baseAssetId];
    ensure(base?.mime?.startsWith('image/'), '图层底图不存在');
    const metadata = await sharp(this.assetPath(baseAssetId)).metadata();
    const inputs = [];
    for (const layer of [...layers].reverse().filter((item) => item.visible && item.opacity > 0)) {
      const asset = this.store.state.assets[layer.assetId];
      ensure(asset?.mime?.startsWith('image/'), '局部图层不存在');
      ensure(
        asset.width === metadata.width && asset.height === metadata.height,
        '局部图层尺寸与底图不一致',
      );
      let input = readFileSync(this.assetPath(layer.assetId));
      if (layer.opacity < 1)
        input = await sharp(input)
          .ensureAlpha()
          .linear([1, 1, 1, layer.opacity], [0, 0, 0, 0])
          .png()
          .toBuffer();
      inputs.push({ input });
    }
    if (!inputs.length) return readFileSync(this.assetPath(baseAssetId));
    return sharp(this.assetPath(baseAssetId)).composite(inputs).png().toBuffer();
  }
  normalizeLookLayers(look, input) {
    const parsed = lookLayerStackInput.parse(input);
    const existing = new Map((look.editLayers || []).map((layer) => [layer.id, layer]));
    return parsed.layers.map((item) => {
      const layer = existing.get(item.id);
      ensure(layer, '待确认图层已变化，请刷新后重试', 409);
      return { ...structuredClone(layer), ...item };
    });
  }
  async updateLookLayers(projectId, lookId, input) {
    const project = findProject(this.store.state, projectId);
    const look = project.looks.find((item) => item.id === lookId);
    ensure(look, '成片不存在', 404);
    ensure(
      !(this.store.state.tasks || []).some(
        (task) => active(task) && task.lookIds?.includes(lookId),
      ),
      '成片正在处理，请等待任务完成后调整图层',
      409,
    );
    ensure((look.editLayers || []).length, '当前成片没有待确认图层');
    const signature = (look.editLayers || []).map((layer) => layer.id).join('|');
    const baseAssetId = look.layerBaseScene || look.scene;
    const layers = this.normalizeLookLayers(look, input);
    const visible = layers.filter((layer) => layer.visible && layer.opacity > 0);
    const buffer = visible.length ? await this.composeLookLayers(baseAssetId, layers) : null;
    const preview = buffer
      ? await this.validateFile(buffer, `${look.title}-layer-preview.png`, 'image')
      : null;
    return this.store.transaction((state) => {
      const currentProject = findProject(state, projectId);
      const current = currentProject.looks.find((item) => item.id === lookId);
      ensure(current, '成片不存在', 404);
      ensure(
        (current.editLayers || []).map((layer) => layer.id).join('|') === signature &&
          (current.layerBaseScene || current.scene) === baseAssetId,
        '图层已在另一处更新，请刷新后重试',
        409,
      );
      if (preview) state.assets[preview.id] = preview;
      current.editLayers = layers;
      current.scene = preview?.id || baseAssetId;
      current.editLayer = layers.find((layer) => layer.visible && layer.opacity > 0) || null;
      if (!layers.length) {
        current.layerHistory ||= [];
        current.layerHistory.push({
          id: randomUUID(),
          action: 'discard',
          baseScene: baseAssetId,
          layers: structuredClone(look.editLayers),
          createdAt: now(),
        });
        current.layerBaseScene = null;
        current.editLayer = null;
      }
      changed(currentProject);
      return current;
    });
  }
  async mergeLookLayers(projectId, lookId, input) {
    const project = findProject(this.store.state, projectId);
    const look = project.looks.find((item) => item.id === lookId);
    ensure(look, '成片不存在', 404);
    ensure(
      !(this.store.state.tasks || []).some(
        (task) => active(task) && task.lookIds?.includes(lookId),
      ),
      '成片正在处理，请等待任务完成后合并图层',
      409,
    );
    ensure((look.editLayers || []).length, '当前成片没有待确认图层');
    const signature = (look.editLayers || []).map((layer) => layer.id).join('|');
    const baseAssetId = look.layerBaseScene || look.scene;
    const layers = this.normalizeLookLayers(look, input);
    const selected = layers.filter((layer) => layer.visible && layer.opacity > 0);
    ensure(selected.length, '请至少勾选一个需要合并的图层');
    const buffer = await this.composeLookLayers(baseAssetId, layers);
    const merged = await this.validateFile(buffer, `${look.title}-merged.png`, 'image');
    return this.store.transaction((state) => {
      const currentProject = findProject(state, projectId);
      const current = currentProject.looks.find((item) => item.id === lookId);
      ensure(current, '成片不存在', 404);
      ensure(
        (current.editLayers || []).map((layer) => layer.id).join('|') === signature &&
          (current.layerBaseScene || current.scene) === baseAssetId,
        '图层已在另一处更新，请刷新后重试',
        409,
      );
      state.assets[merged.id] = merged;
      current.originalScene ||= current.versions?.[0]?.scene || baseAssetId;
      current.versions ||= [];
      if (!current.versions.some((version) => version.scene === baseAssetId))
        current.versions.push({
          scene: baseAssetId,
          white: current.white,
          editLayer: null,
          instruction: current.detail || '图层合并前主图',
          taskId: current.taskId,
          createdAt: now(),
        });
      current.layerHistory ||= [];
      current.layerHistory.push({
        id: randomUUID(),
        action: 'merge',
        baseScene: baseAssetId,
        resultScene: merged.id,
        layers: structuredClone(layers),
        createdAt: now(),
      });
      current.scene = merged.id;
      current.white = null;
      current.editLayers = [];
      current.layerBaseScene = null;
      current.editLayer = null;
      current.adjusted = true;
      current.detail = `已合并图层：${selected.map((layer) => layer.name).join('、')}`;
      changed(currentProject);
      return current;
    });
  }
  deleteLookLayerHistory(projectId, lookId, historyId) {
    return this.store.transaction((state) => {
      const project = findProject(state, projectId);
      const look = project.looks.find((item) => item.id === lookId);
      ensure(look, '成片不存在', 404);
      const history = look.layerHistory || [];
      ensure(
        history.some((entry) => entry.id === historyId),
        '图层历史不存在',
        404,
      );
      look.layerHistory = history.filter((entry) => entry.id !== historyId);
      changed(project);
      return look;
    });
  }
  confirm(projectId) {
    return this.store.transaction((state) => {
      const p = findProject(state, projectId);
      idle(state, projectId);
      p.confirmed = true;
      changed(p);
      return p;
    });
  }
  updateAnalysis(projectId, { analysis, expectedRevision }) {
    const parsed = analysisInput.parse(analysis);
    return this.store.transaction((state) => {
      const p = findProject(state, projectId);
      idle(state, projectId);
      ensure(p.analysis, '请先完成报告解析');
      ensure(expectedRevision === (p.revision || 0), '项目已更新，请刷新后再编辑', 409);
      // User edits change the design direction, never rewrite evidence from the source report.
      ensure(
        JSON.stringify(parsed.evidence) === JSON.stringify(p.analysis.evidence),
        '报告依据不可改写',
      );
      (p.analysisHistory ||= []).push(p.analysis);
      p.analysis = { ...p.analysis, ...parsed, editedAt: now(), editedBy: 'user' };
      changed(p);
      return p;
    });
  }
  createTask(projectId, input) {
    const parsed = taskInput.parse(input);
    return this.store.transaction((state) => {
      const p = findProject(state, projectId);
      syncProjectRefs(state, p);
      if (parsed.kind === 'analysis') ensure(p.assets.report, '请先上传趋势报告');
      if (parsed.kind === 'series') {
        ensure(
          p.trendRefs.length && p.trendRefs.some((ref) => ref.role === 'primary'),
          '请选择一个已解析的主趋势',
        );
        ensure(
          p.trendRefs.filter((ref) => ref.role === 'primary').length === 1,
          '只能选择一个主趋势',
        );
        const trends = p.trendRefs.map((ref) => ({
          ...structuredClone(findTrend(state, ref.trendId)),
          role: ref.role,
        }));
        ensure(
          trends.every((item) => item.status === 'ready' && item.analysis),
          '所选趋势资料仍在提炼或不可用',
        );
        ensure(p.prompt.trim(), '请填写系列描述');
      }
      if (['white', 'refine', 'restyle', 'viral'].includes(parsed.kind) && parsed.lookIds.length) {
        ensure(
          parsed.lookIds.length > 0 && new Set(parsed.lookIds).size === parsed.lookIds.length,
          '请选择不重复的成片',
        );
        ensure(
          parsed.lookIds.every((id) => p.looks.some((l) => l.id === id && l.scene)),
          '所选成片不存在',
        );
        if (['refine', 'restyle'].includes(parsed.kind))
          ensure(
            parsed.lookIds.length === 1 && parsed.instruction.trim(),
            '改款或精修需要一张图片和调整说明',
          );
        for (const lookId of parsed.lookIds) {
          const look = p.looks.find((item) => item.id === lookId);
          if ((look?.editLayers || []).length)
            ensure(
              parsed.kind === 'restyle' &&
                parsed.annotations.some((annotation) => annotation.mode === 'adjust') &&
                parsed.background !== 'white',
              '当前成片有待确认图层，请先在图层面板合并或清空后继续',
              409,
            );
        }
      }
      if (parsed.kind === 'restyle') {
        ensure(parsed.instruction.trim(), '请描述想如何调整款式');
        ensure(
          (parsed.lookIds.length === 1) !== Boolean(parsed.sourceAssetId),
          '请选择一张已生成图或上传一张原图',
        );
      }
      if (parsed.kind === 'refine')
        ensure(
          parsed.lookIds.length === 1 && parsed.instruction.trim(),
          '精修需要一张图片和调整说明',
        );
      if (parsed.kind === 'viral') {
        ensure(
          (parsed.lookIds.length === 1) !== Boolean(parsed.sourceAssetId),
          '请选择一张已生成成片或上传一张爆款原图',
        );
        ensure(parsed.instruction.trim(), '请描述裂变方向');
      }
      if (parsed.sourceAssetId)
        ensure(state.assets[parsed.sourceAssetId]?.mime?.startsWith('image/'), '任务原图不存在');
      ensure(
        parsed.referenceAssetIds.every((id) => state.assets[id]?.mime?.startsWith('image/')),
        '参考图不存在或格式无效',
      );
      if (!['refine', 'restyle', 'viral'].includes(parsed.kind))
        ensure(parsed.referenceAssetIds.length === 0, '该任务不支持附加参考图');
      ensureTaskCompatible(state, p, parsed);
      const total =
        parsed.kind === 'series'
          ? parsed.channel === 'chat'
            ? parsed.count
            : p.lookCount
          : parsed.kind === 'viral'
            ? parsed.count
            : parsed.kind === 'analysis'
              ? 1
              : parsed.kind === 'restyle'
                ? 1
                : parsed.lookIds.length;
      const task = {
        ...parsed,
        id: randomUUID(),
        projectId,
        projectName: p.name,
        total,
        status: 'pending',
        message: '任务已创建，正在准备执行',
        results: [],
        plan: [],
        snapshot: {
          ...structuredClone(p),
          memoryContext: memoryContextFor(state, p.id),
          trendItems: p.trendRefs.map((ref) => ({
            ...structuredClone(findTrend(state, ref.trendId)),
            role: ref.role,
          })),
          modelItem: p.modelRefId ? structuredClone(findMaterial(state, p.modelRefId)) : null,
          brandItem: p.brandRefId ? structuredClone(findMaterial(state, p.brandRefId)) : null,
          patternItem: p.patternRefId ? structuredClone(findMaterial(state, p.patternRefId)) : null,
          fabricItem: p.fabricRefId ? structuredClone(findMaterial(state, p.fabricRefId)) : null,
          backgroundItem: p.backgroundRefId
            ? structuredClone(findMaterial(state, p.backgroundRefId))
            : null,
          customItems: (p.customRefIds || []).map((itemId) =>
            structuredClone(findMaterial(state, itemId)),
          ),
        },
        createdAt: now(),
        updatedAt: now(),
        attempts: 0,
      };
      if (
        parsed.kind === 'restyle' &&
        parsed.layerMode &&
        parsed.annotations.some((annotation) => annotation.mode === 'adjust') &&
        parsed.background !== 'white'
      ) {
        const look = parsed.lookIds.length
          ? p.looks.find((item) => item.id === parsed.lookIds[0])
          : null;
        task.layerBaseAssetId = parsed.sourceAssetId || look?.layerBaseScene || look?.scene || null;
      }
      if (
        ['series', 'viral'].includes(parsed.kind) ||
        (parsed.kind === 'restyle' && !parsed.lookIds.length)
      ) {
        task.slotOffset = Math.max(p.nextLookSlot || 1, maxLookSlot(p) + 1) - 1;
        p.nextLookSlot = task.slotOffset + total + 1;
      }
      state.tasks.unshift(task);
      return task;
    });
  }
  taskContext(id) {
    const t = structuredClone(findTask(this.store.state, id));
    delete t.claim;
    const p = t.snapshot;
    const files = {};
    const add = (label, id) => {
      if (id)
        files[label] = {
          ...this.store.state.assets[id],
          path: this.assetPath(id),
          url: assetUrl(id),
        };
    };
    if (t.kind === 'analysis' && p.trend) {
      add('trend', p.trend.assetId);
    } else {
      Object.entries(p.assets || {}).forEach(([role, id]) => add(role, id));
      if (p.modelItem) add('model', p.modelItem.assetId);
      if (p.brandItem) add('brand', p.brandItem.assetId);
      if (p.patternItem) add('pattern', p.patternItem.assetId);
      if (p.fabricItem) add('fabric', p.fabricItem.assetId);
      if (p.backgroundItem) add('background', p.backgroundItem.assetId);
      for (const [index, item] of (p.customItems || []).entries())
        add(`custom:${index + 1}`, item.assetId);
      for (const trend of p.trendItems || []) add(`trend:${trend.id}`, trend.assetId);
    }
    if (t.sourceAssetId) add('source', t.sourceAssetId);
    for (const look of (p.looks || []).filter((l) => t.lookIds.includes(l.id))) {
      add(`scene:${look.id}`, t.layerBaseAssetId || look.scene);
      if (look.white) add(`white:${look.id}`, look.white);
    }
    for (const [index, assetId] of (t.referenceAssetIds || []).entries())
      add(`reference:${index + 1}`, assetId);
    return {
      ...t,
      files,
      remainingSlots: Array.from({ length: t.total }, (_, i) => i + 1).filter(
        (slot) => !t.results.some((r) => r.slot === slot),
      ),
    };
  }
  claim(id) {
    return this.store.transaction((state) => {
      const task = findTask(state, id);
      ensure(task.status === 'pending', '任务已被领取或不再待执行', 409);
      task.status = 'running';
      task.claim = randomUUID();
      task.attempts += 1;
      task.updatedAt = now();
      task.message = 'AI 正在处理';
      if (task.trendId) findTrend(state, task.trendId).status = 'running';
      return { taskId: id, claim: task.claim };
    });
  }
  running(state, id, claim) {
    const t = findTask(state, id);
    ensure(
      t.status === 'running' && claim && t.claim === claim,
      '任务已结束、未领取或执行凭证已失效',
      409,
    );
    if (t.projectId) findProject(state, t.projectId);
    else findTrend(state, t.trendId);
    return t;
  }
  submitAnalysis(id, claim, input) {
    const analysis = analysisInput.parse(input);
    return this.store.transaction((state) => {
      const t = this.running(state, id, claim);
      ensure(t.kind === 'analysis', '任务不是趋势解析');
      const sourceId = t.snapshot.trend?.assetId || t.snapshot.assets?.report;
      const count = state.assets[sourceId].pageCount;
      if (count)
        ensure(
          analysis.evidence.every((e) => e.page && e.page <= count),
          '引用页码超出报告页数',
        );
      else
        ensure(
          analysis.evidence.every((e) => !e.page || e.page === 1),
          '图片趋势依据页码无效',
        );
      t.analysis = analysis;
      t.results = [{ slot: 1, type: 'analysis' }];
      t.updatedAt = now();
      return { accepted: true, remaining: 0 };
    });
  }
  submitPlan(id, claim, input) {
    const plan = planInput.parse(input);
    return this.store.transaction((state) => {
      const t = this.running(state, id, claim);
      ensure(['series', 'viral'].includes(t.kind), '仅系列生成或爆款裂变需要造型计划');
      ensure(
        plan.length === t.total &&
          new Set(plan.map((p) => p.slot)).size === t.total &&
          plan.every((p) => p.slot <= t.total),
        '计划必须覆盖每个造型且不能重复',
      );
      ensure(!t.results.length, '已有成片，不能覆盖生成计划');
      t.plan = plan;
      return plan;
    });
  }
  async submitImage(id, claim, slot, buffer, filename, options = {}) {
    const task = this.running(this.store.state, id, claim);
    ensure(task.kind !== 'analysis', '解析任务不接收图片');
    ensure(Number.isInteger(slot) && slot >= 1 && slot <= task.total, '造型序号无效');
    ensure(!task.results.some((r) => r.slot === slot), '该造型已提交，结果不会重复覆盖', 409);
    if (['series', 'viral'].includes(task.kind))
      ensure(task.plan.length === task.total, '先提交完整造型设计计划');
    const asset = await this.validateFile(buffer, filename, 'image');
    const layerInput = options?.editLayer;
    ensure(!layerInput || task.kind === 'restyle', '只有改款任务可以提交局部图层');
    const layerAsset = layerInput
      ? await this.validateFile(
          layerInput.buffer,
          layerInput.filename || 'RESTYLE_LAYER.png',
          'image',
        )
      : null;
    let layerMeta = null;
    if (layerAsset) {
      const sourceAssetId =
        task.layerBaseAssetId ||
        task.sourceAssetId ||
        task.snapshot.looks.find((look) => look.id === task.lookIds[slot - 1])?.scene;
      const source = this.store.state.assets[sourceAssetId];
      const bounds = layerInput.bounds;
      ensure(source && bounds, '局部图层缺少原图或位置');
      ensure(
        [bounds.left, bounds.top, bounds.width, bounds.height].every(Number.isInteger) &&
          bounds.left >= 0 &&
          bounds.top >= 0 &&
          bounds.width > 0 &&
          bounds.height > 0 &&
          bounds.left + bounds.width <= source.width &&
          bounds.top + bounds.height <= source.height,
        '局部图层位置超出原图范围',
      );
      ensure(
        layerAsset.width === source.width && layerAsset.height === source.height,
        '局部图层尺寸必须与原图一致',
      );
      layerMeta = { assetId: layerAsset.id, sourceAssetId, bounds: structuredClone(bounds) };
    }
    const sourceIds = [
      ...new Set(
        [
          ...Object.values(task.snapshot.assets),
          ...(task.snapshot.trendItems || []).map((item) => item.assetId),
          ...(task.snapshot.customItems || []).map((item) => item.assetId),
          ...task.snapshot.looks.flatMap((look) => [look.scene, look.white]),
          task.sourceAssetId,
          task.layerBaseAssetId,
          ...(task.referenceAssetIds || []),
          ...task.results.map((r) => r.assetId),
        ].filter((id) => id && this.store.state.assets[id]?.mime?.startsWith('image/')),
      ),
    ];
    // Compare decoded pixels too: re-encoding a reference JPEG/PNG is not a new image.
    const pixelHash = async (input) => {
      const { data, info } = await sharp(input, { limitInputPixels: 40_000_000 })
        .rotate()
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return createHash('sha256')
        .update(`${info.width}x${info.height}:`)
        .update(data)
        .digest('hex');
    };
    const resultPixels = await pixelHash(buffer);
    for (const sourceId of sourceIds)
      ensure(
        (await pixelHash(this.assetPath(sourceId))) !== resultPixels,
        '结果与已有参考图或成片完全相同，请提交真实生成或编辑后的图片',
      );
    const accepted = this.store.transaction((state) => {
      const t = this.running(state, id, claim);
      ensure(!t.results.some((r) => r.slot === slot), '该造型已提交', 409);
      const sourceIds = Object.values(t.snapshot.assets).filter(Boolean);
      sourceIds.push(...(t.snapshot.trendItems || []).map((item) => item.assetId));
      sourceIds.push(...(t.snapshot.customItems || []).map((item) => item.assetId));
      t.snapshot.looks.forEach((l) => sourceIds.push(l.scene, l.white));
      sourceIds.push(t.sourceAssetId);
      sourceIds.push(t.layerBaseAssetId);
      sourceIds.push(...(t.referenceAssetIds || []));
      const sameImage = (candidate) =>
        candidate &&
        createHash('sha256')
          .update(readFileSync(this.assetPath(candidate)))
          .digest('hex') === asset.sha256;
      ensure(
        !sourceIds.some(sameImage) &&
          !t.results.some((r) => state.assets[r.assetId]?.sha256 === asset.sha256),
        '结果与已有参考图或成片完全相同，请提交真实生成或编辑后的图片',
      );
      state.assets[asset.id] = asset;
      if (layerAsset) state.assets[layerAsset.id] = layerAsset;
      t.results.push({ slot, assetId: asset.id, ...(layerMeta ? { editLayer: layerMeta } : {}) });
      if (['series', 'viral'].includes(t.kind))
        publishSeriesResults(findProject(state, t.projectId), t);
      t.updatedAt = now();
      t.message = `已收到 ${t.results.length} / ${t.total} 项结果`;
      return { accepted: true, assetId: asset.id, remaining: t.total - t.results.length };
    });
    const outputFile = this.mirrorGeneratedResult(id, slot, asset.id, layerAsset?.id || null);
    return { ...accepted, outputFile };
  }
  complete(id, claim) {
    return this.store.transaction((state) => {
      const t = this.running(state, id, claim);
      const p = t.projectId ? findProject(state, t.projectId) : null;
      ensure(
        t.results.length === t.total,
        `还缺少 ${t.total - t.results.length} 项结果，不能标记完成`,
      );
      if (t.kind === 'analysis') {
        ensure(t.analysis, '缺少解析结果');
        const trend = t.trendId
          ? findTrend(state, t.trendId)
          : findTrend(state, p.trendRefs.find((ref) => ref.role === 'primary').trendId);
        if (trend.analysis) trend.analysisHistory.push(trend.analysis);
        trend.analysis = {
          ...t.analysis,
          taskId: id,
          reportId: trend.assetId,
          createdAt: now(),
        };
        trend.status = 'ready';
        trend.title = trend.analysis.theme;
        trend.tags = [...new Set([...trend.tags, ...trend.analysis.keywords])].slice(0, 20);
        trend.revision = (trend.revision || 0) + 1;
        trend.updatedAt = now();
        for (const project of state.projects.filter((project) =>
          project.trendRefs?.some((ref) => ref.trendId === trend.id),
        )) {
          syncProjectRefs(state, project);
          changed(project);
        }
      } else if (['series', 'viral'].includes(t.kind)) {
        publishSeriesResults(p, t);
        ensure(
          t.results.every((result) => p.looks.some((look) => look.id === result.lookId)),
          '实时成片已变化，请在成片管理中检查后继续',
          409,
        );
      } else if (t.kind === 'restyle' && !t.lookIds.length) {
        const result = t.results[0];
        const slot = (t.slotOffset || maxLookSlot(p)) + 1;
        const layer = result.editLayer ? editableLayer(result, t) : null;
        p.looks.push({
          id: randomUUID(),
          slot,
          title: `改款 ${slot}`,
          designNotes: t.instruction,
          prompt: t.instruction,
          scene: result.assetId,
          white: null,
          originalScene: t.sourceAssetId,
          editLayer: layer,
          editLayers: layer ? [layer] : [],
          layerBaseScene: layer ? t.sourceAssetId : null,
          layerHistory: [],
          versions: [
            {
              scene: t.sourceAssetId,
              white: null,
              editLayer: null,
              instruction: '上传的改款原图',
              taskId: id,
              createdAt: t.createdAt,
            },
          ],
          detail: t.instruction,
          adjusted: true,
          taskId: id,
          originKind: 'restyle',
          provenance: 'codex',
        });
        p.nextLookSlot = Math.max(p.nextLookSlot || 1, slot + 1);
      } else {
        for (const result of t.results) {
          const look = p.looks.find((l) => l.id === t.lookIds[result.slot - 1]);
          ensure(look, '原造型已变化，请重新创建任务', 409);
          if (t.kind === 'restyle' && result.editLayer) {
            const layer = editableLayer(result, t, (look.editLayers || []).length);
            look.originalScene ||= look.versions[0]?.scene || result.editLayer.sourceAssetId;
            look.layerBaseScene ||= result.editLayer.sourceAssetId;
            ensure(
              look.layerBaseScene === result.editLayer.sourceAssetId,
              '图层底图已变化，请清空待确认图层后重新生成',
              409,
            );
            look.editLayers = (look.editLayers || []).map((item) => ({
              ...item,
              visible: false,
            }));
            look.editLayers.unshift(layer);
            look.scene = result.assetId;
            look.white = null;
            look.editLayer = layer;
            look.adjusted = true;
            look.detail = t.instruction;
            continue;
          }
          look.originalScene ||= look.versions[0]?.scene || look.scene;
          look.versions.push({
            scene: look.scene,
            white: look.white,
            editLayer: look.editLayer || null,
            instruction: look.detail || '原始生成图',
            taskId: id,
            createdAt: now(),
          });
          if (t.kind === 'white' || t.background === 'white') look.white = result.assetId;
          else {
            look.scene = result.assetId;
            look.white = null;
            look.editLayer = result.editLayer || null;
            look.editLayers = [];
            look.layerBaseScene = null;
          }
          if (['refine', 'restyle'].includes(t.kind)) {
            look.adjusted = true;
            look.detail = t.instruction;
          }
        }
      }
      if (p && t.kind !== 'analysis') changed(p);
      t.status = 'completed';
      t.message =
        t.channel === 'chat'
          ? '结果已校验并保存到成片管理'
          : '结果已校验并保存，请在工作台复核设计与图像细节';
      t.completedAt = now();
      t.claim = null;
      return { projectId: p?.id || null, trendId: t.trendId || null, taskId: id, status: t.status };
    });
  }
  taskAction(id, action, message = '') {
    return this.store.transaction((state) => {
      const t = findTask(state, id);
      if (action === 'cancel') {
        ensure(active(t), '任务已结束');
        t.status = 'cancelled';
        t.message = '任务已结束，已收到的结果保留在任务记录中';
        if (t.trendId) findTrend(state, t.trendId).status = 'cancelled';
      } else if (action === 'fail') {
        ensure(active(t), '任务已结束');
        ensure(message.trim(), '请说明失败原因');
        t.status = 'failed';
        t.message = message.slice(0, 2000);
        if (t.trendId) findTrend(state, t.trendId).status = 'failed';
      } else if (action === 'pause') {
        ensure(['pending', 'running'].includes(t.status), '仅排队中或正在执行的任务可以暂停');
        t.status = 'paused';
        t.message = '任务已暂停；已完成结果保留，继续后只处理剩余步骤';
        if (t.trendId) findTrend(state, t.trendId).status = 'paused';
      } else if (action === 'resume') {
        ensure(t.status === 'paused', '仅已暂停的任务可以继续');
        t.status = 'pending';
        t.message = '正在等待继续执行，仅处理未完成结果';
        if (t.trendId) findTrend(state, t.trendId).status = 'pending';
      } else if (action === 'restart') {
        ensure(active(t), '任务已结束');
        t.status = 'pending';
        t.message = '任务已重新排队，将保留结果并从当前未完成步骤继续';
        if (t.trendId) findTrend(state, t.trendId).status = 'pending';
      } else {
        ensure(['failed', 'cancelled'].includes(t.status), '仅失败或已结束的任务可以重试');
        if (t.trendId) {
          const trend = findTrend(state, t.trendId);
          ensure(
            (trend.revision || 0) === (t.snapshot.trend?.revision || 0),
            '趋势卡片已修改，请重新提炼',
            409,
          );
          trend.status = 'pending';
        } else {
          const p = findProject(state, t.projectId);
          ensureTaskCompatible(state, p, t, t.id);
          if (['white', 'refine', 'restyle'].includes(t.kind))
            ensure(
              taskInputsCurrent(p, t),
              '所选成片已被修改，请基于当前图片创建新任务；原结果仍保留',
              409,
            );
          if (t.kind === 'analysis')
            ensure(
              p.assets.report === t.snapshot.assets.report,
              '趋势报告已更换，请创建新的解析任务',
              409,
            );
        }
        t.status = 'pending';
        t.message = '已重新排队，仅继续未完成的结果';
      }
      t.claim = null;
      t.updatedAt = now();
      return { id, status: t.status };
    });
  }
  deleteTask(id) {
    return this.store.transaction((state) => {
      const task = findTask(state, id);
      ensure(!active(task), '请先结束或等待任务完成后再删除', 409);
      state.tasks = state.tasks.filter((candidate) => candidate.id !== id);
      return { deleted: id };
    });
  }
  async readReport(id) {
    const asset = this.store.state.assets[id];
    ensure(asset?.mime === 'application/pdf', '报告不存在');
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loading = getDocument({
      data: new Uint8Array(readFileSync(this.assetPath(id))),
      useSystemFonts: true,
      isEvalSupported: false,
    });
    const doc = await loading.promise;
    try {
      const pages = [];
      for (let i = 1; i <= Math.min(doc.numPages, 200); i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        pages.push({
          page: i,
          text: content.items
            .map((item) => item.str || '')
            .join(' ')
            .slice(0, 10000),
        });
      }
      return {
        path: this.assetPath(id),
        pageCount: doc.numPages,
        pages,
        note: '图片型 PDF 或图文混排需同时渲染查看页面，文字提取不代表视觉解析完成。',
      };
    } finally {
      await loading.destroy();
    }
  }
  exportProject(id, { mode = 'all', lookIds = [] } = {}) {
    ensure(['all', 'white', 'scene'].includes(mode), '导出类型无效');
    const p = structuredClone(findProject(this.store.state, id));
    ensure(
      Array.isArray(lookIds) &&
        new Set(lookIds).size === lookIds.length &&
        lookIds.every((id) => p.looks.some((l) => l.id === id)),
      '导出选择无效',
    );
    const looks = lookIds.length ? p.looks.filter((l) => lookIds.includes(l.id)) : p.looks;
    ensure(looks.length, '还没有可交付的成片');
    if (mode === 'white')
      ensure(
        looks.every((l) => l.white),
        '所选成片中仍有未完成白底处理的图片',
      );
    const files = {};
    const manifest = {
      name: p.name,
      exportedAt: now(),
      prompt: p.prompt,
      analysis: p.analysis,
      trendRefs: p.trendRefs,
      modelRefId: p.modelRefId,
      brandRefId: p.brandRefId,
      patternRefId: p.patternRefId,
      fabricRefId: p.fabricRefId,
      backgroundRefId: p.backgroundRefId,
      customRefIds: p.customRefIds,
      settings: {
        logoMethod: p.logoMethod,
        logoScale: p.logoScale,
        patternCoverage: p.patternCoverage,
        keepIdentity: p.keepIdentity,
        logoHarmony: p.logoHarmony,
        autoInvert: p.autoInvert,
      },
      looks: [],
    };
    looks.forEach((look, i) => {
      const item = {
        title: look.title,
        designNotes: look.designNotes,
        provenance: look.provenance,
        originKind: look.originKind || 'legacy',
        files: {},
      };
      for (const variant of mode === 'all' ? ['scene', 'white'] : [mode]) {
        if (!look[variant]) continue;
        const name = `images/LOOK_${String(look.slot || i + 1).padStart(2, '0')}_${variant}.png`;
        files[name] = new Uint8Array(readFileSync(this.assetPath(look[variant])));
        item.files[variant] = name;
      }
      manifest.looks.push(item);
    });
    files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
    files['design-notes.md'] = strToU8(
      `# ${p.name}\n\n${p.prompt}\n\n${p.analysis ? `## 趋势解析\n${p.analysis.summary}\n\n` : ''}${looks.map((l, i) => `## LOOK ${l.slot || i + 1} ${l.title}\n\n${l.designNotes || ''}`).join('\n\n')}\n\nAI 设计效果图需人工复核人物、Logo、面料与工艺。未经打版及工艺审核，不作为直接生产依据。\n`,
    );
    return Buffer.from(zipSync(files, { level: 0 }));
  }
  migrate(input) {
    ensure(Array.isArray(input.projects) && input.projects.length <= 100, '旧项目数据无效');
    return this.store.transaction((state) => {
      let imported = 0;
      for (const old of input.projects) {
        if (typeof old.id !== 'string' || state.migrations.includes(`legacy-settings-v2:${old.id}`))
          continue;
        const existing = state.projects.find((p) => p.id === old.id || p.legacyId === old.id);
        const p =
          existing ||
          newProject({
            name: String(old.name || '旧项目').slice(0, 100),
            group: String(old.group || '进行中').slice(0, 80),
            prompt: String(old.prompt || '').slice(0, 10000),
            lookCount: Math.max(1, Math.min(12, Number(old.lookCount) || 12)),
          });
        if (!existing) {
          p.legacyId = old.id;
          p.migrationNote =
            '旧版未保存上传原文件，请重新上传素材；旧版模拟生成状态未作为真实成片导入。';
          state.projects.push(p);
        }
        // Migrate settings separately from unverified completion flags and never overwrite subsequent edits.
        if (!(p.revision > 0)) {
          for (const [key, schema] of Object.entries(projectPatch.shape)) {
            if (old[key] === undefined) continue;
            const parsed = schema.safeParse(key === 'logoScale' ? Number(old[key]) : old[key]);
            if (parsed.success) p[key] = parsed.data;
          }
          for (const role of ['model', 'logo']) {
            const preview = old[`${role}Preview`];
            const archived = Object.values(state.assets).find(
              (a) =>
                a.archivePath?.startsWith('public/') && `/${a.archivePath.slice(7)}` === preview,
            );
            if (!p.assets[role] && archived) p.assets[role] = archived.id;
            if (p.assets[role]) {
              let item = state.materialLibrary.items.find(
                (candidate) => candidate.kind === role && candidate.assetId === p.assets[role],
              );
              if (!item) {
                item = {
                  id: randomUUID(),
                  assetId: p.assets[role],
                  kind: role,
                  title: state.assets[p.assets[role]]?.filename?.replace(/\.[^.]+$/, '') || role,
                  group: p.group,
                  tags: [],
                  revision: 0,
                  createdAt: now(),
                  updatedAt: now(),
                  archivedAt: null,
                };
                state.materialLibrary.items.push(item);
              }
              if (role === 'model') p.modelRefId = item.id;
              else p.brandRefId = item.id;
            }
          }
          syncProjectRefs(state, p);
          if (p.legacyId)
            p.migrationNote =
              '旧项目设置与可恢复素材已保留。缺少的上传原件需重新导入；旧版模拟生成状态未作为真实成片导入。';
        }
        if (!state.groups.includes(p.group)) state.groups.push(p.group);
        state.migrations.push(`legacy-settings-v2:${old.id}`);
        imported++;
      }
      return { imported };
    });
  }
}
