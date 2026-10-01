# Veil CLI

`@provablehq/veil-cli` supplies the `veil inventory` application for scanner-backed
ARC20, ARC22, and native credits record maintenance. Requires Node 22.13+; the
SDK packages retain their existing runtime support.

```sh
veil inventory plan --asset credits.aleo --records 4
veil inventory run --config inventory.json --execute
```

Commands are `inspect`, `plan`, `rebalance`, `run`, and `status`. Writes require
`--execute`; otherwise the application prints plans. Run the foreground loop
under a service manager for background operation. Its SQLite journal belongs to
the CLI package; core exposes an injectable store interface and in-memory default.

See the [CLI configuration and recovery reference](https://github.com/ProvableHQ/veil/blob/main/packages/cli/README.md)
and [inventory SDK guide](../guides/record-inventory.md).
