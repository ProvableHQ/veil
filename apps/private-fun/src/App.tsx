import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { FundOut } from './pages/FundOut.js'
import { BridgeIn } from './pages/BridgeIn.js'
import { Applets } from './pages/Applets.js'
import { APPLETS } from './lib/applets.js'

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/fund-out" replace />} />
        <Route path="/fund-out" element={<FundOut />} />
        <Route path="/bridge-in" element={<BridgeIn />} />
        <Route path="/applets" element={<Applets />} />
        {APPLETS.filter((a) => !a.disabled).map((applet) => {
          const Cmp = applet.component
          return <Route key={applet.slug} path={`/applets/${applet.slug}`} element={<Cmp />} />
        })}
      </Routes>
    </BrowserRouter>
  )
}
