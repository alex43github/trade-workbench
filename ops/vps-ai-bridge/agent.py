#!/usr/bin/env python3
import json
import os
import re
import subprocess
import time
from datetime import datetime, timezone
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://api.github.com"
REPO = os.environ.get("BRIDGE_REPO", "alex43github/trade-workbench").strip()
ISSUE = int(os.environ.get("BRIDGE_ISSUE", "1"))
ALLOWED_AUTHOR = os.environ.get("BRIDGE_ALLOWED_AUTHOR", "alex43github").strip()
TOKEN = os.environ["GITHUB_TOKEN"].strip()
POLL_SECONDS = max(10, int(os.environ.get("BRIDGE_POLL_SECONDS", "15")))
STATE_PATH = Path(os.environ.get("BRIDGE_STATE_PATH", "/var/lib/trade-workbench-ai-bridge/state.json"))
EXECUTOR = os.environ.get("BRIDGE_EXECUTOR", "/opt/trade-workbench-ai-bridge/executor.py")
TASK_RE = re.compile(r"^\[VPS_TASK ([A-Za-z0-9_.:-]{1,96})\]\s*$")

def api(method: str, path: str, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(
        API + path,
        method=method,
        data=data,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {TOKEN}",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "trade-workbench-ai-bridge/1",
            **({"Content-Type": "application/json"} if data is not None else {}),
        },
    )
    with urllib.request.urlopen(req, timeout=20) as response:
        raw = response.read()
        return json.loads(raw.decode()) if raw else None

def load_state():
    try:
        return json.loads(STATE_PATH.read_text())
    except Exception:
        return {}

def save_state(state):
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, separators=(",", ":")))
    os.chmod(tmp, 0o600)
    tmp.replace(STATE_PATH)

def recent_comments(since: str):
    query = urllib.parse.urlencode({"per_page": 100, "since": since})
    path = f"/repos/{REPO}/issues/{ISSUE}/comments?{query}"
    rows = api("GET", path)
    return rows if isinstance(rows, list) else []

def post_result(body: str):
    api("POST", f"/repos/{REPO}/issues/{ISSUE}/comments", {"body": body})

def parse_task(body: str):
    lines = body.splitlines()
    if not lines:
        return None
    match = TASK_RE.match(lines[0].strip())
    if not match:
        return None
    task_id = match.group(1)
    payload_text = "\n".join(lines[1:]).strip()
    if not payload_text:
        raise ValueError("missing JSON payload")
    payload = json.loads(payload_text)
    if not isinstance(payload, dict) or not isinstance(payload.get("action"), str):
        raise ValueError("payload must be a JSON object with string action")
    return task_id, payload

def run_executor(payload):
    proc = subprocess.run(
        ["/usr/bin/python3", EXECUTOR, json.dumps(payload, separators=(",", ":"))],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=600,
        check=False,
        env=os.environ.copy(),
    )
    if proc.returncode != 0:
        message = (proc.stderr or proc.stdout or f"executor exit {proc.returncode}").strip()
        raise RuntimeError(message[:1500])
    output = json.loads(proc.stdout)
    if not isinstance(output, dict):
        raise RuntimeError("executor returned non-object")
    return output

def format_result(task_id, action, result):
    status = "PASS" if result.get("ok") else "FAIL"
    summary = result.get("summary", {})
    body = json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True)
    return f"[VPS_RESULT {task_id}] {status}\n\nAction: {action}\n\n\`\`\`json\n{body}\n\`\`\`"

def bootstrap():
    state = load_state()
    if "cursor_at" in state:
        return state
    # Migration from V1: never replay the historical issue backlog. Start from
    # this process bootstrap instant; ChatGPT will post a fresh task afterward.
    state = {
        "cursor_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "last_comment_id": int(state.get("last_comment_id", 0)),
    }
    save_state(state)
    return state

def main():
    state = bootstrap()
    while True:
        try:
            comments = recent_comments(state["cursor_at"])
            pending = sorted(
                (c for c in comments if int(c.get("id", 0)) > int(state.get("last_comment_id", 0))),
                key=lambda c: int(c.get("id", 0)),
            )
            for comment in pending:
                cid = int(comment.get("id", 0))
                try:
                    user = (comment.get("user") or {}).get("login")
                    body = comment.get("body") or ""
                    if user != ALLOWED_AUTHOR:
                        continue
                    parsed = parse_task(body)
                    if not parsed:
                        continue
                    task_id, payload = parsed
                    action = payload["action"]
                    try:
                        result = run_executor(payload)
                        post_result(format_result(task_id, action, result))
                    except Exception as exc:
                        post_result(
                            f"[VPS_RESULT {task_id}] FAIL\n\nAction: {action}\n\nError: {type(exc).__name__}: {str(exc)[:1200]}"
                        )
                finally:
                    state["last_comment_id"] = cid
                    created_at = comment.get("created_at")
                    if isinstance(created_at, str) and created_at:
                        state["cursor_at"] = created_at
                    save_state(state)
        except Exception:
            pass
        time.sleep(POLL_SECONDS)

if __name__ == "__main__":
    main()
