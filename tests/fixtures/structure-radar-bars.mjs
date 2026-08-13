export function makeClosedBars(count = 24, startTime = 1_700_000_000) {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * 0.2;
    return {
      time: startTime + index * 3_600,
      open: close - 0.1,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1_000 + index * 10,
      closed: true,
    };
  });
}

