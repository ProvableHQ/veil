import type { ReactNode } from 'react'
import { Sidebar } from './Sidebar.js'
import { WalletConnect } from './WalletConnect.js'

export type LayoutProps = {
  /** e.g. ['Vault', 'Unshield'] — rendered as breadcrumb. */
  breadcrumb?: string[]
  title: string
  subtitle?: string
  children: ReactNode
}

export function Layout({ breadcrumb, title, subtitle, children }: LayoutProps) {
  return (
    <div className="pf-app">
      <header className="pf-header">
        <div className="pf-brand">
          <span className="pf-brand-dot" aria-hidden />
          private.fun
          <span className="pf-brand-tag">cross-chain · private</span>
        </div>
        <WalletConnect />
      </header>
      <div className="pf-body">
        <Sidebar />
        <main className="pf-main">
          {breadcrumb && breadcrumb.length > 0 && (
            <div className="pf-crumbs">
              {breadcrumb.slice(0, -1).map((b, i) => (
                <span key={i}>{b} · </span>
              ))}
              <strong>{breadcrumb[breadcrumb.length - 1]}</strong>
            </div>
          )}
          <h1 className="pf-title">{title}</h1>
          {subtitle && <p className="pf-sub">{subtitle}</p>}
          {children}
        </main>
      </div>
    </div>
  )
}
