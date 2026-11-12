import path from 'node:path';
import { existsSync, readFileSync, renameSync, writeFileSync, chmodSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ensure } from './schema.js';
import { normalizeCompatibleBaseUrl } from './openai-compatible.js';
import {
  LEGACY_OPENAI_ANALYSIS_MODEL,
  LEGACY_OPENAI_IMAGE_MODEL,
  OPENAI_ANALYSIS_MODEL,
  OPENAI_API_BASE_URL,
  OPENAI_IMAGE_MODEL,
} from '../shared/openai-defaults.js';

const MAX_KEY_LENGTH = 4096;
export { OPENAI_API_BASE_URL } from '../shared/openai-defaults.js';
const providerTypes = new Set(['compatible', 'openai']);
const normalizeText = (value, label, limit = 120) => {
  ensure(typeof value === 'string' && value.trim(), `${label}不能为空`);
  return value.trim().slice(0, limit);
};
const optionalText = (value, limit = 120) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : '';
const normalizeRoles = (roles = {}) => ({
  analysis: Boolean(roles.analysis),
  image: Boolean(roles.image),
});
const normalizeProviderType = (value) => (providerTypes.has(value) ? value : 'compatible');
const publicProfile = ({ apiKey: _apiKey, imageSize: _legacyImageSize, ...profile }) => ({
  ...profile,
  keyStored: true,
});

export class ApiProfileStore {
  constructor(directory) {
    this.file = path.join(directory, 'api-providers.json');
    this.state = existsSync(this.file)
      ? JSON.parse(readFileSync(this.file, 'utf8'))
      : { version: 1, profiles: [] };
    ensure(
      this.state?.version === 1 && Array.isArray(this.state.profiles),
      'API 配置文件格式不支持，请检查本机配置。',
    );
    if (this.migrateOpenAIDefaults()) this.save();
  }

  migrateOpenAIDefaults() {
    let changed = false;
    for (const profile of this.state.profiles) {
      if (profile.providerType !== 'openai') continue;
      if (profile.analysisModel === LEGACY_OPENAI_ANALYSIS_MODEL) {
        profile.analysisModel = OPENAI_ANALYSIS_MODEL;
        changed = true;
      }
      if (profile.imageModel === LEGACY_OPENAI_IMAGE_MODEL) {
        profile.imageModel = OPENAI_IMAGE_MODEL;
        changed = true;
      }
    }
    return changed;
  }

  snapshot() {
    return this.state.profiles.map(publicProfile);
  }

  create(input = {}) {
    const profile = this.normalize(input, null);
    profile.id = randomUUID();
    profile.createdAt = new Date().toISOString();
    profile.updatedAt = profile.createdAt;
    this.applyRoleExclusivity(profile.roles, profile.id);
    this.state.profiles.push(profile);
    this.save();
    return publicProfile(profile);
  }

  update(id, input = {}) {
    const index = this.state.profiles.findIndex((profile) => profile.id === id);
    ensure(index >= 0, 'API 配置不存在', 404);
    const profile = this.normalize(input, this.state.profiles[index]);
    profile.id = id;
    profile.createdAt = this.state.profiles[index].createdAt;
    profile.updatedAt = new Date().toISOString();
    this.applyRoleExclusivity(profile.roles, id);
    this.state.profiles[index] = profile;
    this.save();
    return publicProfile(profile);
  }

  remove(id) {
    const index = this.state.profiles.findIndex((profile) => profile.id === id);
    ensure(index >= 0, 'API 配置不存在', 404);
    const [removed] = this.state.profiles.splice(index, 1);
    this.save();
    return publicProfile(removed);
  }

  active() {
    return {
      analysis:
        this.state.profiles.find((profile) => profile.enabled && profile.roles.analysis) || null,
      image: this.state.profiles.find((profile) => profile.enabled && profile.roles.image) || null,
    };
  }

  enabled() {
    return this.state.profiles.filter((profile) => profile.enabled);
  }

  activateDefaults() {
    const current = this.active();
    const analysis =
      current.analysis ||
      this.state.profiles.find((profile) => profile.enabled && profile.analysisModel);
    ensure(analysis, '请先启用一个已填写分析模型的 API');
    const image =
      current.image ||
      this.state.profiles.find((profile) => profile.enabled && profile.imageModel) ||
      null;
    let changed = false;
    for (const profile of this.state.profiles) {
      const nextAnalysis = profile.id === analysis.id;
      const nextImage = Boolean(image && profile.id === image.id);
      if (profile.roles.analysis !== nextAnalysis || profile.roles.image !== nextImage) {
        profile.roles.analysis = nextAnalysis;
        profile.roles.image = nextImage;
        changed = true;
      }
    }
    if (changed) this.save();
    return this.active();
  }

  compose() {
    const { analysis, image } = this.active();
    ensure(analysis, '请先启用一个参与分析的 API');
    return {
      mode: 'third-party',
      analysisProviderType: analysis.providerType || 'compatible',
      analysisBaseUrl: analysis.baseUrl,
      analysisApiKey: analysis.apiKey,
      analysisModel: analysis.analysisModel,
      imageGeneration: Boolean(image),
      imageProviderType: image?.providerType || analysis.providerType || 'compatible',
      imageBaseUrl: image?.baseUrl || analysis.baseUrl,
      imageApiKey: image?.apiKey || analysis.apiKey,
      imageModel: image?.imageModel || 'gpt-image-1',
      imageSize: null,
    };
  }

  updateActiveAnalysisModel(model) {
    const active = this.active().analysis;
    if (!active || active.analysisModel === model) return;
    this.update(active.id, { analysisModel: model });
  }

  normalize(input, previous) {
    const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
    const roles = input.roles ? normalizeRoles(input.roles) : previous?.roles || normalizeRoles();
    const providerType = normalizeProviderType(input.providerType ?? previous?.providerType);
    ensure(apiKey || previous?.apiKey, 'API Key 不能为空');
    ensure((apiKey || previous.apiKey).length <= MAX_KEY_LENGTH, 'API Key 长度无效');
    const analysisModel = optionalText(input.analysisModel ?? previous?.analysisModel, 160);
    const imageModel = optionalText(input.imageModel ?? previous?.imageModel, 160);
    ensure(!roles.analysis || analysisModel, '参与分析时必须填写分析模型');
    ensure(!roles.image || imageModel, '参与生图时必须填写图像模型');
    return {
      name: normalizeText(input.name ?? previous?.name, 'API 名称', 80),
      providerType,
      baseUrl:
        providerType === 'openai'
          ? OPENAI_API_BASE_URL
          : normalizeCompatibleBaseUrl(input.baseUrl ?? previous?.baseUrl),
      apiKey: apiKey || previous.apiKey,
      analysisModel,
      imageModel,
      enabled: input.enabled === undefined ? previous?.enabled !== false : Boolean(input.enabled),
      roles,
    };
  }

  applyRoleExclusivity(roles, id) {
    for (const profile of this.state.profiles) {
      if (profile.id === id) continue;
      if (roles.analysis) profile.roles.analysis = false;
      if (roles.image) profile.roles.image = false;
    }
  }

  save() {
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    renameSync(temporary, this.file);
    chmodSync(this.file, 0o600);
  }
}
