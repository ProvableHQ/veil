import Link from '@docusaurus/Link'
import Layout from '@theme/Layout'

export default function Home() {
  return (
    <Layout title="Veil" description="Use viem-style calls to use any Aleo wallet or SDK.">
      <main style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '70vh', padding: '2rem' }}>
        <h1 style={{ fontSize: '3.5rem', fontWeight: 800, marginBottom: '0.5rem' }}>Veil</h1>
        <p style={{ fontSize: '1.3rem', color: 'var(--ifm-color-emphasis-700)', maxWidth: 600, textAlign: 'center', marginBottom: '2rem' }}>
          Use viem-style calls to use any Aleo wallet or SDK.
        </p>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <Link className="button button--primary button--lg" to="/getting-started">
            Get Started
          </Link>
          <Link className="button button--secondary button--lg" href="https://github.com/ProvableHQ/veil">
            GitHub
          </Link>
        </div>
        <pre style={{ marginTop: '3rem', padding: '1.5rem 2rem', borderRadius: 8, fontSize: '0.9rem', maxWidth: 500, width: '100%' }}>
{`import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2'),
})

const balance = await client.getBalance({
  address: 'aleo1...',
})`}
        </pre>
      </main>
    </Layout>
  )
}
