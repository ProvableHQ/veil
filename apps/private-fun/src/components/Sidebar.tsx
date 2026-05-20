import { NavLink } from 'react-router-dom'

type Item = { to: string; label: string; icon: string; muted?: boolean; suffix?: string }

const UTILITIES: Item[] = [
  { to: '/fund-out', label: 'Fund out', icon: '↗' },
  { to: '/bridge-in', label: 'Bridge in', icon: '↙' },
]

const APPLETS: Item[] = [
  { to: '/applets/pump-launch', label: 'Pump launch', icon: '🚀' },
  { to: '/applets/polymarket', label: 'Polymarket', icon: '🟣', muted: true, suffix: 'soon' },
]

export function Sidebar() {
  return (
    <aside className="pf-sidebar">
      <div className="pf-side-section">
        <div className="pf-label">Utilities</div>
        {UTILITIES.map((item) => (
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
        {APPLETS.map((item) => (
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
        <div className="pf-add">
          <span>+</span> Add applet
        </div>
      </div>
    </aside>
  )
}
