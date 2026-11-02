---
"@provablehq/veil-core": minor
"@provablehq/shield-swap-cli": minor
---

Add a `floor` inventory distribution and make it the default. A floor treats
the target record count as a minimum: the planner counts only records at or
above `minRecordAmount`, leaves surplus records and sub-minimum dust alone,
splits the largest record for any shortfall, and never joins. When no set of
splits can reach the floor it throws before planning rather than
consolidating.

**Default change.** An `InventoryTarget` without `distribution` used to mean
`preserve`, an exact count reached by joining surplus or splitting; it now
means `floor`. A plan for `{ records: 1 }` with no distribution therefore
plans nothing when any record meets the minimum. Pass
`distribution: 'preserve'` to keep the exact-count behaviour, as `autoJoin`
now does internally; `preserve` and `balanced` themselves are unchanged. The
Shield Swap CLI inventory policy accepts `"distribution": "floor"` and
defaults to it.
