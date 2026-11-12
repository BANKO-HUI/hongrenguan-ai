import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import sharp from 'sharp';
import { Workbench } from '../server/workbench.js';
import { DEFAULT_SERIES_PROMPT } from '../server/schema.js';
import { fixture, pdf, png, prepared, series, sampleAnalysis } from './helpers.js';

test('new projects stay empty and optional references do not fake generation', (t) => {
  const { workbench: w } = fixture(t);
  const p = w.createProject({ name: 'New' });
  assert.deepEqual(p.looks, []);
  assert.equal(p.analysis, null);
  assert.equal(p.confirmed, false);
  assert.equal(p.prompt, DEFAULT_SERIES_PROMPT);
  assert.throws(() => w.createTask(p.id, { kind: 'analysis' }), /上传/);
  assert.throws(() => w.createTask(p.id, { kind: 'series' }), /解析/);
  assert.equal(w.confirm(p.id).confirmed, true);
  assert.throws(() => w.exportProject(p.id), /成片/);
  assert.throws(() => w.createProject({ name: 'Invalid', lookCount: 100 }));
});

test('uploaded files survive restarts, PDF is actually read, invalid inputs rejected', async (t) => {
  const { workbench: w, directory } = fixture(t);
  const p = w.createProject({ name: 'Files' });
  await w.upload(p.id, 'report', pdf(), 'real.pdf');
  await w.upload(p.id, 'model', await png('red'), 'model.png');
  const state = w.publicState(),
    reportId = state.projects[0].assets.report;
  const modelId = state.projects[0].assets.model;
  assert.deepEqual(readFileSync(w.assetPath(state.assets[modelId].originalId)), await png('red'));
  assert.equal(state.assets[reportId].pageCount, 1);
  assert.match((await w.readReport(reportId)).pages[0].text, /Trail clothing/);
  const restarted = new Workbench({ root: process.cwd(), directory, seed: false });
  assert.equal(restarted.publicState().projects[0].assets.report, reportId);
  assert.deepEqual(readFileSync(restarted.assetPath(reportId)), pdf());
  await assert.rejects(w.upload(p.id, 'model', Buffer.from('not an image'), 'fake.png'), /图片/);
  await assert.rejects(w.upload(p.id, 'report', Buffer.from('not a pdf'), 'fake.pdf'), /PDF/);
  assert.equal(w.publicState().projects[0].assets.report, reportId);
});

test('uploads accept files beyond the former 30 MB boundary', async (t) => {
  const { workbench: w } = fixture(t);
  const p = w.createProject({ name: 'Large upload' });
  const largePdf = Buffer.concat([pdf(), Buffer.alloc(31 * 1024 * 1024, 0x20)]);
  await w.upload(p.id, 'report', largePdf, 'large-report.pdf');
  const reportId = w.store.state.projects[0].assets.report;
  assert.equal(w.store.state.assets[reportId].size, largePdf.length);
});

test('generated images mirror to a bound local output folder and existing results can sync', async (t) => {
  const { workbench: w, directory } = fixture(t);
  const outputDirectory = path.join(path.dirname(directory), '红人馆AI成片');
  mkdirSync(outputDirectory);

  assert.throws(
    () => w.setOutputDirectory({ path: path.join(outputDirectory, 'missing'), enabled: true }),
    /不存在|write/,
  );
  assert.throws(
    () => w.setOutputDirectory({ path: path.parse(outputDirectory).root, enabled: true }),
    /根目录/,
  );

  const bound = w.setOutputDirectory({ path: outputDirectory, enabled: true });
  assert.equal(bound.enabled, true);
  assert.equal(bound.path, realpathSync(outputDirectory));

  const project = await prepared(w, 2);
  await series(w, project.id, ['green', 'yellow']);
  const generatedFiles = readdirSync(outputDirectory);
  assert.equal(generatedFiles.length, 2);
  assert.ok(generatedFiles.every((filename) => filename.startsWith('红人馆AI_')));
  assert.ok(generatedFiles.every((filename) => existsSync(path.join(outputDirectory, filename))));
  assert.equal(w.publicState().outputDirectory.lastSavedFile, generatedFiles.at(-1));

  const synced = w.syncOutputDirectory();
  assert.equal(synced.copied, 2);
  assert.equal(synced.directory, realpathSync(outputDirectory));
  assert.deepEqual(readdirSync(outputDirectory).sort(), generatedFiles.sort());

  const disabled = w.setOutputDirectory({ path: outputDirectory, enabled: false });
  assert.equal(disabled.enabled, false);
  assert.throws(() => w.syncOutputDirectory(), /先绑定/);
});

test('Chat image tasks accept five references and publish only to finished images', async (t) => {
  const { workbench: w, directory } = fixture(t);
  const project = w.createProject({ name: 'Chat references' });
  const references = await w.uploadRefinementReferences(project.id, [
    { buffer: await png('red'), filename: 'source.png' },
    { buffer: await png('orange'), filename: 'shape.png' },
    { buffer: await png('yellow'), filename: 'color.png' },
    { buffer: await png('green'), filename: 'texture.png' },
    { buffer: await png('blue'), filename: 'detail.png' },
    { buffer: await png('purple'), filename: 'extra.png' },
  ]);
  assert.equal(references.assets.length, 6);
  assert.throws(
    () =>
      w.createTask(project.id, {
        kind: 'restyle',
        channel: 'chat',
        sourceAssetId: references.assets[0].id,
        referenceAssetIds: references.assets.slice(1).map((asset) => asset.id),
        referenceLabels: ['版型', '色彩', '面料', '细节', '额外'],
        instruction: '超出 Chat 参考图上限。',
      }),
    /Chat 模式最多使用 5 张/,
  );

  const task = w.createTask(project.id, {
    kind: 'restyle',
    channel: 'chat',
    sourceAssetId: references.assets[0].id,
    referenceAssetIds: references.assets.slice(1, 5).map((asset) => asset.id),
    referenceLabels: ['版型', '色彩', '面料', '细节'],
    instruction: '结合五张参考图生成新的针织 Polo 套装。',
  });
  assert.equal(task.channel, 'chat');
  const claim = w.claim(task.id).claim;
  await w.submitImage(task.id, claim, 1, await png('black'), 'chat-result.png');
  w.complete(task.id, claim);

  const state = w.publicState();
  const completed = state.tasks.find((candidate) => candidate.id === task.id);
  const resultAssetId = completed.results[0].assetId;
  assert.equal(
    state.projects.find((candidate) => candidate.id === project.id).looks[0].scene,
    resultAssetId,
  );
  assert.equal(
    state.materialLibrary.items.some((item) => item.sourceTaskId === task.id),
    false,
  );
  assert.equal(state.materialLibrary.groups.includes('Chat 生成'), false);

  w.store.transaction((draft) => {
    draft.migrations = draft.migrations.filter(
      (migration) => migration !== 'chat-results-finished-only-v1',
    );
    draft.materialLibrary.groups.push('Chat 生成');
    draft.materialLibrary.items.push({
      id: 'legacy-chat-material',
      assetId: resultAssetId,
      kind: 'custom',
      title: '旧版 Chat 生成副本',
      group: 'Chat 生成',
      tags: ['Chat生成'],
      sourceTaskId: task.id,
      sourceProjectId: project.id,
      revision: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      archivedAt: null,
    });
  });
  const migrated = new Workbench({ root: process.cwd(), directory, seed: false }).publicState();
  assert.equal(
    migrated.materialLibrary.items.some((item) => item.id === 'legacy-chat-material'),
    false,
  );
  assert.equal(migrated.materialLibrary.groups.includes('Chat 生成'), false);
  assert.equal(
    migrated.projects.find((candidate) => candidate.id === project.id).looks[0].scene,
    resultAssetId,
  );
});

test('material cropping preserves the original and updates future project references', async (t) => {
  const { workbench: w } = fixture(t);
  const material = await w.uploadMaterial('model', await png('red'), 'portrait.png');
  const project = w.createProject({ name: 'Crop reference' });
  w.updateProject(project.id, { modelRefId: material.id, expectedRevision: 0 });
  const cropped = await w.cropMaterial(material.id, {
    aspect: 'free',
    zoom: 1,
    x: 0,
    y: 0,
    cropRect: { left: 0.25, top: 0.25, width: 0.5, height: 0.5 },
    expectedRevision: 0,
  });
  assert.notEqual(cropped.assetId, material.assetId);
  assert.equal(cropped.sourceAssetId, material.assetId);
  assert.equal(cropped.cropHistory[0].assetId, material.assetId);
  assert.deepEqual(
    await sharp(w.assetPath(cropped.assetId))
      .metadata()
      .then(({ width, height }) => ({
        width,
        height,
      })),
    { width: 32, height: 48 },
  );
  assert.equal(w.store.state.projects[0].assets.model, cropped.assetId);
  await assert.rejects(
    w.cropMaterial(material.id, {
      aspect: '3:4',
      zoom: 1,
      x: 0,
      y: 0,
      expectedRevision: 0,
    }),
    /已更新/,
  );
  const restored = w.resetMaterialCrop(material.id, { expectedRevision: cropped.revision });
  assert.equal(restored.assetId, material.assetId);
  assert.equal(restored.crop, null);
  assert.equal(w.store.state.projects[0].assets.model, material.assetId);
  assert.ok(existsSync(w.assetPath(cropped.assetId)));
});

test('analysis needs real structured evidence and correct page bounds', async (t) => {
  const { workbench: w } = fixture(t);
  const p = w.createProject({ name: 'Report' });
  await w.upload(p.id, 'report', pdf(), 'report.pdf');
  const task = w.createTask(p.id, { kind: 'analysis' });
  const { claim } = w.claim(task.id);
  assert.throws(() => w.complete(task.id, claim), /缺少/);
  assert.throws(() => w.submitAnalysis(task.id, claim, { ...sampleAnalysis, evidence: [] }));
  assert.throws(
    () =>
      w.submitAnalysis(task.id, claim, {
        ...sampleAnalysis,
        evidence: [{ page: 2, note: 'bad page' }],
      }),
    /页数/,
  );
  w.submitAnalysis(task.id, claim, sampleAnalysis);
  w.complete(task.id, claim);
  assert.equal(w.publicState().projects[0].analysis.theme, sampleAnalysis.theme);
  await w.upload(p.id, 'report', pdf(), 'replacement.pdf');
  assert.equal(w.publicState().projects[0].analysis, null);
});

test('end-to-end analysis, series, white, refinement and ZIP with preserved versions', async (t) => {
  const { workbench: w } = fixture(t);
  const p = await prepared(w);
  let generated = await series(w, p.id);
  assert.equal(generated.looks.length, 2);
  assert.throws(() => w.exportProject(p.id, { mode: 'white' }), /未完成/);
  const sceneId = generated.looks[0].scene;
  const white = w.createTask(p.id, { kind: 'white', lookIds: generated.looks.map((l) => l.id) });
  const wc = w.claim(white.id).claim;
  await w.submitImage(white.id, wc, 1, await png('white'), 'white1.png');
  await w.submitImage(white.id, wc, 2, await png('ivory'), 'white2.png');
  w.complete(white.id, wc);
  generated = w.publicState().projects[0];
  assert.equal(generated.looks[0].scene, sceneId);
  assert.ok(generated.looks[0].white);
  const archive = unzipSync(w.exportProject(p.id));
  assert.equal(Object.keys(archive).length, 6);
  const manifest = JSON.parse(strFromU8(archive['manifest.json']));
  assert.equal(manifest.looks.length, 2);
  assert.deepEqual(
    manifest.looks.map((look) => look.originKind),
    ['series', 'series'],
  );
  assert.equal(manifest.patternRefId, null);
  assert.equal(manifest.fabricRefId, null);
  assert.match(strFromU8(archive['design-notes.md']), /Fabric and pattern 1/);
  assert.deepEqual(
    Buffer.from(archive['images/LOOK_01_scene.png']),
    readFileSync(w.assetPath(sceneId)),
  );
  const references = await w.uploadRefinementReferences(p.id, [
    { buffer: await png('cyan'), filename: 'scene-reference.png' },
    { buffer: await png('magenta'), filename: 'pose-reference.png' },
  ]);
  const refine = w.createTask(p.id, {
    kind: 'refine',
    lookIds: [generated.looks[0].id],
    referenceAssetIds: references.assets.map((asset) => asset.id),
    instruction: 'Change jacket',
    background: 'scene',
  });
  const refineContext = w.taskContext(refine.id);
  assert.equal(refineContext.files['reference:1'].filename, 'scene-reference.png');
  assert.equal(refineContext.files['reference:2'].filename, 'pose-reference.png');
  const rc = w.claim(refine.id).claim;
  await w.submitImage(refine.id, rc, 1, await png('purple'), 'refine.png');
  w.complete(refine.id, rc);
  const after = w.publicState().projects[0].looks[0];
  assert.notEqual(after.scene, sceneId);
  assert.equal(after.white, null);
  assert.equal(after.adjusted, true);
  assert.equal(after.versions.length, 2);
  assert.ok(after.versions[1].white);
  assert.equal(after.originalScene, sceneId);
  const refinedScene = after.scene;
  const restoredOriginal = w.setLookPrimary(p.id, after.id, { assetId: sceneId });
  assert.equal(restoredOriginal.scene, sceneId);
  assert.ok(restoredOriginal.white);
  assert.ok(restoredOriginal.versions.some((version) => version.scene === refinedScene));
  const restoredRefinement = w.setLookPrimary(p.id, after.id, { assetId: refinedScene });
  assert.equal(restoredRefinement.scene, refinedScene);
  assert.equal(restoredRefinement.white, null);
  const beforeAppend = w.publicState().projects[0].looks.map((look) => ({
    id: look.id,
    scene: look.scene,
    slot: look.slot,
  }));
  const appended = await series(w, p.id, ['orange', 'pink']);
  assert.equal(appended.looks.length, 4);
  assert.deepEqual(
    appended.looks.slice(0, 2).map(({ id, scene, slot }) => ({ id, scene, slot })),
    beforeAppend,
  );
  assert.deepEqual(
    appended.looks.map((look) => look.slot),
    [1, 2, 3, 4],
  );
  assert.equal(w.publicState().projects[0].history.length, 0);
  assert.ok(existsSync(w.assetPath(sceneId)));
});

test('new series tasks reserve append-only slots and leave existing looks editable', async (t) => {
  const { workbench: w } = fixture(t);
  const project = await prepared(w, 2);
  const first = await series(w, project.id);
  const original = first.looks.map(({ id, scene, slot }) => ({ id, scene, slot }));
  const updated = w.updateProject(project.id, {
    lookCount: 1,
    expectedRevision: first.revision,
  });
  assert.equal(updated.lookCount, 1);

  const generation = w.createTask(project.id, { kind: 'series' });
  assert.equal(generation.slotOffset, 2);
  const refine = w.createTask(project.id, {
    kind: 'refine',
    lookIds: [original[0].id],
    instruction: 'Keep this prior image editable while appending',
  });
  assert.equal(refine.status, 'pending');
  w.taskAction(refine.id, 'cancel');

  const claim = w.claim(generation.id).claim;
  w.submitPlan(generation.id, claim, [
    { slot: 1, title: 'Appended look', prompt: 'New variation', designNotes: 'New notes' },
  ]);
  await w.submitImage(generation.id, claim, 1, await png('orange'), 'appended.png');
  w.complete(generation.id, claim);

  const finished = w.publicState().projects.find((item) => item.id === project.id);
  assert.deepEqual(
    finished.looks.slice(0, 2).map(({ id, scene, slot }) => ({ id, scene, slot })),
    original,
  );
  assert.deepEqual(
    finished.looks.map((look) => look.slot),
    [1, 2, 3],
  );
  assert.equal(finished.history.length, 0);
  const archive = unzipSync(w.exportProject(project.id));
  assert.ok(archive['images/LOOK_03_scene.png']);
});

test('finished images can be removed safely while files and project history are retained', async (t) => {
  const { workbench: w } = fixture(t);
  const project = await prepared(w, 2);
  const generated = await series(w, project.id);
  const removed = generated.looks[0];
  const scenePath = w.assetPath(removed.scene);
  assert.throws(() => w.deleteLooks(project.id, { lookIds: [removed.id] }), /先归档/);
  w.lookAction(project.id, { lookIds: [removed.id] }, 'archive');
  let current = w.publicState().projects.find((item) => item.id === project.id);
  assert.equal(current.looks.length, 1);
  assert.equal(current.archivedLooks.length, 1);
  w.lookAction(project.id, { lookIds: [removed.id] }, 'restore');
  current = w.publicState().projects.find((item) => item.id === project.id);
  assert.equal(current.looks.length, 2);
  assert.equal(current.archivedLooks.length, 0);
  w.lookAction(project.id, { lookIds: [removed.id] }, 'archive');
  const result = w.deleteLooks(project.id, { lookIds: [removed.id] });
  current = w.publicState().projects.find((item) => item.id === project.id);
  assert.deepEqual(result.deleted, [removed.id]);
  assert.equal(current.looks.length, 1);
  assert.equal(current.archivedLooks.length, 0);
  assert.equal(current.history.at(-1).reason, '从归档删除成片');
  assert.equal(current.history.at(-1).looks[0].id, removed.id);
  assert.ok(existsSync(scenePath));
  w.lookAction(project.id, { lookIds: [current.looks[0].id] }, 'archive');
  assert.throws(
    () => w.deleteLooks(project.id, { lookIds: [current.looks[0].id, 'missing'] }),
    /先归档/,
  );
  assert.equal(
    w.publicState().projects.find((item) => item.id === project.id).archivedLooks.length,
    1,
  );
  w.lookAction(project.id, { lookIds: [current.looks[0].id] }, 'restore');
  current = w.publicState().projects.find((item) => item.id === project.id);
  const activeTask = w.createTask(project.id, {
    kind: 'white',
    lookIds: [current.looks[0].id],
  });
  assert.throws(
    () => w.lookAction(project.id, { lookIds: [current.looks[0].id] }, 'archive'),
    /结束当前项目的任务/,
  );
  w.taskAction(activeTask.id, 'cancel');
});

test('claims, task exclusivity, cancellation and partial retry prevent duplicate work', async (t) => {
  const { workbench: w, directory } = fixture(t);
  const p = await prepared(w);
  const task = w.createTask(p.id, { kind: 'series' });
  let claim = w.claim(task.id).claim;
  assert.throws(() => w.claim(task.id), /领取/);
  assert.throws(() => w.updateProject(p.id, { prompt: 'overwrite' }), /结束/);
  assert.throws(() => w.deleteProject(p.id), /结束/);
  const analysis = w.createTask(p.id, { kind: 'analysis' });
  assert.equal(analysis.status, 'pending');
  w.taskAction(analysis.id, 'cancel');
  assert.throws(() => w.createTask(p.id, { kind: 'series' }), /已有系列生成任务/);
  await assert.rejects(w.submitImage(task.id, claim, 1, await png('green'), '1.png'), /计划/);
  w.submitPlan(
    task.id,
    claim,
    [1, 2].map((slot) => ({ slot, title: `Look ${slot}`, prompt: 'Trail', designNotes: 'Note' })),
  );
  await w.submitImage(task.id, claim, 1, await png('green'), '1.png');
  await assert.rejects(w.submitImage(task.id, claim, 1, await png('yellow'), '2.png'), /已提交/);
  await assert.rejects(
    w.submitImage(task.id, claim, 2, await png('green'), 'same.png'),
    /完全相同/,
  );
  assert.throws(() => w.complete(task.id, claim), /缺少 1/);
  w.taskAction(task.id, 'cancel');
  await assert.rejects(w.submitImage(task.id, claim, 2, await png('yellow'), '2.png'), /失效/);
  w.taskAction(task.id, 'retry');
  claim = w.claim(task.id).claim;
  assert.deepEqual(w.taskContext(task.id).remainingSlots, [2]);
  const restarted = new Workbench({ root: process.cwd(), directory, seed: false });
  assert.equal(restarted.taskContext(task.id).status, 'paused');
  assert.throws(() => restarted.complete(task.id, claim), /失效/);
  restarted.taskAction(task.id, 'resume');
  claim = restarted.claim(task.id).claim;
  await restarted.submitImage(task.id, claim, 2, await png('yellow'), '2.png');
  restarted.complete(task.id, claim);
  assert.equal(restarted.publicState().projects[0].looks.length, 2);
});

test('only terminal task records can be deleted and their saved results remain', async (t) => {
  const { workbench: w } = fixture(t);
  const project = await prepared(w, 1);
  const activeTask = w.createTask(project.id, { kind: 'series' });
  assert.throws(() => w.deleteTask(activeTask.id), /先结束或等待任务完成/);
  w.taskAction(activeTask.id, 'cancel');
  assert.deepEqual(w.deleteTask(activeTask.id), { deleted: activeTask.id });
  assert.equal(
    w.publicState().tasks.some((task) => task.id === activeTask.id),
    false,
  );

  await series(w, project.id, ['green']);
  const completed = w.store.state.tasks.find(
    (task) =>
      task.projectId === project.id && task.kind === 'series' && task.status === 'completed',
  );
  const resultAssetId = completed.results[0].assetId;
  assert.deepEqual(w.deleteTask(completed.id), { deleted: completed.id });
  const state = w.publicState();
  assert.equal(
    state.tasks.some((task) => task.id === completed.id),
    false,
  );
  assert.equal(state.projects.find((item) => item.id === project.id).looks.length, 1);
  assert.ok(state.assets[resultAssetId]);
});

test('series results publish immediately and can be refined without blocking other projects', async (t) => {
  const { workbench: w } = fixture(t);
  const first = await prepared(w, 2);
  const second = await prepared(w, 1);
  const generation = w.createTask(first.id, { kind: 'series' });
  const claim = w.claim(generation.id).claim;
  w.submitPlan(
    generation.id,
    claim,
    [1, 2].map((slot) => ({
      slot,
      title: `Live look ${slot}`,
      prompt: `Design ${slot}`,
      designNotes: `Live notes ${slot}`,
    })),
  );
  await w.submitImage(generation.id, claim, 1, await png('green'), 'live.png');
  const liveLook = w.publicState().projects.find((project) => project.id === first.id).looks[0];
  assert.equal(liveLook.title, 'Live look 1');
  assert.equal(liveLook.taskId, generation.id);
  const refine = w.createTask(first.id, {
    kind: 'refine',
    lookIds: [liveLook.id],
    instruction: 'Adjust this completed image while the series continues',
  });
  assert.equal(refine.status, 'pending');
  assert.throws(
    () => w.createTask(first.id, { kind: 'white', lookIds: [liveLook.id] }),
    /已有白底、精修或改款任务/,
  );
  const otherSeries = w.createTask(second.id, { kind: 'series' });
  assert.equal(otherSeries.status, 'pending');
  w.taskAction(refine.id, 'cancel');
  w.taskAction(otherSeries.id, 'cancel');
  w.taskAction(generation.id, 'cancel');
});

test('restart promotes legacy active series results to editable stable looks', async (t) => {
  const { workbench: w, directory } = fixture(t);
  const project = await prepared(w, 2);
  const generation = w.createTask(project.id, { kind: 'series' });
  const claim = w.claim(generation.id).claim;
  w.submitPlan(generation.id, claim, [
    { slot: 1, title: 'Legacy partial', prompt: 'Recovered', designNotes: 'Editable result' },
    { slot: 2, title: 'Pending look', prompt: 'Continue', designNotes: 'Not generated yet' },
  ]);
  await w.submitImage(generation.id, claim, 1, await png('green'), 'partial.png');
  w.store.transaction((state) => {
    const task = state.tasks.find((candidate) => candidate.id === generation.id);
    const currentProject = state.projects.find((candidate) => candidate.id === project.id);
    delete task.publishedAt;
    delete task.results[0].lookId;
    currentProject.looks = [];
  });
  const restarted = new Workbench({ root: process.cwd(), directory, seed: false });
  const state = restarted.publicState();
  const task = state.tasks.find((candidate) => candidate.id === generation.id);
  const look = state.projects.find((candidate) => candidate.id === project.id).looks[0];
  assert.equal(task.status, 'paused');
  assert.equal(look.title, 'Legacy partial');
  assert.equal(look.taskId, generation.id);
  assert.equal(task.results[0].lookId, look.id);
});

test('projects, groups, legacy migration and invalid export selection stay isolated', async (t) => {
  const { workbench: w } = fixture(t);
  const p = await prepared(w, 1);
  await series(w, p.id, ['green']);
  const second = w.createProject({ name: 'Second', group: 'Custom' });
  assert.throws(
    () =>
      w.createTask(second.id, {
        kind: 'white',
        lookIds: [w.publicState().projects.find((i) => i.id === p.id).looks[0].id],
      }),
    /不存在/,
  );
  assert.throws(() => w.exportProject(p.id, { lookIds: ['missing'] }), /无效/);
  w.group('delete', 'Custom');
  assert.equal(w.publicState().projects[0].group, '进行中');
  const legacy = {
    projects: [
      { id: 'old', name: 'Legacy', progress: 100, assetConfirmed: true, analysisProgress: 100 },
    ],
  };
  assert.equal(w.migrate(legacy).imported, 1);
  assert.equal(w.migrate(legacy).imported, 0);
  const imported = w.publicState().projects.find((p) => p.name === 'Legacy');
  assert.equal(imported.looks.length, 0);
  assert.equal(imported.analysis, null);
  w.deleteProject(second.id);
  assert.equal(w.publicState().projects.find((i) => i.id === p.id).looks.length, 1);
  assert.throws(() => w.group('invalid', 'group'), /无效/);
});

test('archived mountain images are never mislabeled as white-background results', (t) => {
  const { workbench: w } = fixture(t, true);
  const state = w.publicState();
  assert.equal(state.projects.find((p) => p.id === 'forest').looks.length, 12);
  assert.ok(state.projects.find((p) => p.id === 'forest').looks.every((l) => l.white));
  assert.ok(state.projects.find((p) => p.id === 'mountain').looks.every((l) => !l.white));
  assert.ok(Object.values(state.assets).every((a) => existsSync(w.assetPath(a.id))));
});

test('corrupt database is not silently replaced and a previous valid backup exists', (t) => {
  const { workbench: w, directory } = fixture(t);
  w.createProject({ name: 'Preserve me' });
  w.createProject({ name: 'Second' });
  const backup = JSON.parse(readFileSync(path.join(directory, 'state.json.bak')));
  assert.equal(backup.projects[0].name, 'Preserve me');
  writeFileSync(path.join(directory, 'state.json'), '{broken');
  assert.throws(() => new Workbench({ root: process.cwd(), directory, seed: false }));
  assert.equal(readFileSync(path.join(directory, 'state.json'), 'utf8'), '{broken');
});

test('concurrent settings edits are rejected instead of silently overwriting', (t) => {
  const { workbench: w } = fixture(t);
  const p = w.createProject({ name: 'Revision test' });
  const updated = w.updateProject(p.id, { prompt: 'First editor', expectedRevision: 0 });
  assert.equal(updated.revision, 1);
  assert.throws(
    () => w.updateProject(p.id, { prompt: 'Stale editor', expectedRevision: 0 }),
    /另一处更新/,
  );
  assert.equal(w.publicState().projects[0].prompt, 'First editor');
});

test('legacy migration preserves settings and recoverable references without trusting simulated output', (t) => {
  const { workbench: w } = fixture(t, true);
  const old = {
    projects: [
      {
        id: 'legacy-custom',
        name: 'Restored project',
        group: '2027 Spring',
        prompt: 'Original saved description',
        logoScale: '55',
        modelPreview: '/assets/model-reference.jpg',
        logoPreview: '/assets/badmark-logo.svg',
        progress: 100,
        assetConfirmed: true,
      },
    ],
  };
  assert.equal(w.migrate(old).imported, 1);
  const restored = w.publicState().projects.find((p) => p.legacyId === 'legacy-custom');
  assert.equal(restored.prompt, 'Original saved description');
  assert.equal(restored.logoScale, 55);
  assert.equal(restored.group, '2027 Spring');
  assert.ok(restored.assets.model);
  assert.ok(restored.assets.logo);
  assert.equal(restored.confirmed, true);
  assert.equal(restored.looks.length, 0);
  w.updateProject(restored.id, { name: 'New name' });
  assert.equal(w.migrate(old).imported, 0);
  assert.equal(w.publicState().projects.find((p) => p.id === restored.id).name, 'New name');
});

test('shared trend and material libraries auto-queue, organize, archive and freeze series references', async (t) => {
  const { workbench: w } = fixture(t);
  const uploaded = await w.uploadTrend(pdf(), '2028-trail.pdf', {
    group: '2028 春夏',
    tags: ['跑山', '轻量'],
  });
  assert.equal(uploaded.item.sourceType, 'pdf');
  assert.ok(uploaded.item.coverAssetId);
  assert.equal(uploaded.task.kind, 'analysis');
  const claim = w.claim(uploaded.task.id).claim;
  w.submitAnalysis(uploaded.task.id, claim, sampleAnalysis);
  w.complete(uploaded.task.id, claim);
  let trend = w.publicState().trendLibrary.items.find((item) => item.id === uploaded.item.id);
  assert.equal(trend.status, 'ready');
  assert.equal(trend.analysis.theme, sampleAnalysis.theme);
  const model = await w.uploadMaterial('model', await png('red'), 'model.png', { group: '人物' });
  const pattern = await w.uploadMaterial('pattern', await png('blue'), 'pattern.png', {
    tags: ['几何'],
  });
  const logo = await w.uploadMaterial('logo', await png('yellow'), 'logo.png');
  const fabric = await w.uploadMaterial('fabric', await png('orange'), 'fabric.png', {
    tags: ['防撕裂'],
  });
  const background = await w.uploadMaterial('custom', await png('green'), 'forest-scene.png', {
    tags: ['背景'],
  });
  const project = w.createProject({
    name: 'Shared refs',
    prompt: 'Trail collection',
    lookCount: 1,
  });
  const legacySelection = w.updateProject(project.id, {
    brandRefId: pattern.id,
    expectedRevision: 0,
  });
  assert.equal(legacySelection.brandRefId, null);
  assert.equal(legacySelection.patternRefId, pattern.id);
  w.updateProject(project.id, {
    trendRefs: [{ trendId: trend.id, role: 'primary' }],
    modelRefId: model.id,
    brandRefId: logo.id,
    patternRefId: pattern.id,
    fabricRefId: fabric.id,
    backgroundRefId: background.id,
    patternCoverage: 64,
    expectedRevision: legacySelection.revision,
  });
  const task = w.createTask(project.id, { kind: 'series' });
  assert.equal(task.snapshot.brandItem.kind, 'logo');
  assert.equal(task.snapshot.patternItem.kind, 'pattern');
  assert.equal(task.snapshot.fabricItem.kind, 'fabric');
  assert.equal(task.snapshot.backgroundItem.id, background.id);
  assert.equal(task.snapshot.patternCoverage, 64);
  assert.equal(task.snapshot.trendItems[0].analysis.theme, sampleAnalysis.theme);
  assert.equal(w.taskContext(task.id).files.background.id, background.assetId);
  trend = w.updateTrendAnalysis(trend.id, {
    expectedRevision: trend.revision,
    analysis: { ...sampleAnalysis, theme: 'Edited shared direction' },
  });
  assert.equal(trend.analysisHistory.length, 1);
  assert.equal(task.snapshot.trendItems[0].analysis.theme, sampleAnalysis.theme);
  w.taskAction(task.id, 'cancel');
  assert.equal(w.libraryAction('material', pattern.id, 'archive').archivedAt !== null, true);
  assert.equal(w.libraryAction('material', pattern.id, 'restore').archivedAt, null);
});

test('optional project references, regional restyle and viral variations preserve every source', async (t) => {
  const { workbench: w } = fixture(t);
  const uploadedTrend = await w.uploadTrend(await png('green'), 'direction.png');
  let claim = w.claim(uploadedTrend.task.id).claim;
  w.submitAnalysis(uploadedTrend.task.id, claim, sampleAnalysis);
  w.complete(uploadedTrend.task.id, claim);
  const custom = await w.uploadMaterial('custom', await png('blue'), 'fabric.png', {
    tags: ['面料'],
  });
  const project = w.createProject({ name: 'Flexible design', lookCount: 1 });
  const updated = w.updateProject(project.id, {
    trendRefs: [{ trendId: uploadedTrend.item.id, role: 'primary' }],
    customRefIds: [custom.id],
    expectedRevision: 0,
  });
  assert.equal(updated.modelRefId, null);
  assert.equal(updated.brandRefId, null);
  const optionalSeries = w.createTask(project.id, { kind: 'series' });
  assert.equal(optionalSeries.snapshot.modelItem, null);
  assert.equal(optionalSeries.snapshot.brandItem, null);
  assert.equal(optionalSeries.snapshot.customItems[0].id, custom.id);
  w.taskAction(optionalSeries.id, 'cancel');

  const inputs = await w.uploadRefinementReferences(project.id, [
    { buffer: await png('red'), filename: 'source.png' },
    { buffer: await png('yellow'), filename: 'trim.png' },
  ]);
  const annotations = [
    {
      id: 'region-1',
      type: 'circle',
      mode: 'adjust',
      color: '#ff8a1f',
      colorName: '橙色',
      label: '调整领口结构',
      strokeWidth: 22,
      points: [
        { x: 0.2, y: 0.1 },
        { x: 0.6, y: 0.4 },
      ],
    },
  ];
  const restyle = w.createTask(project.id, {
    kind: 'restyle',
    sourceAssetId: inputs.assets[0].id,
    referenceAssetIds: [inputs.assets[1].id],
    referenceLabels: ['辅料参考'],
    annotations,
    instruction: '用 @辅料参考 调整领口，其余区域保持不变。',
  });
  assert.deepEqual(restyle.annotations, annotations);
  claim = w.claim(restyle.id).claim;
  await w.submitImage(restyle.id, claim, 1, await png('orange'), 'restyled.png');
  w.complete(restyle.id, claim);
  let current = w.publicState().projects.find((item) => item.id === project.id);
  assert.equal(current.looks.length, 1);
  assert.equal(current.looks[0].originalScene, inputs.assets[0].id);
  assert.equal(current.looks[0].versions[0].scene, inputs.assets[0].id);
  assert.equal(current.looks[0].originKind, 'restyle');
  const preserved = structuredClone(current.looks[0]);

  const viral = w.createTask(project.id, {
    kind: 'viral',
    lookIds: [preserved.id],
    referenceAssetIds: [inputs.assets[1].id],
    referenceLabels: ['面料方向'],
    instruction: '结合 @面料方向 做两个风格相近但结构不同的款式。',
    count: 2,
  });
  const viralContext = w.taskContext(viral.id);
  assert.equal(viralContext.sourceAssetId, null);
  assert.equal(viralContext.files[`scene:${preserved.id}`].id, preserved.scene);
  claim = w.claim(viral.id).claim;
  w.submitPlan(viral.id, claim, [
    { slot: 1, title: 'Variation 1', prompt: 'First', designNotes: 'Different collar' },
    { slot: 2, title: 'Variation 2', prompt: 'Second', designNotes: 'Different proportion' },
  ]);
  await w.submitImage(viral.id, claim, 1, await png('purple'), 'viral-1.png');
  await w.submitImage(viral.id, claim, 2, await png('black'), 'viral-2.png');
  w.complete(viral.id, claim);
  current = w.publicState().projects.find((item) => item.id === project.id);
  assert.equal(current.looks.length, 3);
  assert.deepEqual(current.looks[0], preserved);
  assert.deepEqual(
    current.looks.slice(1).map((look) => look.originKind),
    ['viral', 'viral'],
  );
  assert.deepEqual(
    current.looks.map((look) => look.slot),
    [2, 3, 4],
  );
});

test('regional restyle keeps independent alternatives until selected layers are merged', async (t) => {
  const { workbench: w } = fixture(t);
  const project = w.createProject({ name: 'Layered regional restyle' });
  const inputs = await w.uploadRefinementReferences(project.id, [
    { buffer: await png('red'), filename: 'source.png' },
  ]);
  const task = w.createTask(project.id, {
    kind: 'restyle',
    sourceAssetId: inputs.assets[0].id,
    annotations: [
      {
        id: 'adjust-cuff',
        type: 'circle',
        mode: 'adjust',
        color: '#ef4444',
        colorName: '红色',
        label: '调整袖口',
        points: [
          { x: 0.2, y: 0.2 },
          { x: 0.5, y: 0.5 },
        ],
      },
    ],
    instruction: '只调整袖口，其余保持不变。',
  });
  const layer = await sharp({
    create: {
      width: 64,
      height: 96,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="20" height="20"><rect width="20" height="20" fill="#0066ff"/></svg>',
        ),
        left: 12,
        top: 18,
      },
    ])
    .png()
    .toBuffer();
  const claim = w.claim(task.id).claim;
  await w.submitImage(task.id, claim, 1, await png('blue'), 'composite.png', {
    editLayer: {
      buffer: layer,
      filename: 'cuff-layer.png',
      bounds: { left: 8, top: 12, width: 32, height: 48 },
    },
  });
  w.complete(task.id, claim);

  let look = w.publicState().projects.find((item) => item.id === project.id).looks[0];
  const firstPreviewId = look.scene;
  const layerId = look.editLayer.assetId;
  assert.equal(look.editLayer.sourceAssetId, inputs.assets[0].id);
  assert.deepEqual(look.editLayer.bounds, { left: 8, top: 12, width: 32, height: 48 });
  assert.ok(w.publicState().assets[layerId]);
  assert.equal(look.editLayers.length, 1);
  assert.equal(look.layerBaseScene, inputs.assets[0].id);
  assert.throws(
    () => w.setLookPrimary(project.id, look.id, { assetId: inputs.assets[0].id }),
    /合并或清空/,
  );

  const secondTask = w.createTask(project.id, {
    kind: 'restyle',
    lookIds: [look.id],
    annotations: [
      {
        id: 'adjust-cuff-again',
        type: 'circle',
        mode: 'adjust',
        color: '#22c55e',
        colorName: '绿色',
        label: '再次调整袖口',
        points: [
          { x: 0.24, y: 0.24 },
          { x: 0.54, y: 0.54 },
        ],
      },
    ],
    instruction: '生成另一个袖口方案，保留上一版。',
  });
  assert.equal(secondTask.layerBaseAssetId, inputs.assets[0].id);
  assert.equal(w.taskContext(secondTask.id).files[`scene:${look.id}`].id, inputs.assets[0].id);
  const secondLayer = await sharp({
    create: {
      width: 64,
      height: 96,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="20" height="20"><rect width="20" height="20" fill="#00aa55"/></svg>',
        ),
        left: 16,
        top: 22,
      },
    ])
    .png()
    .toBuffer();
  const secondClaim = w.claim(secondTask.id).claim;
  await w.submitImage(secondTask.id, secondClaim, 1, await png('green'), 'second-preview.png', {
    editLayer: {
      buffer: secondLayer,
      filename: 'second-cuff-layer.png',
      bounds: { left: 10, top: 14, width: 34, height: 50 },
    },
  });
  w.complete(secondTask.id, secondClaim);

  look = w.publicState().projects.find((item) => item.id === project.id).looks[0];
  assert.equal(look.editLayers.length, 2);
  assert.equal(look.editLayers[0].visible, true);
  assert.equal(look.editLayers[1].visible, false);
  assert.equal(look.editLayers[1].assetId, layerId);
  assert.notEqual(look.scene, firstPreviewId);

  const configured = look.editLayers.map((item, index) => ({
    id: item.id,
    name: index === 0 ? '方案 B' : '方案 A',
    visible: true,
    opacity: index === 0 ? 0.7 : 1,
  }));
  look = await w.updateLookLayers(project.id, look.id, { layers: configured });
  const configuredPreviewId = look.scene;
  assert.equal(look.editLayers[0].name, '方案 B');
  assert.equal(look.editLayers[0].opacity, 0.7);
  assert.equal(
    look.editLayers.every((item) => item.visible),
    true,
  );

  look = await w.mergeLookLayers(project.id, look.id, { layers: configured });
  const mergedId = look.scene;
  assert.notEqual(mergedId, configuredPreviewId);
  assert.deepEqual(look.editLayers, []);
  assert.equal(look.layerBaseScene, null);
  assert.equal(look.editLayer, null);
  assert.equal(look.layerHistory.length, 1);
  assert.equal(look.layerHistory[0].action, 'merge');
  assert.equal(look.layerHistory[0].layers.length, 2);
  assert.equal(
    look.versions.some((version) => version.scene === inputs.assets[0].id),
    true,
  );

  look = w.setLookPrimary(project.id, look.id, { assetId: inputs.assets[0].id });
  assert.equal(look.scene, inputs.assets[0].id);
  look = w.setLookPrimary(project.id, look.id, { assetId: mergedId });
  assert.equal(look.scene, mergedId);
});

test('clearing every pending regional layer restores the base and records a discard', async (t) => {
  const { workbench: w } = fixture(t);
  const project = w.createProject({ name: 'Discard regional layers' });
  const inputs = await w.uploadRefinementReferences(project.id, [
    { buffer: await png('red'), filename: 'source.png' },
  ]);
  const task = w.createTask(project.id, {
    kind: 'restyle',
    sourceAssetId: inputs.assets[0].id,
    annotations: [
      {
        id: 'adjust-detail',
        type: 'brush',
        mode: 'adjust',
        color: '#ef4444',
        colorName: '红色',
        label: '调整细节',
        points: [
          { x: 0.2, y: 0.2 },
          { x: 0.4, y: 0.4 },
        ],
      },
    ],
    instruction: '调整标注区域。',
  });
  const layer = await sharp({
    create: {
      width: 64,
      height: 96,
      channels: 4,
      background: { r: 0, g: 0, b: 255, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  const claim = w.claim(task.id).claim;
  await w.submitImage(task.id, claim, 1, await png('blue'), 'preview.png', {
    editLayer: {
      buffer: layer,
      filename: 'layer.png',
      bounds: { left: 8, top: 12, width: 32, height: 48 },
    },
  });
  w.complete(task.id, claim);
  const lookId = w.publicState().projects.find((item) => item.id === project.id).looks[0].id;
  const look = await w.updateLookLayers(project.id, lookId, { layers: [] });
  assert.equal(look.scene, inputs.assets[0].id);
  assert.deepEqual(look.editLayers, []);
  assert.equal(look.layerHistory[0].action, 'discard');
  assert.equal(look.layerHistory[0].layers.length, 1);
});

test('restyle conflicts only lock the same finished image', async (t) => {
  const { workbench: w } = fixture(t);
  const project = await prepared(w, 2);
  await series(w, project.id, ['green', 'yellow']);
  const [first, second] = w.publicState().projects.find((item) => item.id === project.id).looks;

  const activeRestyle = w.createTask(project.id, {
    kind: 'restyle',
    lookIds: [first.id],
    instruction: '调整第一款领口。',
  });
  assert.throws(
    () =>
      w.createTask(project.id, {
        kind: 'white',
        lookIds: [first.id],
      }),
    /白底、精修或改款任务/,
  );
  const independentRestyle = w.createTask(project.id, {
    kind: 'restyle',
    lookIds: [second.id],
    instruction: '调整第二款面料。',
  });
  assert.equal(activeRestyle.status, 'pending');
  assert.equal(independentRestyle.status, 'pending');
});

test('trend cards can create a fresh analysis task without duplicating active work', async (t) => {
  const { workbench: w } = fixture(t);
  const uploaded = await w.uploadTrend(await png('green'), 'manual-analysis.png');
  assert.throws(() => w.createTrendAnalysisTask(uploaded.item.id), /正在提炼/);
  w.taskAction(uploaded.task.id, 'cancel');
  const task = w.createTrendAnalysisTask(uploaded.item.id);
  const trend = w.publicState().trendLibrary.items.find((item) => item.id === uploaded.item.id);
  assert.equal(task.status, 'pending');
  assert.equal(task.trendId, uploaded.item.id);
  assert.equal(trend.status, 'pending');
  assert.match(task.message, /等待开始解析/);
});

test('trend deletion blocks active or referenced cards and retains source files and task history', async (t) => {
  const { workbench: w } = fixture(t);
  const uploaded = await w.uploadTrend(await png('green'), 'direction.png');
  const sourcePath = w.assetPath(uploaded.item.assetId);
  assert.throws(() => w.deleteTrend(uploaded.item.id), /先归档/);
  w.libraryAction('trend', uploaded.item.id, 'archive');
  assert.throws(() => w.deleteTrend(uploaded.item.id), /正在提炼/);
  w.taskAction(uploaded.task.id, 'cancel');
  const project = w.createProject({ name: 'Trend reference' });
  const linked = w.updateProject(project.id, {
    trendRefs: [{ trendId: uploaded.item.id, role: 'primary' }],
    expectedRevision: 0,
  });
  assert.throws(() => w.deleteTrend(uploaded.item.id), /1 个项目使用/);
  w.updateProject(project.id, { trendRefs: [], expectedRevision: linked.revision });
  const result = w.deleteTrend(uploaded.item.id);
  assert.equal(result.deleted, uploaded.item.id);
  assert.ok(existsSync(sourcePath));
  assert.equal(
    w.publicState().trendLibrary.items.some((item) => item.id === uploaded.item.id),
    false,
  );
  const historicalTask = w.publicState().tasks.find((task) => task.id === uploaded.task.id);
  assert.ok(historicalTask.sourceDeletedAt);
  assert.equal(historicalTask.canRetry, false);
});

test('v1 state receives a durable backup and deduplicated shared-library migration', (t) => {
  const { workbench: w, directory } = fixture(t, true);
  const legacy = w.store.read();
  legacy.version = 1;
  legacy.migrations = legacy.migrations.filter((entry) => entry !== 'shared-libraries-v2');
  delete legacy.trendLibrary;
  delete legacy.materialLibrary;
  for (const project of legacy.projects) {
    delete project.trendRefs;
    delete project.modelRefId;
    delete project.brandRefId;
  }
  writeFileSync(path.join(directory, 'state.json'), JSON.stringify(legacy));
  const migrated = new Workbench({ root: process.cwd(), directory, seed: false });
  const state = migrated.publicState();
  assert.equal(state.version, 2);
  assert.ok(existsSync(path.join(directory, 'state.v1.backup.json')));
  assert.equal(state.trendLibrary.items.length, 1);
  assert.equal(state.materialLibrary.items.filter((item) => item.kind === 'model').length, 1);
  assert.ok(state.projects.every((project) => project.modelRefId && project.brandRefId));
  assert.ok(state.projects.every((project) => Array.isArray(project.archivedLooks)));
});

test('reference-slot migration separates a legacy pattern from Logo and classifies old looks', async (t) => {
  const { workbench: w, directory } = fixture(t);
  const pattern = await w.uploadMaterial('pattern', await png('blue'), 'legacy-pattern.png');
  const project = w.createProject({ name: 'Legacy slots' });
  w.store.transaction((state) => {
    const saved = state.projects.find((item) => item.id === project.id);
    saved.brandRefId = pattern.id;
    delete saved.patternRefId;
    delete saved.fabricRefId;
    saved.looks.push({
      id: 'legacy-look',
      slot: 1,
      title: 'Legacy image',
      scene: pattern.assetId,
      white: null,
      versions: [],
    });
    state.migrations = state.migrations.filter((entry) => entry !== 'reference-slots-v4');
  });
  const migrated = new Workbench({ root: process.cwd(), directory, seed: false });
  const saved = migrated.publicState().projects.find((item) => item.id === project.id);
  assert.equal(saved.brandRefId, null);
  assert.equal(saved.patternRefId, pattern.id);
  assert.equal(saved.fabricRefId, null);
  assert.equal(saved.looks[0].originKind, 'legacy');
  assert.ok(existsSync(path.join(directory, 'state.pre-reference-slots-v4.backup.json')));
});

test('append-only migration restores series replacement history and resumes reserved slots', async (t) => {
  const { workbench: w, directory } = fixture(t);
  const project = await prepared(w, 2);
  const first = await series(w, project.id);
  const replacementAsset = w.registerBuffer(
    await png('orange'),
    'legacy-replacement.png',
    'image/png',
  );
  w.store.transaction((state) => {
    const current = state.projects.find((item) => item.id === project.id);
    const previous = structuredClone(current.looks);
    const replacement = {
      ...structuredClone(previous[0]),
      id: 'legacy-current-look',
      scene: replacementAsset.id,
      slot: 1,
      title: 'Legacy current look',
    };
    state.assets[replacementAsset.id] = replacementAsset;
    current.history.push({
      createdAt: new Date().toISOString(),
      looks: previous,
      reason: '系列重新生成',
    });
    current.looks = [replacement];
    delete current.nextLookSlot;
    state.tasks.unshift({
      id: 'legacy-partial-series',
      projectId: project.id,
      projectName: current.name,
      kind: 'series',
      lookIds: [],
      referenceAssetIds: [],
      instruction: '',
      background: 'scene',
      total: 2,
      status: 'paused',
      message: 'legacy partial task',
      results: [{ slot: 1, assetId: replacement.scene, lookId: replacement.id }],
      plan: [],
      snapshot: structuredClone(first),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attempts: 1,
      publishedAt: new Date().toISOString(),
    });
    state.migrations = state.migrations.filter((entry) => entry !== 'append-only-series-v3');
  });

  const migrated = new Workbench({ root: process.cwd(), directory, seed: false }).publicState();
  const restored = migrated.projects.find((item) => item.id === project.id);
  const partial = migrated.tasks.find((task) => task.id === 'legacy-partial-series');
  assert.ok(existsSync(path.join(directory, 'state.pre-append-only-v3.backup.json')));
  assert.equal(restored.looks.length, 3);
  assert.deepEqual(
    restored.looks.map((look) => look.slot),
    [1, 2, 3],
  );
  assert.equal(
    restored.history.some((entry) => entry.reason === '系列重新生成'),
    false,
  );
  assert.equal(partial.slotOffset, 2);
  assert.equal(restored.nextLookSlot, 5);
});

test('long-term memory is scoped, explicit, feedback-backed and frozen into tasks', async (t) => {
  const { workbench: w } = fixture(t);
  const project = await prepared(w, 1);
  const globalMemory = w.createMemory({
    title: '品牌规则',
    text: 'Logo 优先使用小面积同色刺绣。',
    scope: 'global',
    projectId: null,
    category: 'brand',
    polarity: 'rule',
  });
  const projectMemory = w.createMemory({
    title: '当前系列色彩',
    text: '使用低饱和苔藓绿，避免荧光色。',
    scope: 'project',
    projectId: project.id,
    category: 'color',
    polarity: 'positive',
  });
  const other = w.createProject({ name: 'Other collection' });

  assert.deepEqual(
    w
      .memoryContext(project.id)
      .map((item) => item.id)
      .sort(),
    [globalMemory.id, projectMemory.id].sort(),
  );
  assert.deepEqual(
    w.memoryContext(other.id).map((item) => item.id),
    [globalMemory.id],
  );
  assert.equal(w.captureExplicitMemory(project.id, '这次做一组户外造型'), null);
  const captured = w.captureExplicitMemory(project.id, '记住：衣服正面不使用超大 Logo');
  const repeated = w.captureExplicitMemory(project.id, '记住：衣服正面不使用超大 Logo');
  assert.equal(repeated.id, captured.id);
  assert.equal(repeated.evidenceCount, 2);

  const frozen = w.createTask(project.id, { kind: 'series' });
  const frozenMemoryIds = w.store.state.tasks
    .find((task) => task.id === frozen.id)
    .snapshot.memoryContext.map((item) => item.id);
  assert.ok(frozenMemoryIds.includes(globalMemory.id));
  assert.ok(frozenMemoryIds.includes(projectMemory.id));
  w.updateMemory(projectMemory.id, {
    status: 'archived',
    expectedRevision: projectMemory.revision,
  });
  assert.ok(
    w.store.state.tasks
      .find((task) => task.id === frozen.id)
      .snapshot.memoryContext.some((item) => item.id === projectMemory.id),
  );
  w.taskAction(frozen.id, 'cancel');
  w.setMemoryEnabled(false);
  const withoutMemory = w.createTask(project.id, { kind: 'series' });
  assert.deepEqual(
    w.store.state.tasks.find((task) => task.id === withoutMemory.id).snapshot.memoryContext,
    [],
  );
  w.taskAction(withoutMemory.id, 'cancel');
  w.setMemoryEnabled(true);

  const generated = await series(w, project.id, ['green']);
  const look = generated.looks[0];
  const liked = w.feedbackLook(project.id, look.id, { value: 'liked', note: '保留这种轻量分层。' });
  assert.equal(liked.feedback, 'liked');
  assert.equal(liked.memory.source, 'look-feedback');
  assert.equal(liked.memory.polarity, 'positive');
  const disliked = w.feedbackLook(project.id, look.id, { value: 'disliked' });
  assert.equal(disliked.memory.id, liked.memory.id);
  assert.equal(disliked.memory.polarity, 'negative');
  const cleared = w.feedbackLook(project.id, look.id, { value: 'clear' });
  assert.equal(cleared.feedback, null);
  assert.equal(
    w.store.state.memory.entries.find((entry) => entry.id === liked.memory.id).status,
    'archived',
  );
  assert.throws(() => w.deleteMemory(globalMemory.id), /先停用/);
});
