import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { applyTheme, resolveTheme, themeColors, themeStorageKey } from '../src/theme.js';

const themePath = new URL('../src/todo-panel-theme.css', import.meta.url);
const theme = readFileSync(themePath, 'utf8');
const lightThemePath = new URL('../src/light-theme.css', import.meta.url);
const lightTheme = readFileSync(lightThemePath, 'utf8');
const baseStyles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('TO-DO Panel theme is local, responsive, and imported after base styles', () => {
  const entry = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.match(entry, /workflow\.css'[\s\S]*todo-panel-theme\.css'[\s\S]*light-theme\.css'/);
  assert.match(theme, /--panel-bg:\s*#0c0c0c/);
  assert.match(theme, /linear-gradient\(180deg, #f1f5f7, #84909a\)/);
  assert.match(theme, /@media \(max-width: 820px\)/);
  assert.match(theme, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(theme, /https?:\/\//);
});

test('dark theme explicitly covers late-added settings, library and design surfaces', () => {
  assert.match(theme, /:root:not\(\[data-theme='light'\]\) \.memory-workspace\.embedded/);
  assert.match(theme, /:root:not\(\[data-theme='light'\]\) \.api-settings-grid label/);
  assert.match(theme, /\.api-provider-channel/);
  assert.match(theme, /:root:not\(\[data-theme='light'\]\) \.shared-library-toolbar/);
  assert.match(theme, /:root:not\(\[data-theme='light'\]\) \.library-toolbar/);
  assert.match(theme, /:root:not\(\[data-theme='light'\]\) \.direction-editor/);
  assert.match(theme, /:root:not\(\[data-theme='light'\]\) \.restyle-advanced/);
  assert.match(theme, /:root:not\(\[data-theme='light'\]\) \.lightbox figure/);
  assert.match(theme, /\.image-gallery-bar/);
  assert.match(theme, /\.image-gallery-thumbnails/);
  assert.match(theme, /:root:not\(\[data-theme='light'\]\) \.library-image/);
  assert.match(theme, /:root:not\(\[data-theme='light'\]\) \.execution-handoff/);
  assert.match(theme, /:root:not\(\[data-theme='light'\]\) \.task-error-details code/);
  assert.match(theme, /:root:not\(\[data-theme='light'\]\) \.task-status\.failed/);
  assert.match(theme, /:root:not\(\[data-theme='light'\]\) \.settings-status-icon\.ready/);
  assert.match(theme, /:root:not\(\[data-theme='light'\]\) \.settings-detail-head > span/);
  assert.match(theme, /:root:not\(\[data-theme='light'\]\) \.account > \.settings-entry-dot:empty/);
  assert.match(theme, /:root:not\(\[data-theme='light'\]\) \.api-mode-options button\.active/);
  assert.match(theme, /:root:not\(\[data-theme='light'\]\) \.api-profile-type > button\.active/);
  assert.match(theme, /:root:not\(\[data-theme='light'\]\) \.api-provider-alert/);
  assert.match(baseStyles, /\.api-mode-options button\.active/);
  assert.match(baseStyles, /\.api-provider-alert/);
  assert.match(baseStyles, /\.api-mode-state/);
  assert.match(baseStyles, /\.api-profile-type-badge/);
  assert.match(
    theme,
    /:root:not\(\[data-theme='light'\]\) \.chat-compose-files \.chat-compose-add/,
  );
  assert.match(theme, /:root:not\(\[data-theme='light'\]\) \.chat-task-card\.failed/);
  assert.match(theme, /:root:not\(\[data-theme='light'\]\) \.asset-badge\.ready/);
  assert.match(theme, /:root:not\(\[data-theme='light'\]\) \.shared-card-cover > span/);
  assert.match(theme, /:root:not\(\[data-theme='light'\]\) \.annotation-stage/);
  assert.match(theme, /:root:not\(\[data-theme='light'\]\) \.new-project-form select/);
  assert.match(theme, /:root:not\(\[data-theme='light'\]\) \.page-status/);
  assert.match(theme, /:root:not\(\[data-theme='light'\]\) \.memory-card footer button/);
  assert.match(theme, /\*:hover::\-webkit-scrollbar-thumb/);
});

test('image rails reveal scrollbars on hover or keyboard focus without covering thumbnails', () => {
  const workflow = readFileSync(new URL('../src/workflow.css', import.meta.url), 'utf8');
  const components = readFileSync(new URL('../src/components.jsx', import.meta.url), 'utf8');
  const projectWorkspace = readFileSync(
    new URL('../src/ProjectWorkspace.jsx', import.meta.url),
    'utf8',
  );
  const designWorkspace = readFileSync(
    new URL('../src/DesignWorkspace.jsx', import.meta.url),
    'utf8',
  );

  assert.match(projectWorkspace, /<ImageScrollRail className="filmstrip" label="系列成片滚动栏">/);
  assert.match(
    designWorkspace,
    /<ImageScrollRail[\s\S]*className="source-look-strip"[\s\S]*'改款原图滚动栏'[\s\S]*'爆款原图滚动栏'/,
  );
  assert.match(components, /export function ImageScrollRail/);
  assert.match(components, /onKeyDown=\{\(event\) => activateAdjacentThumbnail/);
  assert.match(components, /role="scrollbar"[\s\S]*aria-orientation="horizontal"/);
  assert.match(workflow, /\.image-scroll-rail-shell\s*\{[\s\S]*grid-template-rows:[^;]*9px/);
  assert.match(workflow, /\.image-scroll-rail\s*\{[\s\S]*scrollbar-width:\s*none/);
  assert.match(
    workflow,
    /\.image-scroll-rail-shell:hover \.image-scrollbar\[data-scrollable='true'\],[\s\S]*\.image-scroll-rail-shell:focus-within/,
  );
  assert.match(workflow, /\.image-scrollbar-thumb\s*\{[\s\S]*min-width:\s*32px/);
  assert.match(theme, /--image-rail-scrollbar-thumb:\s*#4a4d53/);
  assert.match(theme, /--image-rail-scrollbar-track:\s*rgba\(215, 226, 234, 0\.12\)/);
  assert.match(lightTheme, /--image-rail-scrollbar-thumb:\s*#aeb6bf/);
  assert.match(lightTheme, /--image-rail-scrollbar-track:\s*rgba\(29, 36, 44, 0\.1\)/);
});

test('large image previews share cursor-anchored wheel zoom and one lightbox surface', () => {
  const components = readFileSync(new URL('../src/components.jsx', import.meta.url), 'utf8');
  const library = readFileSync(new URL('../src/LibraryWorkspace.jsx', import.meta.url), 'utf8');
  const project = readFileSync(new URL('../src/ProjectWorkspace.jsx', import.meta.url), 'utf8');
  const chat = readFileSync(new URL('../src/ChatWorkspace.jsx', import.meta.url), 'utf8');
  const design = readFileSync(new URL('../src/DesignWorkspace.jsx', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const workflow = readFileSync(new URL('../src/workflow.css', import.meta.url), 'utf8');

  assert.match(components, /export function ZoomableImage/);
  assert.match(components, /addEventListener\('wheel',[\s\S]*passive:\s*false/);
  assert.match(components, /zoomOffsetAtPoint/);
  assert.match(components, /放大后可拖动查看/);
  assert.match(components, /className="lightbox-stage"/);
  assert.match(components, /className="image-gallery-thumbnails"/);
  assert.match(project, /function GeneratedImagePreview[\s\S]*<ImageLightbox/);
  assert.doesNotMatch(project, /叠图|stacked-image-button|version-stack-badge|has-version-stack/);
  assert.match(project, /className="preview-image-button"/);
  assert.doesNotMatch(project, /generated-image-viewport/);
  assert.match(library, /detail && !isTrend[\s\S]*<ImageLightbox/);
  assert.match(chat, /<ImageLightbox/);
  assert.match(design, /<ImageLightbox/);
  assert.match(design, /viral-source-preview[\s\S]*<ZoomableImage/);
  assert.match(design, /className=\{`annotation-image-wrap[\s\S]*data-zoom=/);
  assert.doesNotMatch(design, /<Hand size=\{14\} \/> 拖动/);
  assert.match(design, /pan\.current[\s\S]*setOffset\(nextOffset\)/);
  assert.match(design, /function AnnotationRegionChips/);
  assert.match(design, /function RestyleComposer/);
  assert.match(design, /groupAnnotationsByColor\(annotations\)/);
  assert.match(design, /aria-label="改款统一调整对话框"/);
  assert.match(design, /aria-label="添加参考资料"[\s\S]*input\.current\?\.click/);
  assert.match(design, /在调整说明中调用 @\$\{reference\.label\}/);
  assert.match(design, /标注区域作为精准调整指引/);
  assert.match(design, /isRestyle[\s\S]*\? ''/);
  assert.match(design, /className="restyle-prompt-examples"/);
  assert.match(design, /圈选与涂鸦区域会自动加入上方输入框/);
  assert.match(design, /addedRegions[\s\S]*insertMentionToken\(next, label\)/);
  assert.doesNotMatch(design, /<section className="annotation-instructions"/);
  const restyleComposer = design.match(
    /function RestyleComposer[\s\S]*?(?=\nimport \{ sortImages \})/,
  )?.[0];
  assert.equal((restyleComposer?.match(/<textarea/g) || []).length, 1);
  assert.match(design, /addEventListener\('wheel',[\s\S]*passive:\s*false/);
  assert.match(design, /className="annotation-brush-presets"[\s\S]*aria-label="涂鸦笔粗细"/);
  assert.doesNotMatch(design, /aria-label="圈选线宽"/);
  assert.match(design, /strokeWidth=\{annotation\.strokeWidth \|\| 38\}/);
  assert.match(workflow, /\.annotation-image-content[\s\S]*transform-origin:\s*center/);
  assert.match(workflow, /\.annotation-brush-presets\s*\{/);
  assert.match(workflow, /\.annotation-image-wrap\.pan-mode[\s\S]*cursor:\s*grab/);
  assert.match(workflow, /\.restyle-composer\s*\{/);
  assert.match(workflow, /\.restyle-native-composer\s*\{/);
  assert.match(
    workflow,
    /\.restyle-native-composer \{[\s\S]*min-height:\s*220px[\s\S]*display:\s*block/,
  );
  assert.match(
    workflow,
    /\.restyle-native-composer \.chat-input-column textarea \{[\s\S]*min-height:\s*198px[\s\S]*padding:\s*9px 6px 54px/,
  );
  assert.match(
    workflow,
    /\.restyle-native-composer > \.chat-file-trigger,[\s\S]*position:\s*absolute[\s\S]*bottom:\s*10px/,
  );
  assert.match(design, /isRestyle && resultCanvasItem && resultCanvasItem\.src !== source/);
  assert.match(design, /aria-label=\{`画布查看\$\{resultCanvasItem/);
  assert.match(components, /export function TaskCenter[\s\S]*<ImageLightbox/);
  assert.doesNotMatch(library, /library-material-preview/);
  assert.match(styles, /html\.image-gallery-open,[\s\S]*overflow:\s*hidden/);
});

test('direct startup, image-project restyle mode and OpenAI model lists are wired', () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const design = readFileSync(new URL('../src/DesignWorkspace.jsx', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('../src/SettingsWorkspace.jsx', import.meta.url), 'utf8');

  assert.doesNotMatch(app, /StartupScreen|startupMinimumElapsed/);
  assert.match(app, /if \(!data\)[\s\S]*className="app-booting"/);
  assert.match(app, /request\('\/image-projects'/);
  assert.match(design, /sourceMode === 'project' \? project\.sourceAssetId : null/);
  assert.match(design, /annotations: isRestyle \? annotations : \[\]/);
  assert.match(design, /layerMode: false/);
  assert.match(design, /localStorage\.setItem\([\s\S]*restyleDraftKey\(project\.id\)/);
  assert.doesNotMatch(design, /LookLayerPanel|setLayerMode|mergeLookLayers/);
  assert.match(design, /按整图方式改款/);
  assert.match(settings, /datalist id="openai-analysis-model-list"/);
  assert.match(settings, /datalist id="openai-image-model-list"/);
  assert.match(settings, /list=\{form\.providerType === 'openai'/);
  assert.match(settings, /id: 'output', label: '成片文件夹'/);
  assert.match(settings, /selectOutputDirectory/);
  assert.match(settings, /\/output-directory\/sync/);
});

test('generation concurrency is automatic and shown as one compact status card', () => {
  const settings = readFileSync(new URL('../src/SettingsWorkspace.jsx', import.meta.url), 'utf8');
  const components = readFileSync(new URL('../src/components.jsx', import.meta.url), 'utf8');

  assert.match(settings, /<SmartConcurrencyStatus executor=\{executor\}/);
  assert.match(components, /aria-label="智能并发状态"/);
  assert.match(components, /smart\.unlimited \? '不限上限'/);
});

test('library cards hide secondary controls until hover or keyboard focus', () => {
  const projectWorkspace = readFileSync(
    new URL('../src/ProjectWorkspace.jsx', import.meta.url),
    'utf8',
  );
  assert.match(
    theme,
    /\.shared-card > \.shared-card-actions,[\s\S]*\.library-card > \.card-actions/,
  );
  assert.match(theme, /\.shared-card:is\(:hover, :focus-within\)/);
  assert.match(theme, /\.library-card:is\(:hover, :focus-within\)/);
  assert.match(theme, /@media \(hover: none\)/);
  assert.match(projectWorkspace, /className="look-secondary-meta"/);
});

test('Chat attachments, generation motion and result gallery stay compact and responsive', () => {
  const workflow = readFileSync(new URL('../src/workflow.css', import.meta.url), 'utf8');
  const chat = readFileSync(new URL('../src/ChatWorkspace.jsx', import.meta.url), 'utf8');
  assert.match(workflow, /\.chat-attachment-tile\s*\{/);
  assert.match(workflow, /\.chat-compose-file\s*\{/);
  assert.match(workflow, /\.chat-composer-surface\s*\{/);
  assert.match(workflow, /\.chat-response-actions\s*\{[\s\S]*opacity:\s*0/);
  assert.match(workflow, /\.chat-mention-menu\s*\{/);
  assert.match(workflow, /\.chat-image-generation-preview span[\s\S]*chat-image-sweep/);
  assert.match(
    workflow,
    /@media \(max-width: 600px\)[\s\S]*\.chat-result-strip\s*\{[\s\S]*width:\s*50px/,
  );
  assert.doesNotMatch(workflow, /\.chat-result-strip\s*\{\s*display:\s*none/);
  assert.match(chat, /followOutputRef\.current = list\.scrollHeight - list\.scrollTop/);
  assert.match(chat, /ref=\{directFileInput\}[\s\S]*accept="\.pdf,image\/\*"/);
  assert.match(chat, /aria-label="添加参考资料"[\s\S]*directFileInput\.current\?\.click/);
  assert.doesNotMatch(chat, /className="chat-add-menu"/);
  assert.match(
    chat,
    /referenceLabels:\s*files\.slice\(1\)\.map\(\(\{ mention \}\) => `@\$\{mention\}`\)/,
  );
  assert.match(theme, /\.chat-image-generation/);
  assert.match(theme, /\.chat-attachment-tile/);
  assert.match(lightTheme, /\.chat-compose-file/);
});

test('light theme is complete, local, and persisted without touching project state', () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(lightTheme, /:root\[data-theme='light'\]/);
  assert.match(lightTheme, /\.chat-workspace\.chat-native/);
  assert.match(lightTheme, /\.settings-detail/);
  assert.match(lightTheme, /\.login-screen/);
  assert.match(lightTheme, /html\[data-theme='light'\] \.restyle-layer-panel/);
  assert.match(lightTheme, /html\[data-theme='light'\] \.look-layer-list article\.visible/);
  assert.match(lightTheme, /html\[data-theme='light'\] \.restyle-prompt-examples summary/);
  assert.match(lightTheme, /html\[data-theme='light'\] \.shared-library-toolbar/);
  assert.match(lightTheme, /html\[data-theme='light'\] \.execution-handoff/);
  assert.match(lightTheme, /html\[data-theme='light'\] \.annotation-instructions/);
  assert.doesNotMatch(app, /executor\?\.authRequired\)[\s\S]*<LoginScreen/);
  assert.doesNotMatch(app, /StartupScreen|LoginScreen|\/auth\/login/);
  assert.match(app, /if \(!data\)[\s\S]*正在连接本机工作台/);
  assert.match(app, /useLayoutEffect\(\(\) => \{[\s\S]*applyTheme\(theme\);[\s\S]*\}, \[theme\]\)/);
  assert.doesNotMatch(app, /use(?:Layout)?Effect\(\(\) => applyTheme\(theme\)/);
  assert.match(html, /badmark-theme-v1[\s\S]*document\.documentElement\.dataset\.theme = theme/);
  assert.match(lightTheme, /\*:hover::\-webkit-scrollbar-thumb/);
  assert.match(lightTheme, /@media \(max-width: 820px\)/);
  assert.doesNotMatch(lightTheme, /https?:\/\//);
  assert.equal(resolveTheme('dark', false), 'dark');
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme(null, true), 'dark');
  assert.equal(resolveTheme(null, false), 'light');

  const root = { dataset: {}, style: {} };
  const saved = new Map();
  const storage = { setItem: (key, value) => saved.set(key, value) };
  assert.equal(applyTheme('light', root, storage), 'light');
  assert.equal(root.dataset.theme, 'light');
  assert.equal(root.style.colorScheme, 'light');
  assert.equal(root.style.backgroundColor, themeColors.light);
  assert.equal(saved.get(themeStorageKey), 'light');
});

test('theme application updates every browser canvas surface atomically', () => {
  const body = { style: {} };
  const meta = { setAttribute: (name, value) => (meta[name] = value) };
  const root = {
    dataset: {},
    style: {},
    ownerDocument: {
      body,
      querySelector: (selector) => (selector === 'meta[name="theme-color"]' ? meta : null),
    },
  };
  const storage = { setItem() {} };

  assert.equal(applyTheme('dark', root, storage), 'dark');
  assert.equal(root.style.backgroundColor, themeColors.dark);
  assert.equal(body.style.backgroundColor, themeColors.dark);
  assert.equal(meta.content, themeColors.dark);

  assert.equal(applyTheme('light', root, storage), 'light');
  assert.equal(root.style.backgroundColor, themeColors.light);
  assert.equal(body.style.backgroundColor, themeColors.light);
  assert.equal(meta.content, themeColors.light);
});

test('Kanit display font files are bundled for offline use', () => {
  for (const weight of [400, 500, 700, 900]) {
    assert.equal(existsSync(new URL(`../public/fonts/kanit-${weight}.ttf`, import.meta.url)), true);
  }
  assert.equal(existsSync(new URL('../public/fonts/Kanit-OFL.txt', import.meta.url)), true);
});
