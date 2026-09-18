function toPct(completed: number, total: number): number | null {
  if (!Number.isFinite(completed) || !Number.isFinite(total) || total <= 0 || completed < 0 || completed > total) return null;
  return Math.round((completed / total) * 100);
}

export function parseProgressPct(text: string): number | null {
  const ratio = text.match(/(\d+)\s*\/\s*(\d+)\s*(tests?|steps?)/i)
    ?? text.match(/(?:completed|complete|done|已完成)\s*(?:tests?|steps?|测试|步骤)?\s*[:：]?\s*(\d+)\s*\/\s*(\d+)/i);
  if (ratio) {
    const completed = Number(ratio[1]);
    const total = Number(ratio[2]);
    return toPct(completed, total);
  }

  const coverage = text.match(/(?:coverage|覆盖率)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%/i);
  if (coverage) {
    const value = Number(coverage[1]);
    return Number.isFinite(value) && value >= 0 && value <= 100 ? Math.round(value) : null;
  }

  return null;
}
