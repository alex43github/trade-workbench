# Source baseline — 2026-09-13

This document records a safe, local-source recovery baseline for the Trade
Workbench repository. It is not a production release record and does not prove
equivalence to a VPS deployment.

## Capture provenance

- Repository: `alex43github/trade-workbench`
- Base local HEAD: `99e374be905298dfee3e876a027c43a4d8c88c4a`
- Recovery branch: `source-baseline/20260913-current`
- Capture date: `2026-09-13` (Asia/Shanghai)
- Manifest: [`SOURCE_BASELINE.json`](../SOURCE_BASELINE.json) and
  [`SOURCE_BASELINE.sha256`](../SOURCE_BASELINE.sha256)

The captured worktree includes the current application, gateway, radar,
trading-safety, test, documentation, scripts, and deployment-support source
changes, including intentional tracked removals.

## Exclusions

This baseline excludes environment files other than safe templates, credentials
and private key material, SQLite/DB and local runtime state, logs/dumps/HAR
captures, dependency/build/cache directories, and production exports. The
repository `.gitignore` was extended to cover common local runtime artifacts.

The secret audit scanned staged paths by filename and common credential-pattern
classes without storing any matched values. Documentation/template placeholders
were reviewed as placeholders; examples already present in the base README were
not rewritten by this recovery operation.

The JSON and SHA-256 manifests hash the same source-path set. Both provenance
artifacts are excluded from that set to avoid self-referential hashes.

## Known divergence

The local source baseline may differ from public `main` and from the current
VPS. In particular, it does not establish a VPS production provenance baseline.
No deployment, VPS access, service restart, trading action, or credential
disclosure is part of this capture.
