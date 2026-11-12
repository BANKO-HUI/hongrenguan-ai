import React from 'react';
import { Aperture, Images, Settings2, ShieldCheck, WandSparkles } from 'lucide-react';
import { ThemeToggle } from './components.jsx';

export function StartupScreen({ error, onRetry, theme, onToggleTheme }) {
  return (
    <main className="login-screen startup-screen">
      <ThemeToggle className="login-theme-toggle" theme={theme} onToggle={onToggleTheme} />
      <div className="login-atmosphere" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <section className="login-brand-panel">
        <div className="login-brand">
          <span>
            <Aperture size={23} />
          </span>
          <div>
            <strong>红人馆AI</strong>
            <small>FASHION RESTYLE WORKSPACE</small>
          </div>
        </div>
        <div className="login-statement">
          <span className="eyebrow">AI RESTYLE STUDIO</span>
          <h1>
            从一张原图，
            <br />
            到可交付的改款成片。
          </h1>
          <p>一个本机、可追踪、保留原稿的服装改款工作台。</p>
        </div>
        <div className="login-capabilities">
          <span>
            <WandSparkles size={15} /> 圈选、涂鸦与命名参考改款
          </span>
          <span>
            <Images size={15} /> 成片、白底与历史版本管理
          </span>
          <span>
            <ShieldCheck size={15} /> 素材和成片保存在本机
          </span>
        </div>
      </section>

      <section className="login-card startup-card" aria-label="红人馆AI启动状态">
        <div className="login-card-index">LOCAL / STARTUP</div>
        <div>
          <span className="login-card-icon">
            {error ? <Settings2 size={22} /> : <Aperture size={22} />}
          </span>
          <h2>{error ? '本机工作台暂未连接' : '正在开启红人馆AI'}</h2>
          <p>
            {error
              ? '请确认本机服务正在运行，然后重新连接。'
              : '正在载入改款成片与任务状态，完成后将直接进入改款中心。'}
          </p>
        </div>
        <div className="login-benefits">
          <span>
            <ShieldCheck size={14} /> 无需登录即可浏览和管理本机成片
          </span>
          <span>
            <Settings2 size={14} /> 帐号授权与第三方 API 统一在设置中管理
          </span>
        </div>
        {error ? (
          <button className="login-primary" type="button" onClick={onRetry}>
            重新连接本机工作台
          </button>
        ) : (
          <div className="startup-launch-status" role="status">
            <span className="button-spinner" aria-hidden="true" />
            正在载入工作区…
          </div>
        )}
        {error && (
          <p className="login-error" role="alert">
            {error}
          </p>
        )}
        <small className="login-legal">AI 帐号未连接时，原图、参考图与已有成片仍可正常查看。</small>
      </section>
    </main>
  );
}
