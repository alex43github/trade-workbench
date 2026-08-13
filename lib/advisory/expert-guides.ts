import type { ExpertId } from "./types.ts";

// Versioned, deployable extracts from the four read-only Skills. The full source
// libraries remain outside the Worker bundle; these guides preserve decision
// order, boundaries and citation namespaces without pretending to contain every rule.
export const EXPERT_GUIDES: Readonly<Record<ExpertId, string>> = {
  ict: `
体系边界：只使用 ICT/PDF 知识层。先按日线→4H→1H建立偏见链，再判断 DOL；流动性目标先于方向。
工作流：标记旧高低/EQH/EQL与不平衡 → 等扫取 → 检查 displacement/CISD/MSS → 只在可定义失效的 FVG/IFVG/OB 区域形成候选 → 对侧流动性分批退出。
确认要求：单独出现 FVG、OB 或 CISD 不足以交易；没有独立结构确认就等待/观望。多头优先 discount，空头优先 premium。
币安边界：不得迁移 ET Killzone、COT、DXY/利率三合一、固定 pips、ADR、标准差和固定 R:R 参数。
风险纪律：止损由结构失效定义，仓位由最大亏损反推；原资料的风险比例只作为待验证参数。
可用引用示例：PDF-001 p.4-p.7；PDF-005 p.1-p.4；PDF-024 p.84-p.100；PDF-039 p.8-p.12。sourceRefs 只能使用 PDF-### p.N 格式。`,
  street: `
体系边界：只使用街哥知识层，所有模型仍是 research_only / candidate_unverified。
工作流：先写多/空/观望条件 → 周/日/4H/1H分类趋势、震荡或混乱 → 裸K标箱体、前高低、真假突破与收线 → AVWAP/FRVP/FIB仅作区域过滤 → 写触发、失效、目标和禁做条件。
候选模型：假突破收回后回抽；有效突破快速离开后的浅回踩；结构与 FIB/POC 重叠反应；关键位右侧反转。
禁做：箱体中部、混乱行情、未收线抢跑、只凭插针或指标、无法定义失效、数据链路不完整时不做并输出观望。
边界：AVWAP 锚点和 FRVP 范围必须事前冻结；跨市场价位、时段和参数不得迁移 Binance。
可用引用示例：JG-002 @ 00:01:37；JG-002 @ 00:08:21；JG-012 @ 00:03:09-00:03:39；JG-028 @ 00:14:15-00:16:17。sourceRefs 只能使用 JG-### @ HH:MM:SS 格式。`,
  jingxin: `
体系边界：只使用静心知识层；规则为 research_only，口述概率不是统计胜率。
工作流：数据边界 → 日线/4H/1H大小周期 → 关键位置范围 → 右侧 setup → 触发 → 结构失效 → 支持证据、反证、未知和不做条件。
核心：大周期定趋势、小周期找切入；直接破位不追，等待回踩或横盘再次破位的“右右侧”；反转需要关键位置、破位、回抽无法收回。
风险纪律：以结构止损距离反推数量；新趋势确认前不宜过早推保护；无法定义结构失效或证据冲突时等待/观望。
来源隔离：FVG/OB 为后期采用的 ICT 术语，不得把 OB、FVG、真空区静默等同；外汇/黄金/美股参数不得迁移 Binance。
可用引用示例：JX-001 @ 00:07:01-00:09:40；JX-012 @ 00:05:03-00:07:42；JX-024 @ 01:12:22-01:14:26；JX-034 @ 00:43:32-00:47:14。sourceRefs 只能使用 JX-### @ HH:MM:SS 格式。`,
  bitlanglang: `
体系边界：只使用 bit浪浪知识层；全部规则 candidate_unverified，案例价位和口述概率不得迁移。
工作流：先看 BTC 位置和市场春夏秋冬 → 判断大小周期是否共振 → 给分歧定级 → 识别箱体的二次探顶/探底阶段 → 只在体系内点位寻找触发 → 写结构止损、轻仓与分批退出。
强势币：优先市场合力、走势流畅且有带动性的币；日线大平台突破回踩重启动是主升浪候选。大级别方向明确后可用小级别拐点试单，但失败不否定上层逻辑。
禁做：顺大逆小、高位追突破、五浪高位做多、控盘币、箱体中段、FOMO/报复开仓、无法把止损放在结构拐点时不做并输出观望。
风险纪律：追高必须降仓位并放宽到有效结构止损；重仓或高杠杆会破坏止损执行；目标一附近分批退出。
可用引用示例：BL-001 @ 00:13:05-00:16:44；BL-003 @ 00:33:52-00:34:08；BL-016 @ 00:29:40-00:33:47；BL-019 @ 00:03:09-00:04:43。sourceRefs 只能使用 BL-### @ HH:MM:SS 格式。`,
};

export const ALLOWED_SOURCE_REFS: Readonly<Record<ExpertId, readonly string[]>> = {
  ict: ["PDF-001 p.4-p.7", "PDF-005 p.1-p.4", "PDF-024 p.84-p.100", "PDF-039 p.8-p.12"],
  street: ["JG-002 @ 00:01:37", "JG-002 @ 00:08:21", "JG-012 @ 00:03:09-00:03:39", "JG-028 @ 00:14:15-00:16:17"],
  jingxin: ["JX-001 @ 00:07:01-00:09:40", "JX-012 @ 00:05:03-00:07:42", "JX-024 @ 01:12:22-01:14:26", "JX-034 @ 00:43:32-00:47:14"],
  bitlanglang: ["BL-001 @ 00:13:05-00:16:44", "BL-003 @ 00:33:52-00:34:08", "BL-016 @ 00:29:40-00:33:47", "BL-019 @ 00:03:09-00:04:43"],
};

export const SOURCE_REF_PATTERNS: Readonly<Record<ExpertId, RegExp>> = {
  ict: /^PDF-\d{3} p\.\d+(?:-p\.\d+)?$/,
  street: /^JG-\d{3} @ \d{2}:\d{2}:\d{2}(?:-\d{2}:\d{2}:\d{2})?$/,
  jingxin: /^JX-\d{3} @ \d{2}:\d{2}:\d{2}(?:-\d{2}:\d{2}:\d{2})?$/,
  bitlanglang: /^BL-\d{3} @ \d{2}:\d{2}:\d{2}(?:-\d{2}:\d{2}:\d{2})?$/,
};
