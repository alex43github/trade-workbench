import { AdvisoryShell } from "../components/AdvisoryShell";
import { StatusBadge } from "../components/StatusBadge";
import styles from "../advisory.module.css";

export default function ReplayPage() {
  return <AdvisoryShell active="/replay" title="盲测实验室" eyebrow="BLIND MARKET REPLAY / PHASE 02">
    <section className={styles.replayHero}><StatusBadge tone="accent">下一阶段</StatusBadge><h2>任意时间点开始，<br />在结束之前没有人知道答案。</h2><p>正式盲测将隐藏真实日期和币种，提供180天热身数据，并允许预设或手工输入任意测试长度。启动后无人为介入，结束冻结成绩后才揭晓。</p><button disabled>创建盲测房间 · 尚未开放</button></section>
    <section className={styles.replayGrid}><article><b>01</b><h3>随机种子锁定</h3><p>服务器先提交种子哈希，再从合格历史区间抽取起点。</p></article><article><b>02</b><h3>时间与资产匿名</h3><p>正式计分使用虚拟时间、资产别名和等比例价格缩放。</p></article><article><b>03</b><h3>事件驱动推进</h3><p>只有收盘、成交、止损、止盈或预定复查节点唤醒AI。</p></article><article><b>04</b><h3>冻结后揭晓</h3><p>所有意见、订单和成绩冻结后，才公布真实日期与完整走势。</p></article></section>
    <section className={styles.section}><div className={styles.sectionHead}><div><small>FUTURE ENGINE</small><h2>已确定的技术边界</h2></div></div><div className={styles.techRows}><div><span>盲测调度</span><b>自建 Blind Replay Coordinator</b></div><div><span>主模拟引擎</span><b>NautilusTrader 独立服务</b></div><div><span>加密复算</span><b>Jesse 验证侧车</b></div><div><span>正式规则</span><b>500 USDT · 10x · 不续资</b></div></div></section>
  </AdvisoryShell>;
}
