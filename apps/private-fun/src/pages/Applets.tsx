import { Link } from 'react-router-dom'
import { Layout } from '../components/Layout.js'
import { APPLETS } from '../lib/applets.js'

export function Applets() {
  return (
    <Layout
      breadcrumb={['Applets']}
      title="Applets"
      subtitle="Cross-chain mini-apps built on private.fun's funding primitives."
    >
      <div className="pf-applet-grid">
        {APPLETS.map((applet) => (
          <Link
            key={applet.slug}
            to={`/applets/${applet.slug}`}
            className={`pf-applet-card${applet.disabled ? ' disabled' : ''}`}
            aria-disabled={applet.disabled || undefined}
          >
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span className="pf-applet-card-ico" aria-hidden>{applet.icon}</span>
              <h3>{applet.title}</h3>
            </div>
            <p>{applet.description}</p>
            {applet.disabled && <span className="pf-applet-card-badge">Coming soon</span>}
          </Link>
        ))}
        <div className="pf-applet-card add">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span className="pf-applet-card-ico" aria-hidden>+</span>
            <h3>Add an applet</h3>
          </div>
          <p>
            Drop a component in <code>src/pages/applets/</code> and register it
            in <code>src/lib/applets.ts</code>. The sidebar and this grid pick
            it up automatically.
          </p>
        </div>
      </div>
    </Layout>
  )
}
