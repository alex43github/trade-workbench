export type Holder = { address: string; balance: number; label?: string | null; category?: string | null };
export type Top10Concentration = {
  top10Pct: number | null; eligibleTotal: number; excludedCount: number; excludedCategories: string[]; status: "live" | "pending";
};

const excluded = /exchange|cex|binance|okx|bybit|coinbase|kraken|gate|mexc|kucoin|liquidity|lp\b|pool|bridge|burn|dead|treasury|team|vesting|contract/i;

function category(holder: Holder) {
  const value = `${holder.label ?? ""} ${holder.category ?? ""}`;
  if (/exchange|cex|binance|okx|bybit|coinbase|kraken|gate|mexc|kucoin/i.test(value)) return "exchange";
  if (/liquidity|lp\b|pool/i.test(value)) return "liquidity";
  if (/bridge/i.test(value)) return "bridge";
  if (/burn|dead/i.test(value)) return "burn";
  if (/treasury|team|vesting|contract/i.test(value)) return "treasury_or_contract";
  return "other";
}

export function calculateTop10Concentration(holders: Holder[]): Top10Concentration {
  const valid = holders.filter((holder) => Number.isFinite(holder.balance) && holder.balance > 0 && holder.address);
  const kept = valid.filter((holder) => !excluded.test(`${holder.label ?? ""} ${holder.category ?? ""}`));
  const removed = valid.filter((holder) => excluded.test(`${holder.label ?? ""} ${holder.category ?? ""}`));
  const eligibleTotal = kept.reduce((sum, holder) => sum + holder.balance, 0);
  const top10 = [...kept].sort((a, b) => b.balance - a.balance).slice(0, 10).reduce((sum, holder) => sum + holder.balance, 0);
  return {
    top10Pct: eligibleTotal > 0 ? Number(((top10 / eligibleTotal) * 100).toFixed(2)) : null,
    eligibleTotal, excludedCount: removed.length,
    excludedCategories: [...new Set(removed.map(category).filter((item) => item !== "other"))],
    status: eligibleTotal > 0 ? "live" : "pending",
  };
}
