import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { png } from '../helpers.js';

test('rapid light and dark switching never blanks the workbench', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('badmark-theme-v1', 'dark'));
  await page.goto('/');
  await expect(page.locator('.app-shell')).toBeVisible();

  for (let index = 0; index < 8; index += 1) {
    const current = index % 2 === 0 ? 'dark' : 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    await page
      .getByRole('button', { name: `切换为${next === 'light' ? '浅色' : '深色'}模式` })
      .click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', next);
    await expect(page.locator('.app-shell')).toBeVisible();

    const surfaces = await page.evaluate(() => {
      const root = document.documentElement;
      const shell = document.querySelector('.app-shell');
      const center = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      return {
        root: getComputedStyle(root).backgroundColor,
        body: getComputedStyle(document.body).backgroundColor,
        shellDisplay: getComputedStyle(shell).display,
        shellVisibility: getComputedStyle(shell).visibility,
        shellOpacity: Number(getComputedStyle(shell).opacity),
        centerTag: center?.tagName,
      };
    });
    const expectedBackground = next === 'light' ? 'rgb(238, 240, 243)' : 'rgb(12, 12, 12)';
    expect(surfaces.root).toBe(expectedBackground);
    expect(surfaces.body).toBe(expectedBackground);
    expect(surfaces.shellDisplay).not.toBe('none');
    expect(surfaces.shellVisibility).toBe('visible');
    expect(surfaces.shellOpacity).toBe(1);
    expect(['HTML', 'BODY']).not.toContain(surfaces.centerTag);

    const screenshot = await page.screenshot();
    const stats = await sharp(screenshot).stats();
    expect(Math.max(...stats.channels.slice(0, 3).map((channel) => channel.stdev))).toBeGreaterThan(
      8,
    );
  }
  expect(pageErrors).toEqual([]);
});

test('navigation, project switching and reload preserve unfinished choices', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');
  const choosingProjects = page.waitForEvent('filechooser');
  await page.locator('.new-project').click();
  await (
    await choosingProjects
  ).setFiles([
    { name: 'draft-one.png', mimeType: 'image/png', buffer: await png('red') },
    { name: 'draft-two.png', mimeType: 'image/png', buffer: await png('blue') },
  ]);
  await expect(page.locator('.project')).toHaveCount(2);

  await page.getByLabel('改款调整说明').fill('保留这条尚未提交的改款说明。');
  const choosingReference = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '添加参考资料', exact: true }).click();
  await (
    await choosingReference
  ).setFiles({
    name: 'collar-reference.png',
    mimeType: 'image/png',
    buffer: await png('green'),
  });
  await expect(page.getByText('参考图片 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '涂鸦', exact: true })).toHaveClass(/active/);
  await expect(page.getByRole('button', { name: '涂鸦极细笔', exact: true })).toHaveClass(/active/);
  const annotationSurface = page.locator('.annotation-image-content');
  const annotationBox = await annotationSurface.boundingBox();
  await page.mouse.move(
    annotationBox.x + annotationBox.width * 0.35,
    annotationBox.y + annotationBox.height * 0.35,
  );
  await page.mouse.down();
  await page.mouse.move(
    annotationBox.x + annotationBox.width * 0.65,
    annotationBox.y + annotationBox.height * 0.55,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(page.locator('.annotation-image-wrap polyline')).toHaveCount(1);
  await expect(page.locator('.app-shell')).toBeVisible();
  expect(pageErrors).toEqual([]);
  await page.getByText('更多调整', { exact: true }).click();
  await page.getByRole('button', { name: '商品白底', exact: true }).click();
  await page.getByLabel('色彩浓度').fill('67');

  await page.getByRole('button', { name: /成片管理/ }).click();
  await page.getByRole('button', { name: /改款中心/ }).click();
  await expect(page.getByLabel('改款调整说明')).toHaveValue(
    /保留这条尚未提交的改款说明。.*@红色区域/,
  );
  await expect(page.getByText('参考图片 1', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: /成片管理/ }).click();
  await page.locator('.project').filter({ hasText: 'draft-two' }).click();
  await expect(page.getByRole('heading', { name: '改款中心', exact: true })).toBeVisible();
  await page.locator('.project').filter({ hasText: 'draft-one' }).click();
  await expect(page.getByLabel('改款调整说明')).toHaveValue(
    /保留这条尚未提交的改款说明。.*@红色区域/,
  );
  await expect(page.getByText('参考图片 1', { exact: true })).toBeVisible();

  await page.locator('.account').click();
  await page.getByRole('button', { name: /API 管理/ }).click();
  await page.getByRole('button', { name: /改款中心/ }).click();
  await page.locator('.account').click();
  await expect(page.getByRole('heading', { name: 'API 管理', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /改款中心/ }).click();

  await page.reload();
  await expect(page.getByLabel('改款调整说明')).toHaveValue(
    /保留这条尚未提交的改款说明。.*@红色区域/,
  );
  await expect(page.getByText('参考图片 1', { exact: true })).toBeVisible();
  await page.getByText('更多调整', { exact: true }).click();
  await expect(page.getByRole('button', { name: '商品白底', exact: true })).toHaveClass(/active/);
  await expect(page.getByLabel('色彩浓度')).toHaveValue('67');
});

test('one image per project preserves history while multiple restyle tasks run together', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.getByText('红人馆AI', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.brand-mark img')).toHaveAttribute(
    'src',
    '/assets/hongrenguan-icon.png',
  );
  await expect(page.locator('.startup-screen, .login-screen')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /改款中心/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /成片管理/ })).toBeVisible();
  for (const removed of ['Chat模式', '系列工作台', '爆款裂变', '趋势资料库', '素材库', '新建项目'])
    await expect(page.getByText(removed, { exact: true })).toHaveCount(0);
  await expect(page.getByText(/图层/)).toHaveCount(0);

  const choosingProjects = page.waitForEvent('filechooser');
  await page.locator('.new-project').click();
  await (
    await choosingProjects
  ).setFiles([
    { name: 'source-one.png', mimeType: 'image/png', buffer: await png('red') },
    { name: 'source-two.png', mimeType: 'image/png', buffer: await png('blue') },
  ]);
  await expect(page.locator('.project')).toHaveCount(2);
  await expect(page.locator('.project').filter({ hasText: 'source-one' })).toBeVisible();
  await expect(page.locator('.project').filter({ hasText: 'source-two' })).toBeVisible();

  await page.getByLabel('改款调整说明').fill('把上衣改成深蓝色短款夹克，保持人物和裤装不变。');
  await page.getByRole('button', { name: '开始改款', exact: true }).click();

  await page.locator('.project').filter({ hasText: 'source-two' }).click();
  await page.getByLabel('改款调整说明').fill('把外套改成米白色风衣，保持人物姿态不变。');
  await page.getByRole('button', { name: '开始改款', exact: true }).click();
  await expect(page.locator('.image-project-running')).toHaveCount(2, { timeout: 2500 });

  const projectTwo = page.locator('.project').filter({ hasText: 'source-two' });
  await expect(projectTwo).toContainText('1 次结果', { timeout: 30000 });
  await expect(page.getByRole('button', { name: /选择 改款/ })).toBeVisible();
  const projectOne = page.locator('.project').filter({ hasText: 'source-one' });
  await projectOne.click();
  await expect(projectOne).toContainText('1 次结果', { timeout: 30000 });
  await expect(page.getByRole('button', { name: /选择 改款/ })).toBeVisible();
  await page.getByRole('button', { name: /成片管理/ }).click();
  await expect(page.getByRole('heading', { name: '成片管理', exact: true })).toBeVisible();
  const finishedCard = page
    .locator('.finished-card, .library-card')
    .filter({ hasText: '改款' })
    .first();
  await expect(finishedCard).toBeVisible();
  await finishedCard.hover();
  await expect(finishedCard.getByRole('button', { name: '款式调整', exact: true })).toBeVisible();

  await page.getByRole('button', { name: '操作历史', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '操作历史', exact: true })).toBeVisible();
  await expect(page.getByText('项目原图', { exact: true })).toBeVisible();
  await expect(page.getByText('任务记录', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭' }).click();

  await finishedCard.hover();
  await finishedCard.getByRole('button', { name: '生成白底', exact: true }).click();
  await expect(finishedCard.getByText('白底就绪', { exact: true })).toBeVisible({ timeout: 30000 });
});
