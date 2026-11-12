import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { Workbench } from '../server/workbench.js';

export const sampleAnalysis = {
  theme: 'Outdoor motion',
  summary: 'Lightweight equipment for trail movement.',
  keywords: ['Trail', 'Layering'],
  colors: [{ name: 'Forest', hex: '#335544' }],
  silhouettes: 'Layered shells',
  functions: 'Water storage',
  techniques: 'Reflective print',
  evidence: [{ page: 1, note: 'Trail clothing described on the first page.' }],
};
export const png = (color) =>
  sharp({ create: { width: 64, height: 96, channels: 4, background: color } })
    .png()
    .toBuffer();
export function pdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = 'BT /F1 12 Tf 20 240 Td (Trail clothing and layered shells) Tj ET';
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  let output = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(output));
    output += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output);
}
function createArchiveFixtures(root) {
  const reportDirectory = path.join(root, '项目资料', '趋势报告');
  const publicDirectory = path.join(root, 'public', 'assets');
  const outputDirectory = path.join(root, 'outputs');
  mkdirSync(reportDirectory, { recursive: true });
  mkdirSync(publicDirectory, { recursive: true });
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(
    path.join(
      reportDirectory,
      'Mountain Running Plan 跑山计划（2027春夏户外运动主题趋势）_WOW-TREND.pdf',
    ),
    pdf(),
  );
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Qn7WAAAAAElFTkSuQmCC',
    'base64',
  );
  writeFileSync(path.join(publicDirectory, 'model-reference.jpg'), pixel);
  writeFileSync(
    path.join(publicDirectory, 'badmark-logo.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32" fill="black"/></svg>',
  );
  for (const prefix of ['badmark_heavy_outdoor', 'badmark_mountain_running'])
    for (let slot = 1; slot <= 12; slot += 1)
      writeFileSync(
        path.join(outputDirectory, `${prefix}_look_${String(slot).padStart(2, '0')}.png`),
        pixel,
      );
  for (let slot = 1; slot <= 12; slot += 1)
    writeFileSync(
      path.join(
        outputDirectory,
        `badmark_heavy_outdoor_whitebg_look_${String(slot).padStart(2, '0')}.png`,
      ),
      pixel,
    );
}
export function fixture(t, seed = false) {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'badmark-test-'));
  const directory = path.join(temporary, '.badmark');
  const root = seed ? path.join(temporary, 'workspace') : process.cwd();
  if (seed) createArchiveFixtures(root);
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const workbench = new Workbench({ root, directory, seed });
  return { workbench, directory, root };
}
export async function prepared(workbench, count = 2) {
  const p = workbench.createProject({
    name: 'Test collection',
    prompt: 'Layered trail outfits',
    lookCount: count,
  });
  await workbench.upload(p.id, 'report', pdf(), 'report.pdf');
  await workbench.upload(p.id, 'model', await png('red'), 'model.png');
  await workbench.upload(p.id, 'logo', await png('blue'), 'logo.png');
  const task = workbench.createTask(p.id, { kind: 'analysis' });
  const { claim } = workbench.claim(task.id);
  workbench.submitAnalysis(task.id, claim, sampleAnalysis);
  workbench.complete(task.id, claim);
  workbench.confirm(p.id);
  return workbench.store.read().projects.find((item) => item.id === p.id);
}
export async function series(workbench, projectId, colors = ['green', 'yellow']) {
  const task = workbench.createTask(projectId, { kind: 'series' });
  const { claim } = workbench.claim(task.id);
  workbench.submitPlan(
    task.id,
    claim,
    colors.map((_, i) => ({
      slot: i + 1,
      title: `Look ${i + 1}`,
      prompt: `Distinct trail outfit ${i + 1}`,
      designNotes: `Fabric and pattern ${i + 1}`,
    })),
  );
  for (let i = 0; i < colors.length; i++)
    await workbench.submitImage(task.id, claim, i + 1, await png(colors[i]), 'result.png');
  workbench.complete(task.id, claim);
  return workbench.store.read().projects.find((p) => p.id === projectId);
}
