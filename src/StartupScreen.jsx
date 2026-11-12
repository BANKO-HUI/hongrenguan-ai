import React from 'react';
import { Aperture, Images, Layers3, Settings2, ShieldCheck } from 'lucide-react';
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
            <strong>Bomi智绘</strong>
            <small>FASHION INTELLIGENCE WORKSPACE</small>
          </div>
        </div>
        <div className="login-statement">
          <span className="eyebrow">STUDIO 3.0</span>
          <h1>
            从趋势线索，
            <br />
            到可交付的服装系列。
          </h1>
          <p>一个本机、可追踪、不覆盖原稿的设计工作台。</p>
        </div>
        <div className="login-capabilities">
          <span>
            <Layers3 size={15} /> 多参考系列设计
          </span>
          <span>
            <Images size={15} /> 改款、白底与版本管理
          </span>
          <span>
            <ShieldCheck size={15} /> 素材和成片保存在本机
          </span>
        </div>
      </section>

      <section className="login-card startup-card" aria-label="Bomi智绘启动状态">
        <div className="login-card-index">LOCAL / STARTUP</div>
        <div>
          <span className="login-card-icon">
            {error ? <Settings2 size={22} /> : <Aperture size={22} />}
          </span>
          <h2>{error ? '本机工作台暂未连接' : '正在开启 Bomi智绘'}</h2>
          <p>
            {error
              ? '请确认本机服务正在运行，然后重新连接。'
              : '正在载入项目、素材与任务状态，完成后将直接进入工作页面。'}
          </p>
        </div>
        <div className="login-benefits">
          <span>
            <ShieldCheck size={14} /> 无需登录即可浏览和管理本机项目
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
        <small className="login-legal">AI 帐号未连接时，设计资料与已有项目仍可正常查看。</small>
      </section>
    </main>
  );
}
