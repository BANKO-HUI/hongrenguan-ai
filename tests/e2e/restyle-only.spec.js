import { test, expect } from '@playwright/test';
import { png } from '../helpers.js';

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
  await page.getByRole('button', { name: '添加图片项目', exact: true }).click();
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
  await expect(page.getByText('当前主图', { exact: true })).toBeVisible();
  const projectOne = page.locator('.project').filter({ hasText: 'source-one' });
  await projectOne.click();
  await expect(projectOne).toContainText('1 次结果', { timeout: 30000 });
  await expect(page.getByText('当前主图', { exact: true })).toBeVisible();
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
