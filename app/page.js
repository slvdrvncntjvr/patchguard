import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildProjectOverview } from '../lib/project-overview.mjs';

function Shield({ small = false }) {
  return <svg width={small ? 24 : 30} height={small ? 28 : 34} viewBox="0 0 30 34" fill="none" aria-hidden="true"><path d="M15 2 27 7v9c0 8-6 13-12 16C9 29 3 24 3 16V7L15 2Z" stroke="currentColor" strokeWidth="2"/><path d="m10 16 3.5 3.5L21 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}

export default async function Home() {
  const snapshot = JSON.parse(await readFile(path.join(process.cwd(), 'n8n', 'saved-workflow.json'), 'utf8'));
  const overview = buildProjectOverview(snapshot);
  const stages = [
    ['01', 'Detect', 'Repository Dependabot alerts', 'Configured'],
    ['02', 'Prioritize', 'CISA known exploited vulnerabilities', 'Configured'],
    ['03', 'Decide', 'Direct dependencies · stable fixes', 'Configured'],
    ['04', 'Patch', 'Branch → build → tests → audit → PR', 'Approval required'],
    ['05', 'Notify', 'Telegram patch and review alerts', overview.telegramConfigured ? 'Configured' : 'Setup needed'],
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Project navigation">
        <a href="/" className="brand" aria-label="PATCHGUARD home"><Shield/><span>PATCH<span className="brand-light">GUARD</span></span></a>
        <div className="workspace-label">WORKSPACE</div>
        <nav><a className="nav-item selected" href="#overview" aria-current="page"><span aria-hidden="true">◫</span> Overview</a><a className="nav-item" href="#pipeline"><span aria-hidden="true">⇢</span> Remediation pipeline</a><a className="nav-item" href="#setup"><span aria-hidden="true">⚙</span> Setup checklist</a></nav>
        <div className="sidebar-bottom"><span className="version">PATCHGUARD v1</span><p>Every patch starts with evidence.<br/>Every change ends with review.</p><a href={overview.repositoryUrl} target="_blank" rel="noopener noreferrer">View repository <Arrow/></a></div>
      </aside>

      <main id="overview">
        <header className="topbar"><span>Workspace <span className="breadcrumb">/</span> Overview</span><span className="snapshot-label"><span className="dot"/> Saved configuration</span></header>
        <div className="main-content">
          <section className="hero" aria-labelledby="page-title"><div><div className="eyebrow">DEPENDENCY SECURITY, WITH GUARDRAILS</div><h1 id="page-title">A safer path to<br/><span>your next patch.</span></h1><p>Find what affects your repository. Prioritize real risk.<br className="desktop-break"/> Turn eligible fixes into tested changes for human review.</p><a className="primary-button" href={overview.workflowUrl} target="_blank" rel="noopener noreferrer">Open n8n workflow <Arrow/></a></div><div className="hero-mark" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="shield-plate"><Shield/></div><span className="orbit-point"/><span className="hero-mark-label">DETECT. VERIFY. REVIEW.</span></div></section>

          <div className="notice"><span className="notice-icon" aria-hidden="true">Ⅱ</span><div><strong>{overview.monitoringEnabled ? 'A published workflow is recorded' : 'Monitoring is paused'}</strong><p>This view reads a saved configuration, not live scans. No vulnerability count is available until a scan is verified.</p></div><span className="pill amber">{overview.monitoringEnabled ? 'Snapshot only' : 'Awaiting setup'}</span></div>

          <section className="status-grid" aria-label="Integration configuration">
            <article className="status-card"><div className="card-label">MONITORED REPOSITORY <span aria-hidden="true">⌘</span></div><h2 className="repository-name">{overview.repository}</h2><a href={overview.repositoryUrl} target="_blank" rel="noopener noreferrer">View on GitHub <Arrow/></a></article>
            <article className="status-card"><div className="card-label">GITHUB CONNECTION <span className="tiny-dot green"/></div><h2>{overview.githubConfigured ? 'Credential connected' : 'Setup needed'}</h2><p>{overview.githubConfigured ? 'Assigned to all five GitHub nodes.' : 'Configure the n8n GitHub credential.'}</p></article>
            <article className="status-card"><div className="card-label">TELEGRAM ALERTS <span className={'tiny-dot ' + (overview.telegramConfigured ? 'green' : 'amber-dot')}/></div><h2>{overview.telegramConfigured ? 'Credential configured' : 'Waiting for your bot'}</h2><a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer">Open BotFather <Arrow/></a></article>
          </section>

          <section id="pipeline" className="pipeline-section" aria-labelledby="pipeline-title"><div className="section-heading"><div><span className="eyebrow">FROM SIGNAL TO ACTION</span><h2 id="pipeline-title">One controlled pipeline.</h2></div><span className="quiet-label">6-hour schedule · manual preview</span></div><div className="pipeline-grid">{stages.map(([number, title, description, status]) => <article className="stage" key={number}><span className="stage-number">{number}</span><h3>{title}</h3><p>{description}</p><span className={'stage-status ' + (status === 'Configured' ? 'ready' : '')}><span className="tiny-dot"/>{status}</span></article>)}</div></section>

          <div className="bottom-grid"><section className="findings-panel" aria-labelledby="findings-title"><div className="panel-heading"><h2 id="findings-title">Repository findings</h2><span className="pill neutral">Not scanned</span></div><div className="empty-state"><div className="empty-icon"><Shield small/></div><h3>Waiting for a verified scan</h3><p>An empty result is only an all-clear after every required API request succeeds. Until then, vulnerability status is unknown.</p><a href={overview.repositoryUrl + '/security/dependabot'} target="_blank" rel="noopener noreferrer">Open repository security <Arrow/></a></div></section>

          <section id="setup" className="setup-panel" aria-labelledby="setup-title"><div className="panel-heading"><h2 id="setup-title">Before the first live run</h2><span className="step-count">3 steps</span></div><ol className="checklist"><li><span className="check-number">1</span><div><h3>Connect your Telegram bot</h3><p>Save its token in n8n Credentials, then add the chat ID in the workflow configuration.</p></div></li><li><span className="check-number">2</span><div><h3>Publish and verify the repository</h3><p>Push the reviewed app and Actions files, enable Dependabot alerts, and verify the demo checks.</p></div></li><li><span className="check-number">3</span><div><h3>Approve the first controlled run</h3><p>Review credentials and tests before enabling dispatch. Publishing the n8n schedule needs separate approval.</p></div></li></ol></section></div>

          <footer><span><span className="footer-dot"/> No AI services or paid API dependencies</span><span>Human-reviewed pull requests. No automatic merge or deployment.</span></footer>
        </div>
      </main>
    </div>
  );
}
