import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docs: [
    'introduction',
    'getting-started',
    {
      type: 'category',
      label: 'Clients',
      items: [
        'clients/public-client',
        'clients/wallet-client',
        'clients/transports',
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      items: [
        'guides/reading-chain-state',
        'guides/executing-transactions',
        'guides/working-with-records',
        'guides/transaction-lifecycle',
        'guides/contract-instances',
      ],
    },
    {
      type: 'category',
      label: 'React',
      items: [
        'react/overview',
        'react/veil-provider',
        'react/use-veil-wallet',
      ],
    },
  ],
  api: [
    {
      type: 'category',
      label: 'Public Actions',
      items: [
        'api/public-actions',
      ],
    },
    {
      type: 'category',
      label: 'Wallet Actions',
      items: [
        'api/wallet-actions',
      ],
    },
    {
      type: 'category',
      label: 'Transports',
      items: [
        'api/transports',
      ],
    },
    {
      type: 'category',
      label: 'Types',
      items: [
        'api/types',
      ],
    },
  ],
};

export default sidebars;
