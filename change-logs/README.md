# Trade Workbench 修改日志规范

本目录是当前 VPS 网站的变更审计记录。每一条用户修改、修复、升级或部署要求对应一个 `REQ-*.md` 文件；不同对话继续同一需求时，继续更新原文件，不重复创建。

## 文件命名

```text
REQ-YYYYMMDD-HHMMSS-short-slug.md
```

时间使用 `Asia/Shanghai`。slug 使用简短英文或数字，不放密钥、域名密码或个人隐私。

## 必填章节

```markdown
# REQ-...

状态：REQUESTED
创建时间：YYYY-MM-DD HH:mm Asia/Shanghai
最后更新时间：YYYY-MM-DD HH:mm Asia/Shanghai

## 用户原始要求

## 范围与验收标准

## 修改前基线

## 并行开发与集成

- 开发基线版本：
- 开发基线 commit：
- 当前 main commit（开始时）：
- 工作分支和 worktree：
- 可能冲突的 REQ / 文件 / 数据契约：
- 最终集成 main commit：
- rebase/merge 结果：
- 语义冲突检查：

## 实施计划

## 实际修改

## 本地验证

## VPS 部署与线上验证

## 当前状态

## 剩余问题与下一步

## 时间线
```

## 证据规则

- `VERIFIED_LOCAL`：只能证明本地代码/测试通过，不能证明线上已更新。
- `DEPLOYED_UNVERIFIED`：只能证明文件已同步或服务重启，线上行为尚未充分验证。
- `VERIFIED_ON_VPS`：必须有 VPS 服务状态、目标接口和关键用户路径的实际验证证据。
- 并行任务必须先 rebase/merge 到最新 `main` 并完成语义检查，才有资格进入部署阶段；任务 worktree 不能直接部署。
- 失败、限流、缺权限、无法 SSH、缺少配置、数据源不可用都必须如实记录。
- 只记录脱敏结果；禁止写入 API Key、Secret、Token、Cookie、SSH 私钥和完整鉴权 header。

## 状态流转

```text
REQUESTED → IN_PROGRESS → VERIFIED_LOCAL → DEPLOYED_UNVERIFIED → VERIFIED_ON_VPS
                         ├→ PARTIAL
                         ├→ BLOCKED
                         └→ FAILED
```

状态可以停在中间状态，但不能为了让记录看起来完整而跳过实际证据。
