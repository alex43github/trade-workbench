# PR #15 Fifth Final Audit Repair Plan

1. Add a frozen master-gzip to Task-002B-compatible per-symbol CSV.zst cache converter and a deterministic cache manifest.
2. Test the conversion contract against a small fixture; do not materialize the canonical 242MB object or run chunk002 OOS.
3. Pin converter, Task-002B, generator, and any invoked external dependencies; record absence of Task-003/004 delegation if verified.
4. Dry-run the exact RESEARCH_QUEUE.json RFC-6902 add against canonical bytes and record SHA/revision/key preservation.
5. Run one final focused plus radar verification set, then regenerate every final artifact from that same run with split chunk002 access flags.
6. Commit, push, comment on PR #15, and stop for Sixth Final Audit.
