---
"@provablehq/veil-core": minor
"@provablehq/shield-swap-cli": minor
---

Add a `floor` inventory distribution that treats the target record count as a
minimum. The planner counts only records at or above `minRecordAmount`, leaves
surplus records and sub-minimum dust alone, and splits the largest record for
any shortfall; it never joins. When no set of splits can reach the floor it
throws before planning rather than consolidating. `preserve` and `balanced`
are unchanged: `preserve` still joins or splits to the exact count, and any
record below the minimum still triggers its full repack. The Shield Swap CLI
inventory policy accepts `"distribution": "floor"`.
