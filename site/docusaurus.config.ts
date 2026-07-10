import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Veil',
  tagline: 'Use viem-style calls to use any Aleo wallet or SDK.',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  // GitHub Pages project hosting; override for a custom domain:
  // DOCS_URL=https://veil.provable.com DOCS_BASE_URL=/
  url: process.env.DOCS_URL ?? 'https://provablehq.github.io',
  baseUrl: process.env.DOCS_BASE_URL ?? '/veil/',

  organizationName: 'ProvableHQ',
  projectName: 'veil',

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: '/',
          editUrl: 'https://github.com/ProvableHQ/veil/tree/main/site/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Veil',
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docs',
          position: 'left',
          label: 'Docs',
        },
        {
          to: '/api/transports',
          position: 'left',
          label: 'API Reference',
        },
        {
          href: 'https://github.com/ProvableHQ/veil',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Guides',
          items: [
            { label: 'Getting Started', to: '/getting-started' },
            { label: 'Public Client', to: '/clients/public-client' },
            { label: 'Wallet Client', to: '/clients/wallet-client' },
            { label: 'React', to: '/react/overview' },
          ],
        },
        {
          title: 'API Reference',
          items: [
            { label: 'Public Actions', to: '/api/public/getBlock' },
            { label: 'Wallet Actions', to: '/api/wallet/writeContract' },
            { label: 'Transports', to: '/api/transports' },
            { label: 'Types', to: '/api/types' },
          ],
        },
        {
          title: 'Community',
          items: [
            { label: 'GitHub', href: 'https://github.com/ProvableHQ/veil' },
            { label: 'Aleo Discord', href: 'https://discord.gg/aleo' },
          ],
        },
      ],
      copyright: `Copyright ${new Date().getFullYear()} Provable Inc.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
