# Shield Swap inventory

`shield-swap inventory` manages spendable records for ARC20, ARC22, native
credits, and compatible custom assets. It ships in `@provablehq/shield-swap-cli`
and requires Node 22.13+ for its SQLite journal. SDK packages retain their
existing runtime support.

```sh
shield-swap inventory plan --asset credits.aleo --records 4
shield-swap inventory run --config inventory.json --execute
```

The commands are `inspect`, `plan`, `rebalance`, `run`, and `status`. Inventory
uses the saved Shield Swap account or a key supplied through the environment;
it does not require DEX authentication. Writes require `--execute`. Without it,
`rebalance` and `run` print plans.

Run the foreground loop under a service manager for background operation.
`--json` returns one object; a continuous `run --execute --json` emits its
summary on shutdown. Set `VEIL_INVENTORY_DB` on participating trading commands
to share reservations with maintenance. Trading coordination remains off unless
that variable is set.

See the [configuration and recovery reference](https://github.com/ProvableHQ/veil/blob/main/packages/shield-swap-cli/INVENTORY.md),
[Shield Swap CLI](./shield-swap-cli.md), and [inventory SDK guide](../guides/record-inventory.md).
