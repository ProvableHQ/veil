import { NavLink } from 'react-router-dom'
import { APPLETS } from '../lib/applets.js'

type Item = { to: string; label: string; icon: string; muted?: boolean; suffix?: string }

const VAULT_ACTIONS: Item[] = [
  { to: '/shield', label: 'Shield', icon: '↙' },
  { to: '/unshield', label: 'Unshield', icon: '↗' },
]

const APPLET_NAV: Item[] = APPLETS.map((a) => ({
  to: `/applets/${a.slug}`,
  label: a.title,
  icon: a.icon,
  muted: a.disabled,
  suffix: a.disabled ? 'soon' : undefined,
}))

export function Sidebar() {
  return (
    <aside className="pf-sidebar">
      <div className="pf-side-section">
        <div className="pf-label">Vault</div>
        {VAULT_ACTIONS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `pf-item${isActive ? ' active' : ''}`}
          >
            <span className="pf-ico">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </div>

      <div className="pf-side-section">
        <div className="pf-label">Applets</div>
        <NavLink
          to="/applets"
          end
          className={({ isActive }) => `pf-item${isActive ? ' active' : ''}`}
        >
          <span className="pf-ico">▣</span>
          All applets
        </NavLink>
        {APPLET_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `pf-item${isActive ? ' active' : ''}${item.muted ? ' muted' : ''}`
            }
            onClick={item.muted ? (e) => e.preventDefault() : undefined}
          >
            <span className="pf-ico">{item.icon}</span>
            {item.label}
            {item.suffix && <span className="pf-side-soon">{item.suffix}</span>}
          </NavLink>
        ))}
        <NavLink to="/applets" className="pf-add">
          <span>+</span> Add applet
        </NavLink>
      </div>
    </aside>
  )
}
