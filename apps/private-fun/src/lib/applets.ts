import type { ComponentType } from 'react'
import { PumpLaunch } from '../pages/PumpLaunch.js'

export type AppletManifestEntry = {
  /** Path slug, used in the URL: /applets/<slug> */
  slug: string
  title: string
  icon: string
  description: string
  /** React component for the applet page. */
  component: ComponentType
  /** Set when the applet isn't yet shippable; renders muted in the sidebar and disabled in the grid. */
  disabled?: boolean
}

/**
 * Add an applet:
 *   1. Create the page component under `src/pages/applets/MyApplet.tsx`.
 *   2. Import + add an entry to APPLETS below.
 *   3. The sidebar and /applets landing pick it up automatically.
 *      (App.tsx still needs an explicit route registration — see App.tsx.)
 */
export const APPLETS: AppletManifestEntry[] = [
  {
    slug: 'pump-launch',
    title: 'Pump launch',
    icon: '🚀',
    description: 'Anonymous pump.fun coin creation funded by bridged ALEO.',
    component: PumpLaunch,
  },
  {
    slug: 'polymarket',
    title: 'Polymarket',
    icon: '🟣',
    description: 'Private USDC funding for Polymarket positions (Phase 2).',
    component: PumpLaunch, // placeholder until built; sidebar marks disabled
    disabled: true,
  },
]
