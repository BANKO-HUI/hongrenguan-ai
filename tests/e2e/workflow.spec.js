import { test, expect } from '@playwright/test';
import { png, pdf } from '../helpers.js';
import { unzipSync, strFromU8 } from 'fflate';
import { readFileSync } from 'node:fs';

async function upload(page, label, name, buffer, mimeType) {
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: label, exact: true }).first().click();
  await (await choosing).setFiles({ name, mimeType, buffer });
}
async function completed(page) {
  const card = page.locator('.task-card').first();
  await expect(card.locator('.task-status')).toHaveText('已完成', { timeout: 30000 });
  await card.getByRole('button', { name: /查看结果 \/ 继续工作|查看趋势卡片/ }).click();
}

async function openMore(container) {
  await container.hover();
  await container.getByRole('button', { name: /更多操作$/ }).click();
}

async function verifyImageRail(page, label) {
  const region = page.getByRole('region', { name: label });
  const scrollbar = page.getByRole('scrollbar', { name: `${label}滚动条` });
  await expect(region).toBeVisible();
  await expect(scrollbar).toHaveAttribute('data-scrollable', 'true');
  await region.hover();
  await expect(scrollbar).toHaveCSS('opacity', '1');

  const regionBox = await region.boundingBox();
  const scrollbarBox = await scrollbar.boundingBox();
  expect(scrollbarBox.y).toBeGreaterThanOrEqual(regionBox.y + regionBox.height - 1);

  const before = await region.evaluate((element) => element.scrollLeft);
  await page.mouse.move(scrollbarBox.x + 10, scrollbarBox.y + scrollbarBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    scrollbarBox.x + scrollbarBox.width - 10,
    scrollbarBox.y + scrollbarBox.height / 2,
  );
  await page.mouse.up();
  await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(before);

  await region.focus();
  await page.mouse.move(2, 2);
  await expect(scrollbar).toHaveCSS('opacity', '1');
}

test('desktop UI-only workflow: upload, automatic analysis, edit, generate, restyle, white and ZIP', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('badmark-theme-v1', 'dark'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await page.getByPlaceholder('例如：城市夜跑系列').fill('E2E UI-only trail');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.preflight')).toContainText('选择主趋势');
  await page.getByRole('button', { name: '趋势资料库', exact: false }).first().click();
  await upload(page, '批量上传趋势文件', 'trail-report.pdf', pdf(), 'application/pdf');
  await expect(page.locator('.task-center')).toHaveCount(0);
  const trendCard = page.locator('.shared-card').first();
  await expect(trendCard.getByRole('heading', { name: 'trail-report', exact: true })).toBeVisible();
  await expect(trendCard.locator('.trend-analysis-state strong')).toHaveText('等待解析');
  await trendCard.hover();
  await trendCard.getByRole('button', { name: '开始解析', exact: true }).click();
  await expect(trendCard.locator('.trend-analysis-state strong')).toHaveText('正在解析');
  await trendCard.hover();
  await trendCard.getByRole('button', { name: '暂停解析', exact: true }).click();
  await expect(trendCard.locator('.trend-analysis-state strong')).toHaveText('已暂停');
  await trendCard.hover();
  await trendCard.getByRole('button', { name: '继续解析', exact: true }).click();
  await expect(trendCard.locator('.trend-analysis-state strong')).toHaveText('解析完成', {
    timeout: 30000,
  });
  await expect(trendCard.locator('.shared-card-actions > button')).toHaveCount(2);
  await openMore(trendCard);
  await expect(trendCard.getByRole('button', { name: '重新解析', exact: true })).toBeVisible();
  await trendCard.getByRole('button', { name: /更多操作$/ }).click();
  await page.locator('.top-actions').getByRole('button', { name: /^任务/ }).click();
  await expect(page.getByRole('heading', { name: '任务中心', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'API 管理', exact: false }).click();
  await expect(page.getByLabel('任务模型')).toHaveValue('offline-test-fixture');
  const smartConcurrency = page.locator('.api-smart-concurrency');
  await expect(smartConcurrency).toBeVisible();
  await expect(smartConcurrency).toContainText('智能并发');
  await expect(smartConcurrency).toContainText('不限上限');
  await expect(smartConcurrency).toContainText('同时生成 3 张');
  await expect(smartConcurrency).toContainText(/并行任务 \d+ 项/);
  await expect(page.getByLabel('生成速度')).toHaveCount(0);
  await expect(page.getByLabel('并行任务')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '复制任务指令' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/task-center.png', fullPage: true });
  await page.getByRole('button', { name: '趋势资料库', exact: false }).first().click();
  await expect(
    trendCard.getByRole('heading', { name: 'Outdoor motion', exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => trendCard.locator('img').evaluate((image) => image.naturalWidth))
    .toBeGreaterThan(0);
  await trendCard.hover();
  await trendCard.getByRole('button', { name: '设为主趋势', exact: true }).click();
  await trendCard.locator('.shared-card-cover').click();
  await page.getByRole('button', { name: '修订提炼内容' }).click();
  await page.getByLabel('核心主题', { exact: true }).fill('Lightweight trail');
  await page.getByRole('button', { name: '保存设计方向' }).click();
  await expect(page.getByText('Lightweight trail', { exact: true })).toBeVisible();
  await expect(trendCard.getByRole('button', { name: '删除', exact: true })).toHaveCount(0);
  await openMore(trendCard);
  await trendCard.getByRole('button', { name: '归档', exact: true }).click();
  await page.getByRole('button', { name: /^归档 \d+$/ }).click();
  const archivedTrendCard = page.locator('.shared-card').filter({ hasText: 'Lightweight trail' });
  await openMore(archivedTrendCard);
  await archivedTrendCard.getByRole('button', { name: '永久删除', exact: true }).click();
  await expect(page.getByText(/该趋势正被 1 个项目使用/)).toBeVisible();
  await expect(page.getByRole('button', { name: '删除趋势', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await archivedTrendCard.hover();
  await archivedTrendCard.getByRole('button', { name: '恢复', exact: true }).click();
  await page.getByRole('button', { name: '素材库', exact: false }).first().click();
  await upload(page, '批量上传模特', 'model.png', await png('red'), 'image/png');
  const modelCard = page
    .locator('.shared-card')
    .filter({ has: page.getByRole('heading', { name: 'model', exact: true }) });
  await expect
    .poll(() => modelCard.locator('img').evaluate((image) => image.naturalWidth))
    .toBeGreaterThan(0);
  await modelCard.locator('.shared-card-cover').click();
  const materialPreview = page.getByRole('dialog', { name: 'model 大图预览' });
  await expect(materialPreview).toHaveClass(/lightbox/);
  const materialZoom = materialPreview.locator('.lightbox-stage');
  await materialZoom.hover();
  await page.mouse.wheel(0, -300);
  await expect(materialZoom).toHaveAttribute('data-zoom', '1.25');
  await expect(materialPreview).not.toContainText('正在处理');
  await materialPreview.getByRole('button', { name: '关闭大图', exact: true }).click();
  await modelCard.hover();
  await modelCard.getByRole('button', { name: '裁剪', exact: true }).click();
  await page.getByLabel('裁剪画幅').selectOption('free');
  await expect(page.locator('.crop-controls > p')).toContainText('输出 51 × 77 px');
  const frame = page.getByLabel('可拖动裁剪框');
  const startingCrop = await page.locator('.crop-controls > p').textContent();
  const frameBox = await frame.boundingBox();
  await page.mouse.move(frameBox.x + frameBox.width / 2, frameBox.y + frameBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(frameBox.x + frameBox.width / 2 + 20, frameBox.y + frameBox.height / 2);
  await page.mouse.up();
  await expect(page.locator('.crop-controls > p')).not.toHaveText(startingCrop);
  await page.getByLabel('裁剪画幅').selectOption('1:1');
  await expect(page.locator('.crop-controls > p')).toContainText('输出 64 × 64 px');
  const resizeHandle = page.getByRole('button', { name: '调整裁剪框 se' });
  let resizedWidth = 64;
  for (let attempt = 0; attempt < 3 && resizedWidth >= 64; attempt += 1) {
    const handleBox = await resizeHandle.boundingBox();
    await resizeHandle.hover();
    await page.mouse.down();
    await page.mouse.move(
      handleBox.x + handleBox.width / 2 - 72 - attempt * 20,
      handleBox.y + handleBox.height / 2 - 72 - attempt * 20,
      { steps: 8 },
    );
    await page.mouse.up();
    await page.waitForTimeout(80);
    const text = await page.locator('.crop-controls > p').textContent();
    resizedWidth = Number(text?.match(/输出\s+(\d+)\s+×/)?.[1] || 64);
  }
  expect(resizedWidth).toBeLessThan(64);
  await page.getByRole('button', { name: '保存裁剪', exact: true }).click();
  await expect
    .poll(async () => {
      const state = await (await page.request.get('/api/state')).json();
      const material = state.materialLibrary.items.find((item) => item.title === 'model');
      return material?.crop
        ? {
            square: material.crop.width === material.crop.height,
            reduced: material.crop.width < 64,
          }
        : null;
    })
    .toEqual({ square: true, reduced: true });
  await expect
    .poll(() =>
      modelCard.locator('img').evaluate((image) => ({
        square: image.naturalWidth === image.naturalHeight,
      })),
    )
    .toEqual({ square: true });
  await modelCard.hover();
  await modelCard.getByRole('button', { name: '用于项目' }).click();
  await page.getByLabel('上传素材类型').selectOption('logo');
  await upload(page, '批量上传Logo', 'logo.png', await png('blue'), 'image/png');
  const logoCard = page
    .locator('.shared-card')
    .filter({ has: page.getByRole('heading', { name: 'logo', exact: true }) });
  await expect
    .poll(() => logoCard.locator('img').evaluate((image) => image.naturalWidth))
    .toBeGreaterThan(0);
  await logoCard.hover();
  await logoCard.getByRole('button', { name: '用于项目' }).click();
  await page.getByRole('button', { name: '系列工作台', exact: false }).first().click();
  await expect(page.getByText(/多人组合会保留人数与组合关系/)).toBeVisible();
  await upload(page, '批量上传图案', 'fixed-pattern.png', await png('yellow'), 'image/png');
  await upload(page, '批量上传面料', 'fixed-fabric.png', await png('orange'), 'image/png');
  await upload(page, '批量上传背景', 'fixed-background.png', await png('green'), 'image/png');
  await expect(page.getByText('fixed-pattern', { exact: true })).toBeVisible();
  await expect(page.getByText('fixed-fabric', { exact: true })).toBeVisible();
  await expect(page.getByText('fixed-background', { exact: true })).toBeVisible();
  const fixedReferenceState = await (await page.request.get('/api/state')).json();
  const fixedReferenceProject = fixedReferenceState.projects.find(
    (item) => item.name === 'E2E UI-only trail',
  );
  expect(
    fixedReferenceState.materialLibrary.items.find((item) => item.kind === 'fabric'),
  ).toBeTruthy();
  expect(fixedReferenceProject.patternRefId).toBeTruthy();
  expect(fixedReferenceProject.fabricRefId).toBeTruthy();
  expect(fixedReferenceProject.backgroundRefId).toBeTruthy();
  await expect(page.getByLabel('系列描述')).toHaveValue('');
  await expect(page.getByLabel('系列描述')).toHaveAttribute('placeholder', /案例：面向/);
  await expect(page.getByText(/案例模版：目标人群/)).toBeVisible();
  await page.getByRole('button', { name: '使用趋势生成描述' }).click();
  await page.getByLabel('造型数量', { exact: true }).fill('2');
  await page.getByLabel('Logo 协调', { exact: true }).uncheck();
  await expect(page.getByLabel('Logo 视觉尺寸', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('系列描述')).toHaveValue(/Lightweight trail/);
  await expect(page.getByLabel('造型数量')).toHaveValue('2');
  await page.getByRole('button', { name: '开始生成 2 套', exact: true }).click();
  await expect(page.locator('.task-center')).toHaveCount(0);
  const generationSlots = page.getByRole('region', { name: '系列图片生成进度' });
  await expect(generationSlots).toHaveClass(/generation-slot-rail--filmstrip/);
  await expect(
    generationSlots.locator('xpath=ancestor::*[contains(@class,"filmstrip")]'),
  ).toHaveCount(1);
  await expect(generationSlots.locator('.generation-slot')).toHaveCount(2);
  await expect(generationSlots.locator('[data-slot-state="generating"]')).toHaveCount(2);
  const liveLook = page.locator('.main-stage img[alt="Trail shell 1"]').first();
  await expect(liveLook).toBeVisible({ timeout: 15000 });
  await expect.poll(() => liveLook.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
  const liveRail = page.getByRole('region', { name: '系列成片滚动栏' });
  await expect(liveRail.getByRole('button')).toHaveCount(2, { timeout: 30000 });
  await expect
    .poll(async () => {
      const state = await (await page.request.get('/api/state')).json();
      return state.tasks.find(
        (task) => task.projectId === fixedReferenceProject.id && task.kind === 'series',
      )?.status;
    })
    .toBe('completed');
  await liveRail.getByRole('button', { name: /Trail shell 1/ }).click();
  await page.getByRole('button', { name: '查看 Trail shell 1 大图', exact: true }).click();
  const largePreview = page.getByRole('dialog', { name: /Trail shell 1/ });
  await expect(largePreview).toHaveClass(/image-gallery/);
  await expect(largePreview.locator('.lightbox-stage img')).toHaveCount(1);
  await expect(largePreview.getByRole('button', { name: '当前主图', exact: true })).toBeDisabled();
  await expect(largePreview.getByRole('button', { name: '下载当前', exact: true })).toBeVisible();
  await expect(largePreview).toHaveCSS('position', 'fixed');
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  await expect(largePreview.getByRole('button', { name: '缩小图片' })).toHaveCount(0);
  await largePreview.getByRole('button', { name: '关闭大图', exact: true }).click();
  await page.getByRole('button', { name: '成片管理', exact: false }).first().click();
  await expect(page.locator('.library-card')).toHaveCount(2);
  // Follow the intended image by identity instead of relying on sort order.
  const firstLiveCard = page.locator('.library-card').filter({
    has: page.getByRole('img', { name: 'Trail shell 1', exact: true }),
  });
  await expect(firstLiveCard.getByRole('button', { name: '款式调整', exact: true })).toBeEnabled();
  await firstLiveCard.hover();
  await firstLiveCard
    .getByRole('button', { name: '款式调整', exact: true })
    .evaluate((button) => button.click());
  await expect(page.getByRole('heading', { name: '改款中心', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '选择 Trail shell 1' })).toHaveClass(/active/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const referenceChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '添加参考资料', exact: true }).click();
  await (
    await referenceChooser
  ).setFiles([
    { name: 'scene-reference.png', mimeType: 'image/png', buffer: await png('orange') },
    { name: 'pose-reference.png', mimeType: 'image/png', buffer: await png('purple') },
  ]);
  await expect(page.locator('.restyle-composer .chat-compose-file img')).toHaveCount(2);
  await page
    .getByLabel('改款调整说明', { exact: true })
    .fill('任务并行期间增强服装层次，保持人物和品牌不变。');
  await page.locator('.restyle-prompt-examples summary').click();
  await page.getByRole('button', { name: '场景', exact: true }).click();
  await expect(page.getByLabel('改款调整说明', { exact: true })).toHaveValue(/重点调整场景/);
  await page.locator('.restyle-advanced summary').click();
  await expect(page.getByLabel('Logo 视觉大小')).toHaveCount(0);
  await page.getByLabel('色彩浓度').fill('46');
  await page.getByLabel('服装合体度').fill('58');
  await page.getByRole('button', { name: '开始改款', exact: true }).click();
  await page.locator('.top-actions').getByRole('button', { name: /^任务/ }).click();
  const restyleTask = page.locator('.task-card').first();
  await expect(restyleTask).toContainText('改款中心 · E2E UI-only trail');
  await expect(restyleTask.locator('.task-status')).toHaveText('已完成', { timeout: 30000 });
  await restyleTask
    .getByRole('button', { name: /放大查看任务结果/ })
    .first()
    .click();
  const taskResultPreview = page.getByRole('dialog', { name: /改款中心 · LOOK/ });
  await expect(taskResultPreview).toHaveClass(/image-gallery/);
  await expect(taskResultPreview.locator('.zoomable-image-status')).toContainText('拖动查看');
  await taskResultPreview.getByRole('button', { name: '关闭大图', exact: true }).click();
  await restyleTask.getByRole('button', { name: '查看结果 / 继续工作' }).click();
  await page.getByRole('button', { name: /^任务/ }).click();
  const continuingSeries = page
    .locator('.task-card')
    .filter({ hasText: '系列生成 · E2E UI-only trail' })
    .first();
  await expect(continuingSeries.locator('.task-status')).toHaveText('已完成', { timeout: 30000 });
  await continuingSeries.getByRole('button', { name: '查看结果 / 继续工作' }).click();
  await expect(page.getByText('2 套已生成款式', { exact: true })).toBeVisible();
  const seriesRail = page.getByRole('region', { name: '系列成片滚动栏' });
  const firstSeriesTitle = await seriesRail.locator('button.selected img').getAttribute('alt');
  await seriesRail.locator('button.selected').focus();
  await page.keyboard.press('ArrowRight');
  await expect(seriesRail.locator('button.selected img')).not.toHaveAttribute(
    'alt',
    firstSeriesTitle,
  );
  await page.keyboard.press('ArrowLeft');
  await expect(seriesRail.locator('button.selected img')).toHaveAttribute('alt', firstSeriesTitle);
  await page.getByRole('button', { name: '成片管理', exact: false }).first().click();
  await expect(page.locator('.library-card')).toHaveCount(2);
  const firstFinishedCard = page.locator('.library-card').first();
  const firstGeneratedImage = firstFinishedCard.locator('.preview-image-button img');
  await firstFinishedCard.hover();
  await expect(firstFinishedCard.locator('.look-index-summary')).toHaveText('LOOK 01');
  await expect(firstFinishedCard.locator('.look-secondary-meta')).toContainText('512 × 768 px');
  await expect(firstFinishedCard.locator('.version-stack-badge')).toHaveCount(0);
  await expect(firstFinishedCard).not.toContainText('叠图');
  const imageLayout = await firstGeneratedImage.evaluate((image) => ({
    objectFit: getComputedStyle(image).objectFit,
    displayedRatio: image.clientWidth / image.clientHeight,
    originalRatio: image.naturalWidth / image.naturalHeight,
  }));
  expect(imageLayout.objectFit).toBe('contain');
  expect(Math.abs(imageLayout.displayedRatio - imageLayout.originalRatio)).toBeLessThan(0.02);
  const singleDownloading = page.waitForEvent('download');
  await firstFinishedCard.getByRole('button', { name: '下载', exact: true }).click();
  const singleDownload = await singleDownloading;
  expect(singleDownload.suggestedFilename()).toMatch(/E2E UI-only trail_LOOK_01_scene\.png$/);
  await page.locator('.select-box').first().click();
  await expect(page.getByRole('button', { name: '批量下载 1', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '导出白底', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '补齐白底 1', exact: true }).click();
  await page.locator('.top-actions').getByRole('button', { name: /^任务/ }).click();
  const whiteTask = page
    .locator('.task-card')
    .filter({ hasText: '白底处理 · E2E UI-only trail' })
    .first();
  await expect(whiteTask.locator('.task-status')).toHaveText('已完成', { timeout: 30000 });
  await whiteTask.getByRole('button', { name: '查看结果 / 继续工作' }).click();
  await expect(page.locator('.asset-badge').first()).toHaveText('白底就绪');
  await expect(page.getByRole('button', { name: '补齐白底', exact: true })).toBeDisabled();
  const sceneSource = await firstGeneratedImage.getAttribute('src');
  await firstGeneratedImage.click();
  const preview = page.getByRole('dialog');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('dialog', { name: /Trail shell 2/ })).toBeVisible();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('dialog', { name: /Trail shell 1/ })).toBeVisible();
  await expect(preview.locator('.lightbox-stage img')).toHaveCount(1);
  await expect(preview.locator('.thumbnail-view')).toHaveCount(3);
  await expect(preview.getByRole('button', { name: '全选', exact: true })).toBeVisible();
  await expect(preview.getByRole('button', { name: '反选', exact: true })).toBeVisible();
  await preview.getByRole('button', { name: '全选', exact: true }).click();
  await expect(preview.getByText('已选 3', { exact: true })).toBeVisible();
  await preview.getByRole('button', { name: '反选', exact: true }).click();
  await expect(preview.getByText('已选 0', { exact: true })).toBeVisible();
  await preview.getByRole('button', { name: '全选', exact: true }).click();
  await expect(preview.getByText('已选 3', { exact: true })).toBeVisible();
  await preview.getByRole('button', { name: '轴线', exact: true }).click();
  const leftComparison = preview.getByLabel('对比左图');
  const rightComparison = preview.getByLabel('对比右图');
  await expect(leftComparison.locator('option')).toHaveCount(3);
  await leftComparison.selectOption({ index: 0 });
  await rightComparison.selectOption({ index: 2 });
  await expect(preview.getByRole('button', { name: /^下载/ })).toHaveCount(0);
  await expect(preview.getByRole('group', { name: '批量选择图片' })).toHaveCount(0);
  await preview.getByRole('button', { name: '并排', exact: true }).click();
  await expect(preview.getByRole('button', { name: /^下载/ })).toHaveCount(0);
  await preview.getByRole('button', { name: '画廊', exact: true }).click();
  await expect(preview.getByRole('button', { name: '下载当前', exact: true })).toBeVisible();
  await expect(preview.getByRole('button', { name: '下载所选 3', exact: true })).toBeVisible();
  await expect(preview.locator('.lightbox-stage img')).toHaveAttribute('src', sceneSource);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('dialog', { name: /Trail shell 1 · 白底图/ })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('dialog', { name: /Trail shell 2/ })).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('dialog', { name: /Trail shell 1 · 白底图/ })).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(
    page.getByRole('dialog').getByRole('button', { name: '当前主图', exact: true }),
  ).toBeDisabled();
  await expect(preview.getByRole('button', { name: '下载当前', exact: true })).toBeVisible();
  await expect(preview.getByRole('button', { name: '款式调整', exact: true })).toHaveCount(0);
  await expect(preview.getByRole('button', { name: '爆款裂变', exact: true })).toHaveCount(0);
  await expect(firstGeneratedImage).toHaveAttribute('src', sceneSource);
  const viewport = preview.locator('.lightbox-stage');
  await expect(page.locator('html')).toHaveClass(/image-gallery-open/);
  await expect(page.locator('body')).toHaveClass(/image-gallery-open/);
  const pageScrollBeforeZoom = await page
    .locator('.page-scroll')
    .evaluateAll((nodes) => nodes.map((node) => node.scrollTop));
  const viewportBox = await viewport.boundingBox();
  await page.mouse.move(
    viewportBox.x + viewportBox.width * 0.76,
    viewportBox.y + viewportBox.height * 0.3,
  );
  await page.mouse.wheel(0, -240);
  await expect(viewport).toHaveAttribute('data-zoom', '1.25');
  expect(
    await page.locator('.page-scroll').evaluateAll((nodes) => nodes.map((node) => node.scrollTop)),
  ).toEqual(pageScrollBeforeZoom);
  await expect(viewport).toHaveCSS('cursor', 'grab');
  await expect
    .poll(() =>
      viewport.locator('img').evaluate((image) => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(image).transform);
        return Math.abs(matrix.m41) + Math.abs(matrix.m42);
      }),
    )
    .toBeGreaterThan(1);
  const anchoredTransform = await viewport.locator('img').evaluate((image) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(image).transform);
    return { x: matrix.m41, y: matrix.m42 };
  });
  await page.mouse.move(
    viewportBox.x + viewportBox.width / 2,
    viewportBox.y + viewportBox.height / 2,
  );
  await page.mouse.down();
  await expect(viewport).toHaveCSS('cursor', 'grabbing');
  await page.mouse.move(
    viewportBox.x + viewportBox.width / 2 - 70,
    viewportBox.y + viewportBox.height / 2 - 60,
  );
  await page.mouse.up();
  await expect
    .poll(() =>
      viewport.locator('img').evaluate((image, previous) => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(image).transform);
        return matrix.m41 < previous.x - 40 && matrix.m42 < previous.y - 30;
      }, anchoredTransform),
    )
    .toBe(true);
  await expect(viewport).toHaveCSS('cursor', 'grab');
  await preview.getByRole('button', { name: '关闭大图', exact: true }).click();
  await expect(page.locator('html')).not.toHaveClass(/image-gallery-open/);
  await expect(page.locator('body')).not.toHaveClass(/image-gallery-open/);
  const batchDownloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '批量下载 1', exact: true }).click();
  const batchZip = unzipSync(readFileSync(await (await batchDownloading).path()));
  const batchManifest = JSON.parse(strFromU8(batchZip['manifest.json']));
  expect(batchManifest.looks).toHaveLength(1);
  expect(Object.keys(batchZip)).toContain('images/LOOK_01_scene.png');
  expect(Object.keys(batchZip)).not.toContain('images/LOOK_01_white.png');
  await page.getByRole('button', { name: '历史版本' }).click();
  await expect(page.locator('.history-grid button')).toHaveCount(2);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '交付包', exact: true }).click();
  const zip = unzipSync(readFileSync(await (await downloading).path()));
  expect(JSON.parse(strFromU8(zip['manifest.json'])).looks).toHaveLength(1);
  expect(Object.keys(zip)).toContain('images/LOOK_01_white.png');
  await page.reload();
  await expect(page.locator('.asset-badge').first()).toHaveText('白底就绪');
  await openMore(page.locator('.library-card').last());
  await page
    .locator('.library-card')
    .last()
    .getByRole('button', { name: '归档', exact: true })
    .click();
  await expect(page.locator('.library-card')).toHaveCount(1);
  await page.getByRole('button', { name: '归档 1', exact: true }).click();
  await expect(page.locator('.library-card')).toHaveCount(1);
  await openMore(page.locator('.library-card'));
  await page
    .locator('.library-card')
    .getByRole('button', { name: '永久删除', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: '确定删除成片“Trail shell 2”吗？' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '删除成片', exact: true }).click();
  await expect(page.locator('.library-card')).toHaveCount(0);
  await page.getByRole('button', { name: '全部', exact: true }).click();
  await expect(page.locator('.library-card')).toHaveCount(1);
  await page.getByRole('button', { name: '历史版本', exact: true }).click();
  await expect(page.getByRole('heading', { name: /删除成片/ })).toBeVisible();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  const retainedSource = await page
    .locator('.library-card .preview-image-button img')
    .first()
    .getAttribute('src');
  await page.getByRole('button', { name: '系列工作台', exact: false }).first().click();
  await page.getByLabel('造型数量', { exact: true }).fill('1');
  await expect(page.getByText('当前 1 套成片会保留，本次结果将继续追加。')).toBeVisible();
  await page.getByRole('button', { name: '新增生成 1 套', exact: true }).click();
  await page.locator('.top-actions').getByRole('button', { name: /^任务/ }).click();
  await completed(page);
  await expect(page.getByText('2 套已生成款式', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '成片管理', exact: false }).first().click();
  await expect(page.locator('.library-card')).toHaveCount(2);
  expect(
    await page
      .locator('.library-card .preview-image-button img')
      .evaluateAll((images) => images.map((image) => image.getAttribute('src'))),
  ).toContain(retainedSource);
  const viralSourceCard = page.locator('.library-card').first();
  const viralSourceTitle = await viralSourceCard.locator('.library-card-meta b').textContent();
  await openMore(viralSourceCard);
  await viralSourceCard.getByRole('button', { name: '加入爆款裂变', exact: true }).click();
  await expect(page.getByRole('heading', { name: '爆款裂变', exact: true })).toBeVisible();
  await expect(page.locator('.source-look-strip button.active img')).toHaveAttribute(
    'alt',
    viralSourceTitle,
  );
  await expect(page.locator('.trend-prompt-options > button')).toHaveCount(5);
  await page.locator('.trend-prompt-options > button').first().click();
  await page.getByLabel('裂变生成数量').fill('1');
  await page.getByRole('button', { name: '开始裂变 1 款', exact: true }).click();
  await expect(page.locator('.design-results img')).toHaveCount(1, { timeout: 30000 });
  const viralResultSource = await page.locator('.design-results img').getAttribute('src');
  await page.getByRole('button', { name: '在画布查看裂变 1', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const viralInlinePreview = page.locator('.viral-source-preview .viral-source-zoom');
  await expect(viralInlinePreview.locator('img')).toHaveAttribute('src', viralResultSource);
  await viralInlinePreview.scrollIntoViewIfNeeded();
  const viralPageScroll = await page.locator('.page-scroll').evaluate((node) => node.scrollTop);
  const viralPreviewBox = await viralInlinePreview.boundingBox();
  await page.mouse.move(
    viralPreviewBox.x + viralPreviewBox.width * 0.7,
    viralPreviewBox.y + viralPreviewBox.height * 0.35,
  );
  await page.mouse.wheel(0, -180);
  await expect(viralInlinePreview).toHaveAttribute('data-zoom', '1.25');
  expect(await page.locator('.page-scroll').evaluate((node) => node.scrollTop)).toBe(
    viralPageScroll,
  );
  const viralState = await (await page.request.get('/api/state')).json();
  const savedViral = viralState.tasks.find((task) => task.kind === 'viral');
  expect(savedViral.lookIds).toHaveLength(1);
  expect(
    viralState.projects
      .find((item) => item.name === 'E2E UI-only trail')
      .looks.some((look) => look.id === savedViral.lookIds[0]),
  ).toBeTruthy();
  expect(savedViral.instruction).toContain('趋势报告提取方向');
  expect(savedViral.instruction).toContain('统一约束');
  await page.getByRole('button', { name: '成片管理', exact: false }).first().click();
  await page
    .locator('.library-tabs')
    .getByRole('button', { name: '爆款裂变', exact: true })
    .click();
  await expect(page.locator('.library-card')).toHaveCount(1);
  await expect(page.locator('.origin-badge')).toHaveText('爆款裂变');
  await page.screenshot({ path: 'test-results/desktop-workflow.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('restyle annotations and bestseller variations start directly from their workspaces', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await page.getByPlaceholder('例如：城市夜跑系列').fill('E2E restyle and viral');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await page.getByRole('button', { name: '改款中心', exact: false }).first().click();
  await upload(page, '上传图片', 'source.png', await png('red'), 'image/png');
  await expect(page.getByLabel('改款调整说明')).toHaveValue('');
  const composerMetrics = await page.locator('.restyle-native-composer').evaluate((composer) => {
    const textarea = composer.querySelector('textarea');
    const composerBox = composer.getBoundingClientRect();
    const textareaBox = textarea.getBoundingClientRect();
    return {
      widthGap: composerBox.width - textareaBox.width,
      textareaHeight: textareaBox.height,
    };
  });
  expect(composerMetrics.widthGap).toBeLessThanOrEqual(24);
  expect(composerMetrics.textareaHeight).toBeGreaterThanOrEqual(197.5);
  await expect(page.getByRole('button', { name: '妆发', exact: true })).toBeHidden();
  const annotationStage = page.locator('.annotation-image-wrap');
  await expect(annotationStage).toBeVisible();
  const wheelPrevented = await annotationStage.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: box.left + box.width * 0.72,
      clientY: box.top + box.height * 0.28,
      deltaY: -240,
    });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(wheelPrevented).toBeTruthy();
  await expect(annotationStage).toHaveAttribute('data-zoom', '1.25');
  const zoomedTransform = await annotationStage
    .locator('.annotation-image-content')
    .evaluate((element) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
      return [matrix.m41, matrix.m42];
    });
  const zoomedStageBox = await annotationStage.boundingBox();
  await page.mouse.move(
    zoomedStageBox.x + zoomedStageBox.width / 2,
    zoomedStageBox.y + zoomedStageBox.height / 2,
  );
  await annotationStage.focus();
  await page.keyboard.down('Space');
  await page.mouse.down();
  await page.mouse.move(
    zoomedStageBox.x + zoomedStageBox.width / 2 + 36,
    zoomedStageBox.y + zoomedStageBox.height / 2 + 24,
  );
  await page.mouse.up();
  await page.keyboard.up('Space');
  await expect
    .poll(() =>
      annotationStage.locator('.annotation-image-content').evaluate((element, previous) => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
        return Math.max(Math.abs(matrix.m41 - previous[0]), Math.abs(matrix.m42 - previous[1]));
      }, zoomedTransform),
    )
    .toBeGreaterThan(20);
  await page.getByRole('button', { name: '重置大图缩放', exact: true }).click();
  await expect(annotationStage).toHaveAttribute('data-zoom', '1.00');
  await expect(page.getByRole('button', { name: '开启局部图层', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.getByText(/传统整图改款/)).toBeVisible();
  await page.getByRole('button', { name: '开启局部图层', exact: true }).click();
  await page.getByRole('button', { name: '圆形', exact: true }).click();
  await annotationStage.scrollIntoViewIfNeeded();
  const annotationSurface = annotationStage.locator('.annotation-image-content');
  const stageBox = await annotationSurface.boundingBox();
  await page.mouse.move(stageBox.x + stageBox.width * 0.2, stageBox.y + stageBox.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(stageBox.x + stageBox.width * 0.5, stageBox.y + stageBox.height * 0.5);
  await page.mouse.up();
  await expect(annotationStage.locator('ellipse')).toHaveCount(1);
  await expect(annotationStage.locator('ellipse')).not.toHaveAttribute('stroke');
  await page.getByRole('button', { name: '隐藏标注色块', exact: true }).click();
  await expect(annotationStage.locator('svg')).toHaveCount(0);
  await page.getByRole('button', { name: '显示标注色块', exact: true }).click();
  await expect(annotationStage.locator('ellipse')).toHaveCount(1);
  await expect(page.locator('.restyle-composer .restyle-region-list')).toBeVisible();
  await expect(page.getByLabel('改款调整说明')).toHaveValue(/@红色区域/);
  await expect(page.getByText(/只截取调整区附近生成透明补丁/)).toBeVisible();
  await expect(page.locator('.restyle-region-chip')).toHaveCount(1);
  await page.getByRole('button', { name: '关闭局部图层', exact: true }).click();
  await expect(page.getByRole('button', { name: '圆形', exact: true })).toBeVisible();
  await expect(page.locator('.restyle-region-chip')).toHaveCount(1);
  await expect(page.getByText(/标注会作为调整指引/)).toBeVisible();
  await page.getByRole('button', { name: '开启局部图层', exact: true }).click();
  await page.getByRole('button', { name: '方形', exact: true }).click();
  await page.getByRole('button', { name: '选择绿色画笔', exact: true }).click();
  const greenStageBox = await annotationSurface.boundingBox();
  await annotationSurface.click({
    position: { x: greenStageBox.width * 0.3, y: greenStageBox.height * 0.65 },
  });
  await expect(annotationStage.locator('rect')).toHaveCount(1);
  await expect(annotationStage.locator('rect')).not.toHaveAttribute('stroke');
  await expect(page.getByLabel('改款调整说明')).toHaveValue(/@绿色区域/);
  await page.getByRole('button', { name: '涂鸦', exact: true }).click();
  await page.getByRole('button', { name: '涂鸦粗笔', exact: true }).click();
  await page.getByRole('button', { name: '锁定区', exact: true }).click();
  await page.getByLabel('自定义画笔颜色').fill('#123456');
  await expect(page.getByText('自定义色 #123456', { exact: true })).toBeVisible();
  const updatedStageBox = await annotationSurface.boundingBox();
  await annotationSurface.click({
    position: { x: updatedStageBox.width * 0.7, y: updatedStageBox.height * 0.28 },
  });
  await expect(page.getByLabel('改款调整说明')).toHaveValue(/@自定义色 #123456区域/);
  const referenceChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '添加参考资料', exact: true }).click();
  await (
    await referenceChooser
  ).setFiles({ name: '面料参考.png', mimeType: 'image/png', buffer: await png('blue') });
  await expect(page.locator('.restyle-composer .chat-compose-file')).toHaveCount(1);
  await page.getByRole('button', { name: '放大参考图 面料参考.png', exact: true }).click();
  const referencePreview = page.getByRole('dialog', { name: '@面料参考 大图预览' });
  await expect(referencePreview.getByRole('img', { name: '@面料参考' })).toBeVisible();
  await referencePreview.getByRole('button', { name: '关闭大图', exact: true }).click();
  await page.getByRole('button', { name: '在调整说明中调用 @面料参考', exact: true }).click();
  await expect(page.getByLabel('改款调整说明')).toHaveValue(/@面料参考/);
  await page.screenshot({ path: 'test-results/restyle-unified-composer.png', fullPage: true });
  await page.locator('.restyle-prompt-examples summary').click();
  await page.getByRole('button', { name: '妆发', exact: true }).click();
  await page.locator('.restyle-advanced summary').click();
  await page.getByRole('button', { name: '商品白底', exact: true }).click();
  await expect(page.getByText(/白底属于全图调整/)).toBeVisible();
  await page.getByRole('button', { name: '场景图', exact: true }).click();
  await expect(page.getByText(/只截取调整区附近生成透明补丁/)).toBeVisible();
  await expect(page.getByLabel('Logo 视觉大小')).toHaveCount(0);
  await page.getByLabel('色彩浓度').fill('40');
  await page.getByLabel('服装合体度').fill('65');
  await page.getByRole('button', { name: '开始改款', exact: true }).click();
  await expect(page.locator('.task-center')).toHaveCount(0);
  await expect(page.locator('.generation-pulse')).toBeVisible();
  await expect(
    page.getByRole('region', { name: '实时图片生成进度' }).locator('.generation-slot'),
  ).toHaveCount(1);
  await expect(page.locator('.design-results img')).toHaveCount(3, { timeout: 30000 });
  const resultRail = page.getByRole('region', { name: '实时结果缩略图' });
  const resultButton = resultRail.getByRole('button', { name: /在画布查看改款结果/ });
  await resultButton.click();
  await expect(page.locator('.restyle-result-canvas')).toBeVisible();
  await expect(
    page.locator('.restyle-result-canvas').getByRole('img', { name: /改款结果/ }),
  ).toBeVisible();
  await expect(page.getByRole('dialog', { name: /改款结果/ })).toHaveCount(0);
  await resultRail.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(annotationStage).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.restyle-result-canvas')).toBeVisible();
  const restyleState = await (await page.request.get('/api/state')).json();
  const savedRestyle = restyleState.tasks.find((task) => task.kind === 'restyle');
  expect(savedRestyle.background).toBe('scene');
  expect(savedRestyle.annotations.map((item) => item.mode)).toEqual(['adjust', 'adjust', 'lock']);
  expect(savedRestyle.annotations.map((item) => item.type)).toEqual(['circle', 'rect', 'brush']);
  expect(savedRestyle.annotations.map((item) => [item.colorName, item.color])).toEqual([
    ['红色', '#ef4444'],
    ['绿色', '#22a06b'],
    ['自定义色 #123456', '#123456'],
  ]);
  expect(savedRestyle.referenceLabels).toEqual(['@面料参考']);
  expect(savedRestyle.annotations.map((item) => item.strokeWidth)).toEqual([6, 6, 72]);
  expect(savedRestyle.instruction).toContain('自动按服装廓形、版片空间与整体构图协调其大小和位置');
  expect(savedRestyle.instruction).not.toContain('Logo 视觉大小');
  expect(savedRestyle.instruction).toContain('色彩浓度 40%');
  expect(savedRestyle.instruction).toContain('服装合体度 65%');

  const restyledLook = restyleState.projects
    .flatMap((project) => project.looks)
    .find((look) => look.originKind === 'restyle');
  expect(restyledLook.editLayers).toHaveLength(1);
  const layerPanel = page.getByRole('region', { name: '改款图层面板' });
  await expect(layerPanel).toBeVisible();
  await expect(layerPanel.locator('.look-layer-list article')).toHaveCount(2);
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
  await layerPanel.getByLabel('图层名称 1').fill('细节方案 A');
  await layerPanel.getByRole('button', { name: '更新预览', exact: true }).click();
  await layerPanel.getByRole('button', { name: '合并已勾选图层', exact: true }).click();
  await expect(layerPanel).toContainText('标注区会截取生成并保留为独立图层');
  await expect(layerPanel.locator('.look-layer-list article')).toHaveCount(1);
  await layerPanel.locator('.layer-history summary').click();
  await expect(layerPanel.locator('.layer-history li')).toContainText('已合并');
  const mergedState = await (await page.request.get('/api/state')).json();
  const mergedLook = mergedState.projects
    .flatMap((project) => project.looks)
    .find((look) => look.id === restyledLook.id);
  expect(mergedLook.editLayers).toEqual([]);
  expect(mergedLook.layerHistory.at(-1).action).toBe('merge');

  await page.getByRole('button', { name: '爆款裂变', exact: false }).first().click();
  await page.getByRole('button', { name: '改款中心', exact: false }).first().click();
  const restoredLayerPanel = page.getByRole('region', { name: '改款图层面板' });
  await expect(restoredLayerPanel.locator('.layer-history summary')).toContainText('历史操作 1');
  await restoredLayerPanel.locator('.layer-history summary').click();
  await expect(restoredLayerPanel.locator('.layer-history li')).toHaveCount(1);
  await restoredLayerPanel.getByRole('button', { name: /删除图层历史/ }).click();
  await expect(restoredLayerPanel.locator('.layer-history')).toHaveCount(0);
  await page.getByRole('button', { name: '爆款裂变', exact: false }).first().click();
  await upload(page, '上传图片', 'bestseller.png', await png('orange'), 'image/png');
  await page.getByLabel('裂变生成数量').fill('2');
  await page.getByRole('button', { name: '开始裂变 2 款', exact: true }).click();
  await expect(page.locator('.task-center')).toHaveCount(0);
  await expect(page.locator('.generation-pulse')).toBeVisible();
  await expect(
    page.getByRole('region', { name: '实时图片生成进度' }).locator('.generation-slot'),
  ).toHaveCount(2);
  await expect(page.locator('.design-results img')).toHaveCount(2, { timeout: 30000 });
  await page.getByRole('button', { name: '成片管理', exact: false }).first().click();
  await expect(page.locator('.library-card')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('finished-image entry preselects its look and the restyle layout stays contained', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '成片管理', exact: false }).first().click();
  const sourceCard = page.locator('.library-card').nth(1);
  const sourceTitle = await sourceCard.locator('.library-card-meta b').textContent();
  await sourceCard.getByRole('button', { name: `查看 ${sourceTitle} 大图`, exact: true }).click();
  const preview = page.getByRole('dialog');
  await expect(preview.getByRole('button', { name: '款式调整', exact: true })).toHaveCount(0);
  await preview.getByRole('button', { name: '关闭大图', exact: true }).click();
  await sourceCard.getByRole('button', { name: '款式调整', exact: true }).click();
  await expect(page.getByRole('heading', { name: '改款中心', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: `选择 ${sourceTitle}`, exact: true })).toHaveClass(
    /active/,
  );
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('region', { name: '改款图层面板' })).toBeVisible();

  for (const width of [1440, 1100, 900, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (width <= 820 && (await page.getByRole('button', { name: '收起侧边栏' }).isVisible()))
      await page.getByRole('button', { name: '收起侧边栏' }).click();
    await page.waitForTimeout(300);
    const layout = await page.evaluate(() => {
      const root = document.querySelector('.design-workspace');
      const grid = document.querySelector('.design-grid');
      const source = document.querySelector('.source-selector');
      const canvas = document.querySelector('.annotation-panel');
      const controls = document.querySelector('.design-controls');
      const rootBox = root.getBoundingClientRect();
      const boxes = [source, canvas, controls].map((element) => element.getBoundingClientRect());
      return {
        contained: boxes.every(
          (box) => box.left >= rootBox.left - 1 && box.right <= rootBox.right + 1,
        ),
        overflowFree: root.scrollWidth <= root.clientWidth + 1,
        singleColumn: getComputedStyle(grid).gridTemplateColumns.split(' ').length === 1,
        naturalOrder: controls.getBoundingClientRect().top >= canvas.getBoundingClientRect().bottom,
      };
    });
    expect(layout.contained).toBeTruthy();
    expect(layout.overflowFree).toBeTruthy();
    if (width <= 1100) {
      expect(layout.singleColumn).toBeTruthy();
      expect(layout.naturalOrder).toBeTruthy();
    }
  }
});

test('mobile filtering clears hidden selections; cancellation and retry need no chat', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '打开侧边栏' }).click();
  await page.getByRole('button', { name: '趋势资料库', exact: false }).first().click();
  await expect(page.locator('.masonry-library')).toBeVisible();
  await page.getByLabel('搜索趋势资料').fill('Mountain');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.getByRole('button', { name: '打开侧边栏' }).click();
  await page.getByRole('button', { name: '成片管理', exact: false }).first().click();
  await expect(page.locator('.library-card')).toHaveCount(12);
  await page.getByLabel('搜索素材').fill('LOOK 01');
  await expect(page.locator('.library-card')).toHaveCount(1);
  await page.getByRole('button', { name: '选择当前', exact: true }).click();
  await expect(page.getByRole('button', { name: '补齐白底', exact: true })).toBeDisabled();
  await page.getByLabel('搜索素材').fill('LOOK 02');
  await expect(page.getByText('已选择 0 / 12', { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const state = await fetch('/api/state').then((response) => response.json());
    if (!state.executor.paused) {
      await fetch('/api/executor/control', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'pause' }),
      });
    }
  });
  await page.locator('.library-card').first().hover();
  const holdIndependentStart = async (route) => {
    const body = route.request().postDataJSON();
    if (body?.action !== 'start-task') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ready: true, paused: true }),
    });
  };
  await page.route('**/api/executor/control', holdIndependentStart);
  await page.getByRole('button', { name: '更新白底', exact: true }).click();
  await expect
    .poll(async () => {
      return page.evaluate(async () => {
        const state = await fetch('/api/state').then((response) => response.json());
        return state.tasks.some(
          (candidate) => candidate.kind === 'white' && candidate.status === 'pending',
        );
      });
    })
    .toBe(true);
  await page.locator('.top-actions').getByRole('button', { name: /^任务/ }).click();
  await expect(page.getByRole('heading', { name: '任务中心', exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  const card = page.locator('.task-card').first();
  await openMore(card);
  await card.getByRole('button', { name: '结束任务' }).click();
  await expect(card.locator('.task-status')).toHaveText('已结束');
  await card.getByRole('button', { name: /继续缺少的|保留结果并重试/ }).click();
  await expect(card.locator('.task-status')).toHaveText(/排队中|正在执行/);
  await openMore(card);
  await card.getByRole('button', { name: '结束任务' }).click();
  await page.unroute('**/api/executor/control', holdIndependentStart);
  const taskCount = await page.locator('.task-card').count();
  await openMore(card);
  await card.getByRole('button', { name: '删除任务记录' }).click();
  await expect(page.getByText(/趋势资料和已生成图片都会保留/)).toBeVisible();
  await page.getByRole('button', { name: '删除记录', exact: true }).click();
  await expect(page.locator('.task-card')).toHaveCount(taskCount - 1);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.getByRole('button', { name: '打开侧边栏' }).click();
  await page.getByRole('button', { name: '系列工作台', exact: false }).first().click();
  await expect(page.getByLabel('系列描述')).toBeVisible();
  await verifyImageRail(page, '系列成片滚动栏');
  await page.getByRole('button', { name: '打开侧边栏' }).click();
  await page.getByRole('button', { name: '改款中心', exact: false }).first().click();
  await verifyImageRail(page, '改款原图滚动栏');
  await page.getByRole('button', { name: '打开侧边栏' }).click();
  await page.getByRole('button', { name: '爆款裂变', exact: false }).first().click();
  await verifyImageRail(page, '爆款原图滚动栏');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: 'test-results/mobile-workflow.png', fullPage: true });
});
