import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Unshield } from './pages/Unshield.js'
import { Shield } from './pages/Shield.js'
import { Applets } from './pages/Applets.js'
import { APPLETS } from './lib/applets.js'

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/shield" replace />} />
        <Route path="/shield" element={<Shield />} />
        <Route path="/unshield" element={<Unshield />} />
        <Route path="/applets" element={<Applets />} />
        {APPLETS.filter((a) => !a.disabled).map((applet) => {
          const Cmp = applet.component
          return <Route key={applet.slug} path={`/applets/${applet.slug}`} element={<Cmp />} />
        })}
      </Routes>
    </BrowserRouter>
  )
}
