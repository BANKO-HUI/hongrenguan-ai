import { test, expect } from '@playwright/test';
import { png } from '../helpers.js';

test('restyle-only workflow uploads, generates, manages and white-backgrounds a finished image', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.getByText('红人馆AI', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /改款中心/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /成片管理/ })).toBeVisible();
  for (const removed of ['Chat模式', '系列工作台', '爆款裂变', '趋势资料库', '素材库', '新建项目'])
    await expect(page.getByText(removed, { exact: true })).toHaveCount(0);
  await expect(page.getByText(/图层/)).toHaveCount(0);

  const choosingSource = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '上传图片', exact: true }).click();
  await (await choosingSource).setFiles({
    name: 'source.png',
    mimeType: 'image/png',
    buffer: await png('red'),
  });
  await page.getByLabel('改款调整说明').fill('把上衣改成深蓝色短款夹克，保持人物和裤装不变。');
  await page.getByRole('button', { name: '开始改款', exact: true }).click();

  await expect(page.getByText('改款结果', { exact: true }).last()).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: /成片管理/ }).click();
  await expect(page.getByRole('heading', { name: '成片管理', exact: true })).toBeVisible();
  const finishedCard = page.locator('.finished-card, .library-card').filter({ hasText: '改款' }).first();
  await expect(finishedCard).toBeVisible();
  await finishedCard.hover();
  await expect(finishedCard.getByRole('button', { name: '款式调整', exact: true })).toBeVisible();

  await finishedCard.getByRole('button', { name: '生成白底', exact: true }).click();
  await expect(finishedCard.getByText('白底就绪', { exact: true })).toBeVisible({ timeout: 30000 });
});
