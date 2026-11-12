import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createApp, agentToken } from '../server/http.js';
import { fixture, pdf, png, sampleAnalysis } from './helpers.js';

test('real stdio MCP can complete a persisted project workflow and export a delivery', async (t) => {
  const { workbench: w, directory } = fixture(t);
  const server = createApp(w, {
    agentKey: agentToken(directory),
    workspaceId: createHash('sha256').update(directory).digest('hex'),
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve('server/mcp.js')],
    env: {
      ...process.env,
      BADMARK_ROOT: process.cwd(),
      BADMARK_DATA_DIR: directory,
      BADMARK_PORT: String(server.address().port),
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'badmark-test', version: '1.0.0' });
  await client.connect(transport);
  t.after(() => client.close());
  async function call(name, args = {}) {
    const response = await client.callTool({ name, arguments: args });
    assert.ok(!response.isError, response.content?.[0]?.text);
    return JSON.parse(response.content[0].text);
  }
  const tools = await client.listTools();
  assert.ok(tools.tools.length >= 26);
  assert.ok(tools.tools.some((candidate) => candidate.name === 'update_look_layers'));
  assert.ok(tools.tools.some((candidate) => candidate.name === 'merge_look_layers'));
  assert.match((await call('open_workbench')).url, /127\.0\.0\.1/);
  assert.match((await call('open_workbench')).note, /无需复制指令/);
  assert.equal((await call('list_projects')).executor.ready, false);
  const p = await call('create_project', {
    project: { name: 'MCP integration', lookCount: 1, prompt: 'Trail outfit' },
  });
  for (const [kind, buffer, filename] of [
    ['report', pdf(), 'report.pdf'],
    ['model', await png('red'), 'model.png'],
    ['logo', await png('blue'), 'logo.png'],
  ]) {
    const filePath = path.join(directory, filename);
    writeFileSync(filePath, buffer);
    await call('import_asset', { projectId: p.id, kind, filePath });
  }
  const project = await call('get_project', { projectId: p.id });
  const report = await call('read_report', { assetId: project.assets.report });
  assert.match(report.pages[0].text, /Trail/);
  const task = await call('create_task', { projectId: p.id, task: { kind: 'analysis' } });
  const { claim } = await call('claim_task', { taskId: task.id });
  await call('submit_analysis', { taskId: task.id, claim, analysis: sampleAnalysis });
  await call('complete_task', { taskId: task.id, claim });
  await call('confirm_assets', { projectId: p.id });
  const generation = await call('create_task', { projectId: p.id, task: { kind: 'series' } });
  const gc = (await call('claim_task', { taskId: generation.id })).claim;
  const context = await call('get_task', { taskId: generation.id });
  assert.ok(context.files.model.path);
  await call('submit_series_plan', {
    taskId: generation.id,
    claim: gc,
    plan: [
      {
        slot: 1,
        title: 'Trail shell',
        prompt: 'Layered functional shell',
        designNotes: 'Ripstop shell with reflective logo',
      },
    ],
  });
  const resultPath = path.join(directory, 'result.png');
  writeFileSync(resultPath, await png('green'));
  await call('submit_result_image', {
    taskId: generation.id,
    claim: gc,
    slot: 1,
    filePath: resultPath,
  });
  await call('complete_task', { taskId: generation.id, claim: gc });
  const generatedLook = w.publicState().projects[0].looks[0];
  const refinementPaths = [
    path.join(directory, 'scene-reference.png'),
    path.join(directory, 'pose-reference.png'),
  ];
  writeFileSync(refinementPaths[0], await png('orange'));
  writeFileSync(refinementPaths[1], await png('pink'));
  const references = await call('import_refinement_references', {
    projectId: p.id,
    filePaths: refinementPaths,
  });
  const refinement = await call('create_task', {
    projectId: p.id,
    task: {
      kind: 'refine',
      lookIds: [generatedLook.id],
      referenceAssetIds: references.assets.map((asset) => asset.id),
      instruction: 'Use the scene and pose references',
    },
  });
  const refinementClaim = (await call('claim_task', { taskId: refinement.id })).claim;
  const refinementContext = await call('get_task', { taskId: refinement.id });
  assert.ok(refinementContext.files['reference:1'].path);
  const refinementResult = path.join(directory, 'refinement.png');
  writeFileSync(refinementResult, await png('purple'));
  await call('submit_result_image', {
    taskId: refinement.id,
    claim: refinementClaim,
    slot: 1,
    filePath: refinementResult,
  });
  await call('complete_task', { taskId: refinement.id, claim: refinementClaim });
  const refinedLook = w.publicState().projects[0].looks[0];
  assert.equal(refinedLook.versions.length, 1);
  await call('set_primary_image', {
    projectId: p.id,
    lookId: refinedLook.id,
    assetId: generatedLook.scene,
  });
  assert.equal(w.publicState().projects[0].looks[0].scene, generatedLook.scene);
  const exported = await call('export_delivery', { projectId: p.id });
  assert.ok(readFileSync(exported.path).length > 100);
  assert.equal(w.publicState().projects[0].looks[0].title, 'Trail shell');
  await call('archive_finished_images', {
    projectId: p.id,
    lookIds: [w.publicState().projects[0].looks[0].id],
    action: 'archive',
  });
  await call('delete_finished_images', {
    projectId: p.id,
    lookIds: [w.publicState().projects[0].archivedLooks[0].id],
  });
  assert.equal(w.publicState().projects[0].looks.length, 0);
  assert.equal(w.publicState().projects[0].history.at(-1).reason, '从归档删除成片');
  const sharedPath = path.join(directory, 'shared-pattern.png');
  writeFileSync(sharedPath, await png('orange'));
  const shared = await call('import_reference', {
    kind: 'pattern',
    filePath: sharedPath,
    metadata: { group: '共享品牌', tags: ['几何'] },
  });
  const library = await call('list_library', { library: 'material' });
  assert.ok(library.items.some((item) => item.id === shared.id));
  const fabricPath = path.join(directory, 'shared-fabric.png');
  writeFileSync(fabricPath, await png('blue'));
  const fabric = await call('import_reference', {
    kind: 'fabric',
    filePath: fabricPath,
  });
  const fabrics = await call('list_library', { library: 'material', kind: 'fabric' });
  assert.deepEqual(
    fabrics.items.map((item) => item.id),
    [fabric.id],
  );
  await call('update_library_item', {
    library: 'material',
    itemId: shared.id,
    changes: { title: 'Edited pattern' },
  });
  await call('archive_library_item', {
    library: 'material',
    itemId: shared.id,
    action: 'archive',
  });
  const trendPath = path.join(directory, 'shared-trend.png');
  writeFileSync(trendPath, await png('yellow'));
  const trend = await call('import_reference', { kind: 'trend', filePath: trendPath });
  await call('task_action', { taskId: trend.task.id, action: 'cancel' });
  await call('archive_library_item', {
    library: 'trend',
    itemId: trend.item.id,
    action: 'archive',
  });
  await call('delete_trend', { itemId: trend.item.id });
  assert.equal(
    w.publicState().trendLibrary.items.some((item) => item.id === trend.item.id),
    false,
  );
  const rejected = await client.callTool({
    name: 'complete_task',
    arguments: { taskId: generation.id, claim: gc },
  });
  assert.equal(rejected.isError, true);
});
