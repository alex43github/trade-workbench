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

export function makePlatformReclaimBars({ reclaimDelay = 1, reclaim = true } = {}) {
  const startTime = 1_710_000_000;
  const platform = Array.from({ length: 52 }, (_, index) => {
    const close = 100 + ((index % 5) - 2) * 0.08;
    const lowerTouch = [6, 21, 36, 47].includes(index);
    const upperTouch = [10, 25, 40, 49].includes(index);
    return {
      time: startTime + index * 3_600,
      open: close - 0.05,
      high: upperTouch ? 102 : 101.25,
      low: lowerTouch ? 98 : 98.75,
      close,
      volume: 1_000 + (index % 7) * 20,
      closed: true,
    };
  });
  const sweepIndex = platform.length;
  const sweep = {
    time: startTime + sweepIndex * 3_600,
    open: 99.2,
    high: 99.5,
    low: 96.8,
    close: 97.6,
    volume: 1_600,
    closed: true,
  };
  const waiting = Array.from({ length: reclaimDelay }, (_, offset) => ({
    time: startTime + (sweepIndex + offset + 1) * 3_600,
    open: 97.7,
    high: 98.1,
    low: 97.2,
    close: 97.8,
    volume: 1_300,
    closed: true,
  }));
  const reclaimBar = {
    time: startTime + (sweepIndex + reclaimDelay + 1) * 3_600,
    open: 97.8,
    high: reclaim ? 99.4 : 98.0,
    low: 97.5,
    close: reclaim ? 99.15 : 97.7,
    volume: 1_850,
    closed: true,
  };
  return [...platform, sweep, ...waiting, reclaimBar];
}
