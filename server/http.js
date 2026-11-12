import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { ZodError } from 'zod';
import sharp from 'sharp';
import { ensure } from './schema.js';
import { codexLoginStatus, runCodex, startCodexLogin } from './codex.js';
import { inferChatAction } from './chat-actions.js';

const equal = (a, b) =>
  typeof a === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const compactText = (value, limit) =>
  typeof value === 'string' ? value.trim().slice(0, limit) : value;
const compactAnalysis = (analysis) =>
  analysis
    ? {
        theme: analysis.theme,
        summary: compactText(analysis.summary, 1200),
        keywords: analysis.keywords?.slice(0, 12),
        colors: analysis.colors?.slice(0, 8),
        silhouettes: analysis.silhouettes?.slice(0, 8),
        techniques: analysis.techniques?.slice(0, 8),
      }
    : null;
export function agentToken(directory) {
  const filename = path.join(directory, 'agent-token');
  if (!existsSync(filename)) {
    try {
      writeFileSync(filename, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  return readFileSync(filename, 'utf8').trim();
}

export function createApp(
  workbench,
  {
    agentKey = agentToken(workbench.store.directory),
    workspaceId = 'test',
    executor,
    login = startCodexLogin,
    loginStatus = codexLoginStatus,
    chat = null,
  } = {},
) {
  const app = express();
  const browserKey = randomBytes(32).toString('hex');
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 1, fields: 5 },
  });
  const referenceUpload = multer({ storage: multer.memoryStorage() });
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    try {
      ensure(['127.0.0.1', 'localhost', '[::1]'].includes(req.hostname), '仅允许本机访问', 403);
      if (req.headers.origin) {
        const origin = new URL(req.headers.origin);
        ensure(
          origin.protocol === 'http:' &&
            ['127.0.0.1', 'localhost'].includes(origin.hostname) &&
            (origin.host === req.headers.host || origin.port === '4173'),
          '来源不受信任',
          403,
        );
      }
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store');
      next();
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/health', (_req, res) =>
    res.json({
      ok: true,
      application: 'badmark-studio',
      workspaceId,
      mode: 'local-ai',
      pid: process.pid,
    }),
  );
  app.get('/api/session', (_req, res) => {
    res.cookie('badmark_session', browserKey, { httpOnly: true, sameSite: 'strict', path: '/' });
    res.json({ token: browserKey });
  });
  app.use('/api', (req, res, next) => {
    const bearer = req.headers.authorization?.replace(/^Bearer /, '');
    const cookie = req.headers.cookie
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith('badmark_session='))
      ?.slice(16);
    const read = ['GET', 'HEAD'].includes(req.method);
    if (
      equal(bearer, agentKey) ||
      equal(req.headers['x-badmark-token'], browserKey) ||
      (read && equal(cookie, browserKey))
    )
      return next();
    res.status(401).json({ error: '会话已过期，请刷新页面重试' });
  });
  app.use(express.json({ limit: '2mb' }));
  app.get('/api/state', (_req, res) =>
    res.json({
      ...workbench.publicState(),
      executor: executor?.snapshot() || { ready: false, message: '自动执行器未启动。' },
    }),
  );
  app.post('/api/executor/check', async (_req, res) => {
    ensure(executor, '自动执行器未启动，请重启工作台服务。', 503);
    res.json(await (executor.recheck ? executor.recheck() : executor.check()));
  });
  app.put('/api/provider', async (req, res) => {
    ensure(executor?.configureProvider, '当前执行器不支持切换 API。', 503);
    res.json(await executor.configureProvider(req.body));
  });
  app.post('/api/providers', async (req, res) => {
    ensure(executor?.createProviderProfile, '当前执行器不支持保存 API。', 503);
    res.status(201).json(await executor.createProviderProfile(req.body));
  });
  app.patch('/api/providers/:id', async (req, res) => {
    ensure(executor?.updateProviderProfile, '当前执行器不支持修改 API。', 503);
    res.json(await executor.updateProviderProfile(req.params.id, req.body));
  });
  app.delete('/api/providers/:id', async (req, res) => {
    ensure(executor?.deleteProviderProfile, '当前执行器不支持删除 API。', 503);
    res.json(await executor.deleteProviderProfile(req.params.id));
  });
  app.post('/api/auth/login', async (_req, res) => {
    ensure(executor, '自动执行器未启动，请重启工作台服务。', 503);
    const { authUrl, loginId, completion } = await login();
    completion.then(
      () => (executor.recheck ? executor.recheck() : executor.check()),
      () => (executor.recheck ? executor.recheck() : executor.check()),
    );
    res.json({ authUrl, loginId });
  });
  app.get('/api/auth/status', (_req, res) => res.json(loginStatus()));
  app.post('/api/chat/actions', (req, res) => {
    const messages = Array.isArray(req.body?.messages) ? req.body.messages.slice(-40) : [];
    ensure(messages.length > 0, '对话消息不能为空');
    const action = inferChatAction(messages);
    if (action.type === 'none') return res.json({ handled: false });
    ensure(executor, '自动执行器未启动，请重启工作台服务。', 503);
    const executorState = executor.snapshot ? executor.snapshot() : executor;
    ensure(executorState?.ready !== false, 'AI 服务尚未就绪，请先检查账号连接。', 503);

    if (action.type === 'resume') {
      const state = workbench.publicState();
      const requestedIds = messages
        .slice()
        .reverse()
        .map((message) => message?.taskId)
        .filter(Boolean);
      const resumable = (task) =>
        task && ['pending', 'running', 'paused', 'failed', 'cancelled'].includes(task.status);
      let task = requestedIds
        .map((id) => state.tasks.find((candidate) => candidate.id === id))
        .find(resumable);
      if (!task)
        task = state.tasks.find(
          (candidate) =>
            candidate.projectId === (req.body?.projectId || null) && resumable(candidate),
        );
      ensure(task, '没有找到可继续的任务，请说明要生成的内容。', 404);
      if (task.kind !== 'analysis')
        ensure(
          executorState?.imageGeneration !== false,
          executorState?.message || '当前 AI 服务不支持图片生成，请检查连接后重试。',
          503,
        );
      if (['failed', 'cancelled'].includes(task.status)) workbench.taskAction(task.id, 'retry');
      const current = workbench.publicState().tasks.find((candidate) => candidate.id === task.id);
      if (current.status !== 'running') executor.control('start-task', null, task.id);
      return res.json({
        handled: true,
        action: 'resume',
        reply: '已恢复任务，将从未完成的步骤继续执行。',
        task: workbench.publicState().tasks.find((candidate) => candidate.id === task.id),
      });
    }

    ensure(req.body?.projectId, '请先选择或创建一个项目，再开始生成。');
    ensure(
      executorState?.imageGeneration !== false,
      executorState?.message || '当前 AI 服务不支持图片生成，请检查连接后重试。',
      503,
    );
    const task = workbench.createTask(req.body.projectId, {
      kind: 'series',
      channel: 'chat',
      count: action.count,
      instruction: action.instruction,
      background: 'scene',
    });
    executor.control('start-task', null, task.id);
    const responseTask = workbench
      .publicState()
      .tasks.find((candidate) => candidate.id === task.id);
    return res.status(201).json({
      handled: true,
      action: 'series',
      reply: `已调用当前项目的趋势与参考素材，开始生成 ${action.count} 款。`,
      task: responseTask,
    });
  });
  app.post('/api/chat', async (req, res) => {
    const executorState = executor?.snapshot ? executor.snapshot() : executor;
    const executorReady = executorState?.ready;
    ensure(executorReady !== false, 'AI 服务尚未就绪，请先检查账号连接。', 503);
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    ensure(messages.length > 0 && messages.length <= 40, '对话消息数量无效');
    const normalized = messages.map((message) => {
      ensure(['user', 'assistant'].includes(message?.role), '对话角色无效');
      ensure(typeof message.content === 'string' && message.content.trim(), '对话内容不能为空');
      return { role: message.role, content: message.content.trim().slice(0, 4000) };
    });
    const requestedProjectId = req.body?.projectId || null;
    const lastMessage = normalized.at(-1);
    const capturedMemory =
      lastMessage?.role === 'user'
        ? workbench.captureExplicitMemory(requestedProjectId, lastMessage.content)
        : null;
    const state = workbench.publicState();
    const project = state.projects.find((item) => item.id === req.body?.projectId);
    const memories = workbench.memoryContext(project?.id || null);
    const recentMessages = normalized.slice(-10).map((message, index, messages) => ({
      ...message,
      content: compactText(message.content, index === messages.length - 1 ? 3000 : 1200),
    }));
    const context = {
      project: project
        ? {
            id: project.id,
            name: project.name,
            group: project.group,
            lookCount: project.looks.length,
            prompt: compactText(project.prompt, 1200),
            analysis: compactAnalysis(project.analysis),
          }
        : null,
      projects: state.projects.slice(0, 20).map((item) => ({
        id: item.id,
        name: item.name,
        looks: item.looks.length,
      })),
      tasks: state.tasks.slice(-12).map((task) => ({
        id: task.id,
        projectId: task.projectId,
        projectName: task.projectName,
        kind: task.kind,
        status: task.status,
        message: task.message,
        received: task.results?.length || 0,
        total: task.total,
      })),
      longTermMemory: {
        enabled: state.memory.enabled,
        entries: memories.slice(0, 16).map((entry) => ({
          id: entry.id,
          title: compactText(entry.title, 80),
          text: compactText(entry.text, 800),
          scope: entry.scope,
          category: entry.category,
          polarity: entry.polarity,
        })),
        capturedThisTurn: capturedMemory
          ? { id: capturedMemory.id, title: capturedMemory.title, text: capturedMemory.text }
          : null,
      },
    };
    const directory = mkdtempSync(path.join(workbench.store.directory, 'chat-'));
    try {
      const runner = chat || executor?.runRequest?.bind(executor) || runCodex;
      const result = await runner({
        directory,
        model: executorState?.recommendedModel || executorState?.model,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['reply'],
          properties: { reply: { type: 'string' } },
        },
        prompt: `你是红人馆AI服装改款工作台的助手。只用中文回答，语气清晰、具体、友好。结合当前改款成片和任务状态回答问题。优先直接回答，除非用户要求，否则保持简洁。不要声称已执行未发生的操作。\n\n当前工作台上下文：${JSON.stringify(context)}\n\n最近对话：${JSON.stringify(recentMessages)}`,
      });
      ensure(
        typeof result?.reply === 'string' && result.reply.trim(),
        'Chat 没有返回有效内容',
        502,
      );
      res.json({ reply: result.reply.trim() });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  app.post('/api/executor/control', (req, res) => {
    ensure(executor, '自动执行器未启动，请重启工作台服务。', 503);
    res.json(
      executor.control(
        req.body.action,
        req.body.model ?? req.body.concurrency ?? req.body.taskConcurrency,
        req.body.taskId,
      ),
    );
  });
  app.patch('/api/memory/settings', (req, res) =>
    res.json(workbench.setMemoryEnabled(req.body.enabled)),
  );
  app.post('/api/memory', (req, res) => res.status(201).json(workbench.createMemory(req.body)));
  app.patch('/api/memory/:id', (req, res) =>
    res.json(workbench.updateMemory(req.params.id, req.body)),
  );
  app.delete('/api/memory/:id', (req, res) => res.json(workbench.deleteMemory(req.params.id)));
  app.put('/api/output-directory', (req, res) => res.json(workbench.setOutputDirectory(req.body)));
  app.post('/api/output-directory/sync', (_req, res) => res.json(workbench.syncOutputDirectory()));
  app.post('/api/image-projects', referenceUpload.array('files'), async (req, res) => {
    ensure(req.files?.length, '请选择至少一张需要改款的图片');
    res.status(201).json(
      await workbench.createImageProjects(
        req.files.map((file) => ({
          buffer: file.buffer,
          filename: Buffer.from(file.originalname, 'latin1').toString('utf8'),
        })),
      ),
    );
  });
  app.post('/api/projects', (req, res) => res.status(201).json(workbench.createProject(req.body)));
  app.patch('/api/projects/:id', (req, res) =>
    res.json(workbench.updateProject(req.params.id, req.body)),
  );
  app.delete('/api/projects/:id/looks', (req, res) =>
    res.json(workbench.deleteLooks(req.params.id, req.body)),
  );
  app.post('/api/projects/:id/looks/:lookId/primary', (req, res) =>
    res.json(workbench.setLookPrimary(req.params.id, req.params.lookId, req.body)),
  );
  app.patch('/api/projects/:id/looks/:lookId/layers', async (req, res) =>
    res.json(await workbench.updateLookLayers(req.params.id, req.params.lookId, req.body)),
  );
  app.post('/api/projects/:id/looks/:lookId/layers/merge', async (req, res) =>
    res.json(await workbench.mergeLookLayers(req.params.id, req.params.lookId, req.body)),
  );
  app.delete('/api/projects/:id/looks/:lookId/layers/history/:historyId', (req, res) =>
    res.json(
      workbench.deleteLookLayerHistory(req.params.id, req.params.lookId, req.params.historyId),
    ),
  );
  app.post('/api/projects/:id/looks/:lookId/feedback', (req, res) =>
    res.json(workbench.feedbackLook(req.params.id, req.params.lookId, req.body)),
  );
  app.post('/api/projects/:id/looks/:action', (req, res) =>
    res.json(workbench.lookAction(req.params.id, req.body, req.params.action)),
  );
  app.delete('/api/projects/:id', (req, res) => res.json(workbench.deleteProject(req.params.id)));
  app.post('/api/groups', (req, res) => res.json(workbench.group(req.body.action, req.body.name)));
  app.post('/api/migrate', (req, res) => res.json(workbench.migrate(req.body)));
  const uploadMeta = (body) => ({
    title: body.title || undefined,
    group: body.group || undefined,
    tags: body.tags ? JSON.parse(body.tags) : undefined,
  });
  app.post('/api/library/trends', upload.single('file'), async (req, res) => {
    ensure(req.file, '请选择趋势文件');
    res
      .status(201)
      .json(
        await workbench.uploadTrend(
          req.file.buffer,
          Buffer.from(req.file.originalname, 'latin1').toString('utf8'),
          uploadMeta(req.body),
        ),
      );
  });
  app.patch('/api/library/trends/:id', (req, res) =>
    res.json(workbench.updateLibraryItem('trend', req.params.id, req.body)),
  );
  app.patch('/api/library/trends/:id/analysis', (req, res) =>
    res.json(workbench.updateTrendAnalysis(req.params.id, req.body)),
  );
  app.post('/api/library/trends/:id/analyze', (req, res) =>
    res.status(201).json(workbench.createTrendAnalysisTask(req.params.id)),
  );
  app.delete('/api/library/trends/:id', (req, res) =>
    res.json(workbench.deleteTrend(req.params.id)),
  );
  app.post('/api/library/trends/:id/:action', (req, res) =>
    res.json(workbench.libraryAction('trend', req.params.id, req.params.action)),
  );
  app.post('/api/library/materials/:kind', upload.single('file'), async (req, res) => {
    ensure(req.file, '请选择素材文件');
    res
      .status(201)
      .json(
        await workbench.uploadMaterial(
          req.params.kind,
          req.file.buffer,
          Buffer.from(req.file.originalname, 'latin1').toString('utf8'),
          uploadMeta(req.body),
        ),
      );
  });
  app.patch('/api/library/materials/:id', (req, res) =>
    res.json(workbench.updateLibraryItem('material', req.params.id, req.body)),
  );
  app.post('/api/library/materials/:id/crop', async (req, res) =>
    res.json(await workbench.cropMaterial(req.params.id, req.body)),
  );
  app.post('/api/library/materials/:id/reset-crop', (req, res) =>
    res.json(workbench.resetMaterialCrop(req.params.id, req.body)),
  );
  app.post('/api/library/materials/:id/:action', (req, res) =>
    res.json(workbench.libraryAction('material', req.params.id, req.params.action)),
  );
  app.post('/api/projects/:id/assets/:kind', upload.single('file'), async (req, res) => {
    ensure(req.file, '请选择文件');
    res.json(
      await workbench.upload(
        req.params.id,
        req.params.kind,
        req.file.buffer,
        Buffer.from(req.file.originalname, 'latin1').toString('utf8'),
      ),
    );
  });
  app.post(
    '/api/projects/:id/refine-references',
    referenceUpload.array('files'),
    async (req, res) => {
      ensure(req.files?.length, '请选择至少一张参考图');
      res.status(201).json(
        await workbench.uploadRefinementReferences(
          req.params.id,
          req.files.map((file) => ({
            buffer: file.buffer,
            filename: Buffer.from(file.originalname, 'latin1').toString('utf8'),
          })),
        ),
      );
    },
  );
  app.post('/api/projects/:id/confirm', (req, res) => res.json(workbench.confirm(req.params.id)));
  app.patch('/api/projects/:id/analysis', (req, res) =>
    res.json(workbench.updateAnalysis(req.params.id, req.body)),
  );
  app.post('/api/projects/:id/tasks', (req, res) => {
    if (executor && req.body?.kind !== 'analysis') {
      const executorState = executor.snapshot ? executor.snapshot() : executor;
      ensure(
        executorState?.ready !== false,
        executorState?.message || 'AI 服务尚未就绪，请先检查连接。',
        503,
      );
      ensure(
        executorState?.imageGeneration !== false,
        executorState?.message || '当前 AI 服务不支持图片生成，请检查连接后重试。',
        503,
      );
    }
    const task = workbench.createTask(req.params.id, req.body);
    delete task.snapshot;
    res.status(201).json(task);
  });
  app.post('/api/tasks/:id/:action', (req, res) => {
    ensure(['cancel', 'retry'].includes(req.params.action), '操作不存在', 404);
    res.json(workbench.taskAction(req.params.id, req.params.action));
  });
  app.delete('/api/tasks/:id', (req, res) => res.json(workbench.deleteTask(req.params.id)));
  app.get('/api/files/:id', async (req, res) => {
    const asset = workbench.store.state.assets[req.params.id];
    ensure(asset, '文件不存在', 404);
    if (req.query.preview && asset.mime === 'application/pdf') {
      const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const { createCanvas } = await import('@napi-rs/canvas');
      const loading = getDocument({
        data: new Uint8Array(readFileSync(workbench.assetPath(req.params.id))),
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
        res.type('image/png').send(canvas.toBuffer('image/png'));
        return;
      } finally {
        await loading.destroy();
      }
    }
    res.type(asset.mime);
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    if (req.query.download) res.attachment(asset.filename);
    // Uploaded assets live under .badmark; Express ignores dot-directories by default.
    res.sendFile(workbench.assetPath(req.params.id), { dotfiles: 'allow' });
  });
  app.post('/api/projects/:id/export', (req, res) => {
    const buffer = workbench.exportProject(req.params.id, req.body);
    res.attachment('红人馆AI-delivery.zip').type('application/zip').send(buffer);
  });
  // Only the stdio plugin possesses this key. Browser sessions cannot read local paths or submit task results.
  app.use('/internal', (req, res, next) => {
    if (!req.headers.origin && equal(req.headers.authorization?.replace(/^Bearer /, ''), agentKey))
      return next();
    res.status(403).json({ error: '此接口仅供本机工作台服务使用' });
  });
  app.get('/internal/tasks/:id', (req, res) => res.json(workbench.taskContext(req.params.id)));
  app.get('/internal/reports/:id', async (req, res) =>
    res.json(await workbench.readReport(req.params.id)),
  );
  app.post('/internal/assets/:id/reference', async (req, res) => {
    const source = workbench.assetPath(req.params.id);
    const filename = path.join(
      workbench.store.directory,
      'files',
      `${req.params.id}-reference.png`,
    );
    await sharp(source, { limitInputPixels: 40_000_000 }).rotate().png().toFile(filename);
    res.json({ path: filename, mime: 'image/png' });
  });
  app.post('/internal/tasks/:id/claim', (req, res) => res.json(workbench.claim(req.params.id)));
  app.post('/internal/tasks/:id/analysis', (req, res) =>
    res.json(workbench.submitAnalysis(req.params.id, req.body.claim, req.body.analysis)),
  );
  app.post('/internal/tasks/:id/plan', (req, res) =>
    res.json(workbench.submitPlan(req.params.id, req.body.claim, req.body.plan)),
  );
  app.post('/internal/tasks/:id/image', upload.single('file'), async (req, res) => {
    ensure(req.file, '缺少结果图片');
    res.json(
      await workbench.submitImage(
        req.params.id,
        req.body.claim,
        Number(req.body.slot),
        req.file.buffer,
        req.file.originalname,
      ),
    );
  });
  app.post('/internal/tasks/:id/complete', (req, res) =>
    res.json(workbench.complete(req.params.id, req.body.claim)),
  );
  app.post('/internal/tasks/:id/fail', (req, res) =>
    res.json(workbench.taskAction(req.params.id, 'fail', req.body.message)),
  );
  const dist = path.join(workbench.root, 'dist');
  app.use(express.static(dist, { dotfiles: 'deny', index: 'index.html' }));
  app.use((_req, res) => res.status(404).json({ error: '地址不存在' }));
  app.use((error, _req, res, _next) => {
    const status = error instanceof ZodError ? 400 : error.status || 500;
    const message =
      error instanceof ZodError
        ? error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
        : error.message;
    res.status(status).json({ error: message });
  });
  return app;
}
