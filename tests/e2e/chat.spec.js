import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

async function expectDarkViewport(page, label) {
  const findings = await page.locator('body *').evaluateAll((elements) => {
    const parse = (value) => {
      const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
      return match
        ? [
            Number(match[1]),
            Number(match[2]),
            Number(match[3]),
            match[4] === undefined ? 1 : Number(match[4]),
          ]
        : null;
    };
    const luminance = (color) =>
      color ? color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722 : 0;
    const intentionalLight = [
      '.export-button',
      '.primary-action',
      '.generate-button',
      '.primary-card-action',
      '.modal-actions .primary',
      '.login-primary',
      '.chat-native-send',
    ].join(',');
    return elements.flatMap((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (
        rect.width < 36 ||
        rect.height < 18 ||
        rect.bottom < 0 ||
        rect.top > innerHeight ||
        rect.right < 0 ||
        rect.left > innerWidth ||
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        Number(style.opacity) === 0 ||
        element.matches(intentionalLight)
      )
        return [];
      const background = parse(style.backgroundColor);
      const foreground = parse(style.color);
      const lightSurface = background && background[3] > 0.5 && luminance(background) > 165;
      const lowContrast =
        background &&
        foreground &&
        background[3] > 0.8 &&
        foreground[3] > 0.8 &&
        Math.abs(luminance(background) - luminance(foreground)) < 78 &&
        (element.textContent || '').trim();
      return lightSurface || lowContrast
        ? [
            {
              tag: element.tagName.toLowerCase(),
              className: typeof element.className === 'string' ? element.className : '',
              background: style.backgroundColor,
              foreground: style.color,
              text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
            },
          ]
        : [];
    });
  });
  expect(findings, `${label} 不应出现意外浅色表面或低对比文字`).toEqual([]);
}

test('浅色模式可切换并在刷新后保留', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('badmark-theme-v1', 'dark'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '切换为浅色模式' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('button', { name: '切换为深色模式' })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe('rgb(238, 240, 243)');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('button', { name: '切换为深色模式' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('button', { name: '切换为深色模式' })).toBeVisible();
});

test('浅色模式覆盖改款与后续新增工作流表面', async ({ page }) => {
  const expectLightSurface = async (locator, label) => {
    await expect(locator, `${label} 应可见`).toBeVisible();
    const luminance = await locator.evaluate((element) => {
      const values =
        getComputedStyle(element)
          .backgroundColor.match(/[\d.]+/g)
          ?.map(Number) || [];
      return values.length >= 3 ? values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722 : 0;
    });
    expect(luminance, `${label} 不应残留深色模式底色`).toBeGreaterThan(210);
  };

  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('badmark-theme-v1', 'light'));
  await page.reload();

  await page.getByRole('button', { name: /^改款中心/ }).click();
  await expectLightSurface(page.locator('.restyle-layer-panel'), '改款图层面板');
  await expectLightSurface(page.locator('.restyle-prompt-examples summary'), '改款提示词案例');
  await expectLightSurface(page.locator('.source-selector'), '改款原图选择器');

  await page.getByRole('button', { name: /^爆款裂变/ }).click();
  await expectLightSurface(page.locator('.trend-prompt-panel'), '趋势方向面板');
  await expectLightSurface(page.locator('.direction-editor'), '裂变方向面板');

  await page.getByRole('button', { name: /^趋势资料库/ }).click();
  await expectLightSurface(page.locator('.shared-library-toolbar'), '趋势资料工具栏');

  await page.getByRole('button', { name: /^成片管理/ }).click();
  await expectLightSurface(page.locator('.library-toolbar'), '成片工具栏');

  await page.getByRole('button', { name: /^设置/ }).click();
  await page.getByRole('button', { name: /^记忆/ }).click();
  await expectLightSurface(page.locator('.memory-switch'), '记忆开关');
  await page.getByRole('button', { name: /^任务中心/ }).click();
  await expectLightSurface(page.locator('.execution-handoff'), '任务执行控制');
});

test('Chat模式提供原生会话布局、多轮对话和本地历史', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Chat模式', exact: false }).click();

  await expect(page.getByRole('heading', { name: '今天想设计什么？' })).toBeVisible();
  await expect(page.locator('.chat-new')).toBeVisible();
  await expect(page.getByRole('textbox', { name: '发送消息' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/Codex/i);

  await page.getByRole('textbox', { name: '发送消息' }).fill('分析当前项目进度');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByText('已读取当前项目和任务状态，可以继续完善设计方向。')).toBeVisible();
  await expect(page.getByRole('button', { name: /分析当前项目进度/ })).toBeVisible();

  await page.reload();
  await expect(page.getByText('分析当前项目进度', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('已读取当前项目和任务状态，可以继续完善设计方向。')).toBeVisible();
});

test('Chat模式把已有资料的生成要求直接转换为任务', async ({ page }) => {
  let actionBody;
  let chatRequests = 0;
  const task = {
    id: 'chat-series-action-task',
    projectId: 'forest',
    projectName: '森林穿越系列',
    kind: 'series',
    channel: 'chat',
    status: 'pending',
    message: '任务已创建，正在准备执行',
    total: 2,
    results: [],
    updatedAt: new Date().toISOString(),
  };
  await page.route('**/api/chat/actions', async (route) => {
    actionBody = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        handled: true,
        action: 'series',
        reply: '已调用当前项目的趋势与参考素材，开始生成 2 款。',
        task,
      }),
    });
  });
  await page.route('**/api/chat', async (route) => {
    chatRequests += 1;
    await route.fulfill({ status: 500, body: '{}' });
  });
  await page.route('**/api/state', async (route) => {
    const response = await route.fetch();
    const state = await response.json();
    await route.fulfill({ response, json: { ...state, tasks: [task, ...state.tasks] } });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Chat模式', exact: false }).click();
  await page
    .getByRole('textbox', { name: '发送消息' })
    .fill('用已有模特和 Logo 生成 2 款，不用参考图');
  await page.getByRole('button', { name: '发送消息' }).click();

  await expect(page.getByText('正在生成图片')).toBeVisible();
  await expect(page.getByText('任务已创建，正在准备执行')).toBeVisible();
  expect(actionBody.messages.at(-1).content).toBe('用已有模特和 Logo 生成 2 款，不用参考图');
  expect(chatRequests).toBe(0);
});

test('Chat模式在用户查看历史时不会被任务轮询拉回底部', async ({ page }) => {
  await page.addInitScript(() => {
    const messages = Array.from({ length: 48 }, (_, index) => ({
      id: `history-${index}`,
      role: index % 2 ? 'assistant' : 'user',
      content: `历史消息 ${index + 1}：用于验证长对话滚动位置。`,
      createdAt: new Date(2026, 0, 1, 0, index).toISOString(),
    }));
    messages.push({
      id: 'live-task-message',
      role: 'assistant',
      content: '正在持续更新任务进度。',
      taskId: 'scroll-regression-task',
      createdAt: new Date(2026, 0, 1, 1, 0).toISOString(),
    });
    localStorage.setItem(
      'badmark-chat-conversations-v3',
      JSON.stringify([
        {
          id: 'scroll-regression-chat',
          title: '滚动回归验收',
          createdAt: new Date(2026, 0, 1).toISOString(),
          updatedAt: new Date(2026, 0, 1, 1).toISOString(),
          messages,
        },
      ]),
    );
  });
  let tick = 0;
  await page.route('**/api/state', async (route) => {
    const response = await route.fetch();
    const state = await response.json();
    tick += 1;
    await route.fulfill({
      response,
      json: {
        ...state,
        revision: state.revision + tick,
        tasks: [
          ...state.tasks,
          {
            id: 'scroll-regression-task',
            kind: 'analysis',
            status: 'running',
            message: `轮询进度 ${tick}`,
            total: 1,
            results: [],
            updatedAt: new Date(2026, 0, 1, 1, tick).toISOString(),
          },
        ],
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Chat模式', exact: false }).click();
  const messageList = page.locator('.chat-native-messages');
  await expect
    .poll(() => messageList.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeGreaterThan(500);
  await messageList.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(1400);
  expect(await messageList.evaluate((element) => element.scrollTop)).toBeLessThan(12);
});

test('Chat模式追加多张参考图并将生成结果归入成片管理', async ({ page }) => {
  await page.route('**/api/state', async (route) => {
    const response = await route.fetch();
    const state = await response.json();
    await route.fulfill({
      response,
      json: {
        ...state,
        tasks: state.tasks.map((task) =>
          task.kind === 'restyle' && task.status === 'completed' && task.results?.length
            ? { ...task, results: [task.results[0], task.results[0], task.results[0]] }
            : task,
        ),
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await page.getByPlaceholder('例如：城市夜跑系列').fill('Chat 图片验收项目');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await page.getByRole('button', { name: 'Chat模式', exact: false }).click();
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '添加参考资料' }).click();
  const fileChooser = await fileChooserPromise;
  expect(fileChooser.isMultiple()).toBe(true);
  await fileChooser.setFiles(path.join(root, 'public', 'assets', 'model-reference.jpg'));
  await expect(page.locator('.chat-add-menu')).toHaveCount(0);
  await page
    .locator('input[type="file"][accept="image/*"]')
    .setInputFiles(path.join(root, 'public', 'assets', 'badmark-logo.svg'));
  await expect(page.locator('.chat-intent.image')).toHaveText('参考图片 2 / 5');
  await expect(page.locator('.chat-composer-surface')).toHaveClass(/has-files/);
  await expect(page.locator('.chat-compose-file')).toHaveCount(2);
  await expect(page.locator('.chat-compose-files')).not.toContainText('model-reference.jpg');
  await page.getByRole('button', { name: '放大参考图 model-reference.jpg' }).click();
  await expect(page.getByRole('dialog', { name: 'model-reference.jpg 大图预览' })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('dialog', { name: 'badmark-logo.svg 大图预览' })).toBeVisible();
  await page.getByRole('button', { name: '关闭大图' }).click();
  const messageInput = page.getByRole('textbox', { name: '发送消息' });
  await page.getByRole('button', { name: '在提示词中调用 @model-reference' }).click();
  await expect(messageInput).toHaveValue('@model-reference ');
  await messageInput.fill('@model-reference 改成轻量针织 Polo 套装，保持人物完整。');
  await page.getByRole('button', { name: '发送消息' }).click();

  await expect(page.getByText(/正在生成图片|图片生成完成/)).toBeVisible();
  await expect(page.locator('.chat-image-generation')).toBeVisible();
  await expect(page.locator('.chat-result-main img')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('图片生成完成')).toBeVisible();
  await expect(page.locator('.chat-result-strip button')).toHaveCount(3);
  const resultStrip = page.getByRole('region', { name: '生成结果版本' });
  await page.getByRole('button', { name: '查看生成结果 2' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: '查看生成结果 3' })).toHaveClass(/active/);
  await resultStrip.press('ArrowLeft');
  await expect(page.getByRole('button', { name: '查看生成结果 2' })).toHaveClass(/active/);
  await page.getByRole('button', { name: '放大生成结果 2' }).click();
  const imagePreview = page.getByRole('dialog', { name: '生成结果 2 大图预览' });
  await expect(imagePreview).toBeVisible();
  const zoomableImage = imagePreview.locator('.lightbox-stage');
  const zoomableBox = await zoomableImage.boundingBox();
  await page.mouse.move(
    zoomableBox.x + zoomableBox.width * 0.82,
    zoomableBox.y + zoomableBox.height * 0.24,
  );
  await page.mouse.wheel(0, -300);
  await expect(zoomableImage).toHaveAttribute('data-zoom', '1.25');
  await page.mouse.wheel(0, -300);
  await expect(zoomableImage).toHaveAttribute('data-zoom', '1.50');
  const expectedTranslation = [
    Math.round(-(zoomableBox.width * (0.82 - 0.5)) * 0.5),
    Math.round(-(zoomableBox.height * (0.24 - 0.5)) * 0.5),
  ];
  await expect
    .poll(() =>
      zoomableImage.locator('img').evaluate((image, expected) => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(image).transform);
        return Math.max(Math.abs(matrix.m41 - expected[0]), Math.abs(matrix.m42 - expected[1]));
      }, expectedTranslation),
    )
    .toBeLessThan(1.5);
  const beforeDrag = await zoomableImage.locator('img').evaluate((image) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(image).transform);
    return [matrix.m41, matrix.m42];
  });
  await page.mouse.move(
    zoomableBox.x + zoomableBox.width / 2,
    zoomableBox.y + zoomableBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    zoomableBox.x + zoomableBox.width / 2 + 42,
    zoomableBox.y + zoomableBox.height / 2 + 28,
  );
  await page.mouse.up();
  await expect
    .poll(() =>
      zoomableImage.locator('img').evaluate((image, previous) => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(image).transform);
        return [Math.round(matrix.m41 - previous[0]), Math.round(matrix.m42 - previous[1])];
      }, beforeDrag),
    )
    .toEqual([42, 28]);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('dialog', { name: '生成结果 3 大图预览' })).toBeVisible();
  await page.getByRole('button', { name: '关闭大图' }).click();
  await page.getByRole('button', { name: '成片管理', exact: false }).first().click();
  await expect(page.locator('.library-card')).toHaveCount(1);
  await expect(page.locator('.origin-badge')).toHaveText('改款新增');
  await page.getByRole('button', { name: '素材库', exact: false }).first().click();
  await expect(page.locator('.shared-card-kicker b', { hasText: 'Chat 生成' })).toHaveCount(0);
  await expect(page.locator('.shared-card h2', { hasText: 'Chat 图片验收项目' })).toHaveCount(0);
});

test('Chat模式上传趋势资料并在对话内显示分析结果', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Chat模式', exact: false }).click();
  await page
    .locator('.chat-trend-input')
    .setInputFiles(path.join(root, '项目资料', '趋势报告', 'mountain_pages', 'page-01.png'));
  await expect(page.locator('.chat-intent.trend')).toHaveText('趋势资料');
  await page.getByRole('textbox', { name: '发送消息' }).fill('重点分析色彩和廓形。');
  await page.getByRole('button', { name: '发送消息' }).click();

  await expect(page.getByText(/正在分析趋势资料|趋势分析完成/)).toBeVisible();
  await expect(page.getByText('趋势分析完成')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Outdoor motion' })).toBeVisible();
});

test('signed-out startup enters the workspace and keeps account authorization in settings', async ({
  page,
}) => {
  let accountConnected = false;
  await page.addInitScript(() => {
    window.open = () => ({ location: { href: '' }, close() {} });
  });
  await page.route('**/api/state', async (route) => {
    const response = await route.fetch();
    const state = await response.json();
    await route.fulfill({
      response,
      json: {
        ...state,
        executor: {
          ...state.executor,
          ready: accountConnected,
          authRequired: !accountConnected,
          account: accountConnected ? { email: 'designer@example.com', planType: 'plus' } : null,
          providerMode: 'account',
          message: accountConnected ? '帐号与 AI 服务已连接。' : '等待账号授权。',
        },
      },
    });
  });
  let requested = false;
  await page.route('**/api/auth/login', async (route) => {
    requested = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        authUrl: 'https://auth.openai.com/authorize?fixture=1',
        loginId: 'fixture-login',
      }),
    });
  });
  await page.route('**/api/auth/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ state: 'succeeded', loginId: 'fixture-login', error: null }),
    }),
  );
  await page.route('**/api/provider', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ mode: 'account' });
    accountConnected = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ready: true,
        authRequired: false,
        account: { email: 'designer@example.com', planType: 'plus' },
        providerMode: 'account',
        message: '帐号与 AI 服务已连接。',
      }),
    });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Chat模式', exact: false })).toBeVisible();
  await expect(page.locator('.startup-screen')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '登录 Bomi智绘工作台' })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(/Codex/i);
  await page.getByRole('button', { name: /^设置/ }).click();
  await expect(page.getByRole('heading', { name: '帐号管理', exact: true })).toBeVisible();
  await expect(page.getByText('尚未登录帐号', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '登录帐号', exact: true }).click();
  await expect.poll(() => requested).toBe(true);
  await expect.poll(() => accountConnected, { timeout: 5000 }).toBe(true);
  await expect(page.getByRole('status')).toHaveText('帐号授权已更新。');
});

test('signed-out workspace manages a masked third-party API from settings', async ({ page }) => {
  let submitted = null;
  await page.route('**/api/state', async (route) => {
    const response = await route.fetch();
    const state = await response.json();
    await route.fulfill({
      response,
      json: {
        ...state,
        executor: {
          ...state.executor,
          ready: false,
          checking: false,
          authRequired: true,
          message: '帐号尚未授权。',
        },
      },
    });
  });
  await page.route('**/api/providers', async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ready: true, providerMode: 'third-party' }),
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^设置/ }).click();
  await page
    .locator('.settings-nav')
    .getByRole('button', { name: 'API 管理', exact: false })
    .click();
  await page.getByRole('button', { name: '添加 API', exact: true }).click();
  const apiForm = page.locator('.api-profile-form');
  await apiForm.getByRole('button', { name: /通用兼容 API/ }).click();
  await expect(apiForm.getByLabel('API Key')).toHaveAttribute('type', 'password');
  await apiForm.getByLabel('API 名称').fill('视觉服务');
  await apiForm.getByLabel('Base URL').fill('https://api.example.com/v1');
  await apiForm.getByLabel('API Key').fill('hidden-login-key');
  await apiForm.getByLabel('分析模型').fill('vision-model');
  await apiForm.getByLabel('参与生图').check();
  await apiForm.getByLabel('图像模型').fill('image-model');
  await expect(apiForm.getByText('图片尺寸')).toHaveCount(0);
  await apiForm.getByRole('button', { name: '保存并检测', exact: true }).click();
  await expect.poll(() => submitted).not.toBeNull();
  expect(submitted).toMatchObject({
    providerType: 'compatible',
    name: '视觉服务',
    apiKey: 'hidden-login-key',
    analysisModel: 'vision-model',
    imageModel: 'image-model',
    roles: { analysis: true, image: true },
  });
  expect(submitted).not.toHaveProperty('imageSize');
});

test('OpenAI dedicated API preset submits official Responses and Images configuration', async ({
  page,
}) => {
  let submitted = null;
  await page.route('**/api/providers', async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ready: true, providerMode: 'third-party' }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: /^\u8bbe\u7f6e/ }).click();
  await page
    .locator('.settings-nav')
    .getByRole('button', { name: 'API 管理', exact: false })
    .click();
  await page.getByRole('button', { name: '添加 API', exact: true }).click();
  const form = page.locator('.api-profile-form');
  await expect(form.getByRole('button', { name: /OpenAI 官方 API/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(form.getByLabel('Base URL')).toHaveValue('https://api.openai.com/v1');
  await expect(form.getByLabel('Base URL')).toHaveAttribute('readonly', '');
  await expect(form.getByLabel('分析模型')).toHaveValue('gpt-6-astra');
  await expect(form.getByLabel('图像模型')).toHaveValue('gpt-image-2.5-sunburst');
  await expect(form.getByLabel('参与分析')).toBeChecked();
  await expect(form.getByLabel('参与生图')).toBeChecked();
  await form.getByLabel('API Key').fill('openai-test-key');
  await form.getByRole('button', { name: '保存并检测', exact: true }).click();
  await expect.poll(() => submitted).not.toBeNull();
  expect(submitted).toMatchObject({
    providerType: 'openai',
    name: 'OpenAI API',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'openai-test-key',
    analysisModel: 'gpt-6-astra',
    imageModel: 'gpt-image-2.5-sunburst',
    roles: { analysis: true, image: true },
  });
});

test('saved API mode remains selectable when capable profiles have no assigned roles', async ({
  page,
}) => {
  let mode = 'account';
  let requestedMode = null;
  const profiles = [
    {
      id: 'analysis-profile',
      name: '分析 API',
      baseUrl: 'https://analysis.example.com/v1',
      analysisModel: 'vision-model',
      imageModel: '',
      enabled: true,
      roles: { analysis: false, image: false },
      keyStored: true,
    },
    {
      id: 'image-profile',
      name: '生图 API',
      baseUrl: 'https://image.example.com/v1',
      analysisModel: '',
      imageModel: 'image-model',
      enabled: true,
      roles: { analysis: false, image: false },
      keyStored: true,
    },
  ];
  await page.route('**/api/state', async (route) => {
    const response = await route.fetch();
    const state = await response.json();
    await route.fulfill({
      response,
      json: {
        ...state,
        executor: {
          ...state.executor,
          ready: true,
          providerMode: mode,
          provider: {
            mode,
            profiles,
            activeProfiles:
              mode === 'third-party'
                ? { analysis: 'analysis-profile', image: 'image-profile' }
                : { analysis: null, image: null },
          },
        },
      },
    });
  });
  await page.route('**/api/provider', async (route) => {
    requestedMode = route.request().postDataJSON();
    mode = requestedMode.mode;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ready: true, providerMode: mode }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: /^\u8bbe\u7f6e/ }).click();
  await page
    .locator('.settings-nav')
    .getByRole('button', { name: 'API 管理', exact: false })
    .click();
  const apiMode = page.getByRole('button', { name: '使用第三方 API 模式', exact: true });
  await expect(apiMode).toBeEnabled();
  await expect(apiMode).toContainText('切换时自动分配已填写的模型');
  await apiMode.click();
  await expect.poll(() => requestedMode).toEqual({ mode: 'third-party' });
  await expect(apiMode).toHaveAttribute('aria-pressed', 'true');
  await expect(apiMode).toContainText('当前模式');
  await expect(page.locator('.toast[role="status"]')).toHaveText('已切换到已保存 API');
});

test('local service and AI readiness are reported independently', async ({ page }) => {
  await page.route('**/api/state', async (route) => {
    const response = await route.fetch();
    const state = await response.json();
    await route.fulfill({
      response,
      json: {
        ...state,
        executor: {
          ...state.executor,
          ready: false,
          checking: false,
          authRequired: false,
          account: { email: 'designer@example.com', planType: 'plus' },
          message: 'AI 服务暂时不可用。',
        },
      },
    });
  });
  await page.goto('/');
  await expect(page.getByText('本机服务正常')).toBeVisible();
  await page.getByRole('button', { name: /Chat模式/ }).click();
  await expect(page.getByText('AI 服务不可用')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('AI 服务已就绪');
  await page.getByRole('textbox', { name: '发送消息' }).fill('查看待处理任务');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByRole('alert')).toContainText('AI 服务暂时不可用');
});

test('quota exhaustion is shown as an image-only outage in API settings', async ({ page }) => {
  await page.route('**/api/state', async (route) => {
    const response = await route.fetch();
    const state = await response.json();
    await route.fulfill({
      response,
      json: {
        ...state,
        executor: {
          ...state.executor,
          ready: true,
          imageGeneration: false,
          imageIssue: {
            code: 'usage-limit',
            providerMode: 'account',
            message: '帐号生图额度已达到上限；请切换到可用 API。',
          },
          message: '帐号生图额度已达到上限；请切换到可用 API。',
        },
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^设置/ }).click();
  await page
    .locator('.settings-nav')
    .getByRole('button', { name: 'API 管理', exact: false })
    .click();
  await expect(page.getByText('AI 服务已就绪', { exact: true })).toBeVisible();
  await expect(page.getByText('生图额度已用尽', { exact: true })).toBeVisible();
});

test('记忆中心可以新建、停用和恢复本机长期偏好', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^设置/ }).click();
  await page.locator('.settings-nav').getByRole('button', { name: '记忆', exact: false }).click();
  await expect(page.getByRole('heading', { name: '越使用，越贴近你的设计习惯' })).toBeVisible();

  const text = 'E2E 记忆：系列主色保持低饱和，避免大面积荧光色。';
  await page
    .getByPlaceholder('例如：系列主色保持低饱和，避免大面积荧光色；Logo 优先使用小面积同色刺绣。')
    .fill(text);
  await page.getByRole('button', { name: '保存到长期记忆' }).click();
  const card = page.locator('.memory-card', { hasText: text });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: '停用' }).click();
  await page.getByRole('button', { name: '已停用', exact: true }).click();
  const archived = page.locator('.memory-card', { hasText: text });
  await expect(archived).toBeVisible();
  await archived.getByRole('button', { name: '恢复' }).click();
  await page.getByRole('button', { name: '正在使用', exact: true }).click();
  await expect(page.locator('.memory-card', { hasText: text })).toBeVisible();
});

test('设置中心统一收纳帐号、记忆、任务和 API 管理', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^设置/ }).click();
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  const settingsNav = page.locator('.settings-nav');
  await expect(settingsNav.getByRole('button', { name: '帐号管理', exact: false })).toBeVisible();
  await expect(settingsNav.getByRole('button', { name: '记忆', exact: false })).toBeVisible();
  await expect(settingsNav.getByRole('button', { name: '任务中心', exact: false })).toBeVisible();
  await expect(settingsNav.getByRole('button', { name: 'API 管理', exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: '帐号管理', exact: true })).toBeVisible();
  await expect(page.getByText('本机安全授权')).toBeVisible();

  await settingsNav.getByRole('button', { name: 'API 管理', exact: false }).click();
  await expect(page.getByRole('heading', { name: 'API 管理', exact: true })).toBeVisible();
  await expect(page.getByLabel('AI 连接方式')).toBeVisible();
  const accountMode = page.getByRole('button', { name: '使用帐号模式', exact: true });
  const apiMode = page.getByRole('button', { name: '使用第三方 API 模式', exact: true });
  await expect(accountMode).toHaveClass(/active/);
  await expect(accountMode).toHaveAttribute('aria-pressed', 'true');
  await expect(accountMode.getByText('当前模式', { exact: true })).toBeVisible();
  await expect(apiMode).toHaveAttribute('aria-pressed', 'false');
  await expect(apiMode).toBeDisabled();
  await expect(apiMode.getByText('不可用', { exact: true })).toBeVisible();
  await expect(accountMode.getByText('帐号模式', { exact: true })).toBeVisible();
  await expect(apiMode.getByText('第三方 API', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '添加 API' })).toBeVisible();
  await page.getByRole('button', { name: '添加 API' }).click();
  const apiForm = page.locator('.api-profile-form');
  await expect(apiForm.getByRole('button', { name: /OpenAI 官方 API/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(apiForm.getByLabel('API Key')).toHaveAttribute('type', 'password');
  await expect(apiForm.getByLabel('Base URL')).toHaveValue('https://api.openai.com/v1');
  await expect(apiForm.getByLabel('Base URL')).toHaveAttribute('readonly', '');
  await expect(apiForm.getByLabel('分析模型')).toBeVisible();
  await expect(apiForm.getByLabel('图像模型')).toBeVisible();
  await expect(apiForm.getByText('生成图尺寸')).toHaveCount(0);
  await expect(page.getByText('不会返回前端、写入项目或导出文件', { exact: false })).toBeVisible();
  await expect(page.getByLabel('任务模型')).toHaveValue('offline-test-fixture');
  await expect(page.getByLabel('任务模型')).toContainText('Offline Test Fixture');
  await expect(page.getByLabel('任务模型')).not.toContainText(/\bGPT\b/i);
  await expect(page.locator('.settings-workspace')).not.toContainText(/ChatGPT/i);
  await expect(page.getByText('http://127.0.0.1:4184/api')).toBeVisible();
  await settingsNav.getByRole('button', { name: '任务中心', exact: false }).click();
  await expect(page.getByRole('heading', { name: '任务中心', exact: true })).toBeVisible();
  await expect(page.locator('.task-center')).toBeVisible();
});

test('image ordering defaults to newest and persists across reloads', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '素材库', exact: false }).first().click();
  const order = page.getByRole('combobox', { name: '图片排序', exact: true });
  await expect(order).toHaveValue('newest');
  await order.selectOption('oldest');
  const oldestImages = await page
    .locator('.shared-card img')
    .evaluateAll((images) => images.map((img) => img.src));
  await page.reload();
  await page.getByRole('button', { name: '素材库', exact: false }).first().click();
  await expect(order).toHaveValue('oldest');
  expect(
    await page.locator('.shared-card img').evaluateAll((images) => images.map((img) => img.src)),
  ).toEqual(oldestImages);
  await order.selectOption('name');
  await expect(page.locator('.shared-card').first()).toBeVisible();
  await page.getByRole('button', { name: '成片管理', exact: false }).first().click();
  await expect(order).toHaveValue('newest');
  await order.selectOption('oldest');
  await expect(order).toHaveValue('oldest');
});

test('资料库与成片卡片默认简洁并在悬停时显示操作', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '趋势资料库', exact: false }).first().click();
  const trendCard = page.locator('.shared-card').first();
  await expect(trendCard).toBeVisible();
  await expect(trendCard.locator('.shared-card-actions')).toHaveCSS('opacity', '0');
  await trendCard.hover();
  await expect(trendCard.locator('.shared-card-actions')).toHaveCSS('opacity', '1');

  await page.getByRole('button', { name: '素材库', exact: false }).first().click();
  const materialCard = page.locator('.shared-card').first();
  await expect(materialCard).toBeVisible();
  await expect(materialCard.locator('.shared-card-actions')).toHaveCSS('opacity', '0');
  await materialCard.hover();
  await expect(materialCard.locator('.shared-card-actions')).toHaveCSS('opacity', '1');

  await page.getByRole('button', { name: '成片管理', exact: false }).first().click();
  const finishedCard = page.locator('.library-card').first();
  await expect(finishedCard).toBeVisible();
  await expect(finishedCard.locator('.card-actions')).toHaveCSS('opacity', '0');
  await expect(finishedCard.locator('.asset-badge')).toHaveCSS('opacity', '0');
  await finishedCard.hover();
  await expect(finishedCard.locator('.card-actions')).toHaveCSS('opacity', '1');
  await expect(finishedCard.locator('.asset-badge')).toHaveCSS('opacity', '1');
});

test('深色模式下主要工作区保持深色表面和清晰文字', async ({ page }) => {
  const failedChatTask = {
    id: 'dark-surface-failed-task',
    projectId: 'forest',
    projectName: '深色表面验收',
    kind: 'series',
    status: 'failed',
    message: '图片生成暂时不可用，请重试。',
    total: 1,
    results: [],
    updatedAt: new Date().toISOString(),
  };
  await page.addInitScript((task) => {
    localStorage.setItem(
      'badmark-chat-conversations-v3',
      JSON.stringify([
        {
          id: 'dark-surface-chat',
          title: '深色失败状态验收',
          createdAt: task.updatedAt,
          updatedAt: task.updatedAt,
          messages: [
            {
              id: 'dark-surface-message',
              role: 'assistant',
              content: task.message,
              taskId: task.id,
              createdAt: task.updatedAt,
            },
          ],
        },
      ]),
    );
  }, failedChatTask);
  await page.route('**/api/state', async (route) => {
    const response = await route.fetch();
    const state = await response.json();
    await route.fulfill({
      response,
      json: { ...state, tasks: [failedChatTask, ...state.tasks] },
    });
  });
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('badmark-theme-v1', 'dark'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.getByRole('button', { name: /^设置/ }).click();
  const settingsNav = page.locator('.settings-nav');
  await settingsNav.getByRole('button', { name: '帐号管理', exact: false }).click();
  await expect(page.locator('.settings-detail-head > span')).toHaveCSS(
    'background-color',
    'rgba(91, 156, 255, 0.1)',
  );
  await expect(page.locator('.settings-status-icon')).toHaveCSS(
    'background-color',
    'rgb(25, 25, 29)',
  );
  await expect
    .poll(() =>
      page.locator('.account > .settings-entry-dot').evaluate((element) => {
        const match = getComputedStyle(element).backgroundColor.match(
          /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/,
        );
        if (!match) return 255;
        const alpha = match[4] === undefined ? 1 : Number(match[4]);
        const channels = [Number(match[1]), Number(match[2]), Number(match[3])].map(
          (channel) => channel * alpha + 26 * (1 - alpha),
        );
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      }),
    )
    .toBeLessThan(80);
  await expectDarkViewport(page, '帐号管理');
  await settingsNav.getByRole('button', { name: 'API 管理', exact: false }).click();
  await expect(page.locator('.api-settings-grid label').first()).toHaveCSS(
    'background-color',
    'rgb(25, 25, 29)',
  );
  await expectDarkViewport(page, 'API 管理');
  await settingsNav.getByRole('button', { name: '记忆', exact: false }).click();
  await expect(page.locator('.memory-workspace.embedded')).toHaveCSS(
    'background-color',
    'rgb(20, 20, 22)',
  );
  await expect(page.locator('.memory-compose textarea')).toHaveCSS(
    'background-color',
    'rgb(16, 16, 18)',
  );
  await expectDarkViewport(page, '记忆');

  await settingsNav.getByRole('button', { name: '任务中心', exact: false }).click();
  await expect(page.locator('.execution-handoff')).toHaveCSS('background-color', 'rgb(20, 20, 22)');
  const failedStatus = page.locator('.task-status.failed').first();
  if (await failedStatus.count()) {
    await expect(failedStatus).toHaveCSS('background-color', 'rgba(255, 102, 95, 0.16)');
    const errorDetails = page.locator('.task-error-details').first();
    await errorDetails.locator('summary').click();
    await expect(errorDetails.locator('code')).toHaveCSS(
      'background-color',
      'rgba(75, 51, 20, 0.46)',
    );
  }
  await expectDarkViewport(page, '任务中心');

  await page.getByRole('button', { name: '趋势资料库', exact: false }).first().click();
  await expect(page.locator('.shared-library-toolbar')).toHaveCSS(
    'background-color',
    'rgb(25, 25, 29)',
  );
  await expect(page.locator('.shared-card-cover > span').first()).toHaveCSS(
    'background-color',
    'rgba(12, 12, 14, 0.82)',
  );
  await expectDarkViewport(page, '趋势资料库');
  await page.getByRole('button', { name: '素材库', exact: false }).first().click();
  await expectDarkViewport(page, '素材库');
  await page.getByRole('button', { name: '成片管理', exact: false }).first().click();
  await expect(page.locator('.library-toolbar')).toHaveCSS('background-color', 'rgb(25, 25, 29)');
  const readyBadge = page.locator('.asset-badge.ready').first();
  if (await readyBadge.count())
    await expect(readyBadge).toHaveCSS('background-color', 'rgba(55, 174, 105, 0.17)');
  await expectDarkViewport(page, '成片管理');
  await page.getByRole('button', { name: '改款中心', exact: false }).first().click();
  await expect(page.locator('.restyle-composer')).toHaveCSS('background-color', 'rgb(21, 21, 24)');
  await expect(page.locator('.restyle-advanced')).toHaveCSS('background-color', 'rgb(20, 20, 22)');
  await expect(page.locator('.annotation-stage')).toHaveCSS('background-color', 'rgb(18, 18, 20)');
  await expectDarkViewport(page, '改款中心');
  await page.getByRole('button', { name: '爆款裂变', exact: false }).first().click();
  await expectDarkViewport(page, '爆款裂变');
  await page.getByRole('button', { name: '系列工作台', exact: false }).first().click();
  await expectDarkViewport(page, '系列工作台');
  await page.getByRole('button', { name: 'Chat模式', exact: false }).first().click();
  await page
    .locator('.chat-image-input')
    .setInputFiles(path.join(root, 'public', 'assets', 'model-reference.jpg'));
  await expect(page.locator('.chat-compose-files .chat-compose-add')).toHaveCSS(
    'background-color',
    'rgba(195, 207, 140, 0.09)',
  );
  await expect(page.locator('.chat-task-card.failed')).toHaveCSS(
    'background-color',
    'rgb(21, 21, 24)',
  );
  await expectDarkViewport(page, 'Chat模式');

  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await expect(page.locator('.new-project-form select')).toHaveCSS(
    'background-color',
    'rgb(16, 16, 18)',
  );
  await expectDarkViewport(page, '新建项目弹窗');
  await page.getByRole('button', { name: '关闭' }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '打开侧边栏' }).click();
  await page.getByRole('button', { name: /^设置/ }).click();
  await page
    .locator('.settings-nav')
    .getByRole('button', { name: 'API 管理', exact: false })
    .click();
  await expectDarkViewport(page, '窄屏 API 管理');
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
