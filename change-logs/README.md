# Trade Workbench Change Logs

Each scoped repository change has one REQ log. The log records the request, baseline, worktree, verification evidence, deployment boundary and remaining risks. Secrets, tokens, cookies and complete authentication headers must never be recorded.

Allowed status values are REQUESTED, IN_PROGRESS, VERIFIED_LOCAL, DEPLOYED_UNVERIFIED, VERIFIED_ON_VPS, PARTIAL, BLOCKED and FAILED. VERIFIED_LOCAL proves only local code and tests; it does not prove deployment or production behavior.

File names use REQ-YYYYMMDD-HHMMSS-short-slug.md with Asia/Shanghai time.
