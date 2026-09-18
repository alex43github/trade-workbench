# VPS AI Bridge V1

Purpose: remove the user's Mac/ssh-agent from the normal ChatGPT -> GitHub -> VPS control path.

Security properties:
- Watches only issue #1 in alex43github/trade-workbench.
- Accepts tasks only when the GitHub comment author is exactly alex43github.
- Task prefix must be [VPS_TASK <id>].
- Payload must be JSON.
- No arbitrary shell command field exists.
- Executor has an explicit action allowlist.
- V1 actions: health and update_executor.
- Existing GitHub token should be fine-grained and limited to this repository, with Issues read/write, Contents read, Metadata read.
- Token is stored only in /etc/trade-workbench-ai-bridge.env with mode 0600 and must never be committed.

Task example:

[VPS_TASK bridge-smoke-001]
{"action":"health"}

Executor upgrade example requires an exact expected SHA-256:

[VPS_TASK bridge-upgrade-001]
{"action":"update_executor","approved":true,"ref":"<git-ref>","sha256":"<64 hex chars>"}

The agent bootstraps from the newest existing issue comment, so historical TASK comments are never replayed on first installation.
