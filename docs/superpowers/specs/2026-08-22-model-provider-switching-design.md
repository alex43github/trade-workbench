# 后台 AI 模型供应商切换设计

## 目标

交易工作台的所有 AI 分析应使用一个可验证、可切换的后台模型目标，而不是固定调用 OpenAI。管理员可以：

- 使用官方 OpenAI API；
- 配置多个 CCSwitch / OpenCode Go / Agent Router 等兼容通道；
- 在 **OpenAI Responses** 与 **Chat Completions** 协议之间选择；
- 获取或手动维护通道可用模型，并选择具体模型；
- 点击“测试并启用”，仅在服务端连通性验证成功后切换，页面显示绿色状态灯；
- 随时切回官方 OpenAI，且不影响当前正在与 Codex 对话所使用的模型。

## 范围

本次覆盖网站内的交易计划复核、持仓分析、专家会诊、定时扫描/通知等全部服务端 AI 调用。

不覆盖浏览器端直连第三方模型，也不把任何 API Key 下发给浏览器。既有 Anthropic、DeepSeek、OpenCode Go 环境变量兼容配置保持可用，统一纳入新的解析逻辑。

## 使用场景

预置入口支持多个独立通道。以用户提供的配置为例：

- 供应商名称：`OpenCode Go`
- API Base URL：`https://opencode.ai/zen/go/v1`
- 协议：`Responses` 或 `Chat Completions`
- 默认模型：`deepseek-v4-flash`
- 可映射模型示例：`glm-5.2`、`glm-5.1`、`kimi-k2.7-code`、`deepseek-v4-pro`、`deepseek-v4-flash`、`mimo-v2.5-pro`

另一个通道可配置为：

- 供应商名称：`Agent Router`
- API Base URL：`https://agentrouter.org/v1`
- 协议：`Responses`（也允许改为 `Chat Completions`）
- 默认模型：`gpt-5.6-sol`

该通道只服务本网站后台分析；它与本次 Codex 对话或 ChatGPT Plus 订阅无关。

## 架构

### 1. 统一的活动模型目标

新增“活动模型目标”记录，替代仅保存静态 provider id 的方式：

```ts
type ActiveAiTarget = {
  provider: "openai" | "ccswitch" | "anthropic" | "deepseek" | "opencode_go";
  model: string;
  protocol: "responses" | "chat_completions" | "anthropic_messages";
  verifiedAt?: string;
  verification?: "verified" | "failed" | "unverified";
};
```

`ccswitch` 是可配置的兼容通道族：每个通道有独立的名称、Base URL、协议、Key 引用和模型目录；每个通道可挂多个模型。切换模型时只更新活动目标，不复制或暴露 Key。原有环境变量供应商继续作为兼容的只读候选项。

### 2. 密钥、配置与模型目录

- API Key 只存服务端：官方 OpenAI 使用 `OPENAI_API_KEY`；每个 CCSwitch 通道使用自己的服务端 Key 引用，例如 `CCSWITCH_OPENCODE_GO_API_KEY` 与 `CCSWITCH_AGENT_ROUTER_API_KEY`。
- 通道名称、Base URL、协议、模型目录和当前模型属于非密钥配置；每个通道与模型目录拥有稳定 ID，模型目录的每项包含显示名、真实模型 ID、可选上下文窗口。
- 本地开发环境可通过现有管理员凭证接口保存测试配置；生产环境只从部署环境变量/密钥文件读取 Key、Base URL 与允许模型目录。
- 生产界面允许在服务端预设的模型目录中切换和验证，不允许浏览器写入生产 Key。这样既能切换模型，也不会把密钥保存到数据库或浏览器。

建议生产环境变量：

```text
OPENAI_API_KEY=
OPENAI_MODEL=
CCSWITCH_CHANNELS_JSON=[
  {"id":"opencode-go","label":"OpenCode Go","baseUrl":"https://opencode.ai/zen/go/v1","protocol":"responses","secretEnv":"CCSWITCH_OPENCODE_GO_API_KEY","models":[{"label":"DeepSeek V4 Flash","model":"deepseek-v4-flash"}]},
  {"id":"agent-router","label":"Agent Router","baseUrl":"https://agentrouter.org/v1","protocol":"responses","secretEnv":"CCSWITCH_AGENT_ROUTER_API_KEY","models":[{"label":"GPT-5.6 Sol","model":"gpt-5.6-sol"}]}
]
CCSWITCH_OPENCODE_GO_API_KEY=
CCSWITCH_AGENT_ROUTER_API_KEY=
```

### 3. 网关与协议适配

`model-gateway` 改为接收已解析的模型目标：

- `responses`：请求 `${baseUrl}/responses`；
- `chat_completions`：请求 `${baseUrl}/chat/completions`；
- `anthropic_messages`：保留现有 Anthropic 分支。

Base URL 允许填写根路径（例如上述 `/v1`），网关负责补齐对应终点，并避免重复拼接。所有调用继续要求结构化 JSON 输出，沿用现有认证、配额、限流、超时和无效输出错误分类。

### 4. 测试、启用与状态灯

新增受管理员会话保护的接口：

- `GET /api/advisory/provider/channels`：返回脱敏后的通道、模型和验证状态；
- `GET /api/advisory/provider/models`：从指定、已保存且通过 URL 校验的通道拉取模型目录；拉取失败时保留手工目录；
- `POST /api/advisory/provider/test`：以指定通道的候选模型发送最小结构化请求，超时受限；返回仅含状态、模型、协议和脱敏错误说明；
- `POST /api/advisory/provider/activate`：仅允许最近一次测试成功的通道+模型目标成为活动目标。

测试失败绝不切换活动模型。页面状态统一为：绿色“已验证并启用”、绿色“已验证”、琥珀色“未验证/验证过期”、红色“测试失败”。错误不显示供应商原始响应、Token 或 Key。

### 5. 设置页交互

设置页增加“后台 AI 模型”区域：

1. 选择“官方 OpenAI”或某一个 CCSwitch 兼容通道；
2. CCSwitch 以通道卡片展示 OpenCode Go、Agent Router 和后续新增通道，每张卡显示名称、Base URL、协议（Responses / Chat Completions）和验证状态；
3. 选中通道后可选择其模型目录，点击“获取模型列表”后可补充模型，也可手动增加模型 ID；
4. 点击“测试并启用”；成功后在所选通道与模型旁显示绿灯，并在页首显示“当前后台模型”；
5. 切换到官方 OpenAI、其他通道或其他模型后同样必须测试成功才生效。

模型选择针对网站后台 AI，不改变 Codex、浏览器或 ChatGPT 本身正在使用的模型。

### 6. 全部分析链路统一接入

下列链路全部改为通过 `getActiveModelConfig()` 与统一网关，不允许再直接请求 OpenAI 固定地址：

- AI 计划复核；
- 持仓单币分析及专家 Skill 汇总；
- 专家会诊；
- 定时扫描后的 AI 解释和 Bark 文案生成；
- 后续新增的 AI 分析接口。

当活动模型不可用时，调用返回可操作的中文状态（例如“当前 CCSwitch 模型配额不足，请在设置页切换或重试”），不得静默回退为另一个模型。

## 安全要求

- API Key 绝不通过 GET 接口、页面初始数据、日志或错误信息返回；只返回是否已配置与尾部掩码。
- 所有配置、测试、启用接口均需要管理员会话、同源校验和请求体校验。
- 远程通道 URL 仅允许 HTTPS 公网地址；拒绝 localhost、回环、私有网段、链路本地地址、云元数据地址及携带凭据的 URL，以避免服务端请求伪造（SSRF）。
- 模型列表请求不接受用户自定义请求头，不跟随跳转到非公网地址，并有严格超时、响应大小和速率限制。
- 生产部署继续使用 systemd/容器环境密钥文件；`.env`、数据库备份和前端构建产物不得包含真实 Key。
- 验证、切换和失败事件写入审计日志，但仅记录供应商、模型、协议、时间和错误类别。

## 验收标准

- 可在设置页分别配置和展示 OpenCode Go、Agent Router 等多个通道，各通道可使用独立 Key、`/v1` 根地址与 Responses 或 Chat Completions 协议；
- 可选择 `deepseek-v4-flash` 等模型，点击“测试并启用”后看到绿色状态灯；
- 测试失败时，原活动模型不被替换，页面显示不含敏感信息的失败原因；
- 官方 OpenAI 与 CCSwitch 模型都能切换、验证，并成为实际后台分析模型；
- 计划复核、持仓分析、会诊和定时任务均使用同一活动模型目标；
- 本地与生产环境中均不会将 API Key 发送到浏览器；
- 单元、接口和渲染测试覆盖协议选择、模型切换、失败不切换、URL 安全校验与调用链统一性。
