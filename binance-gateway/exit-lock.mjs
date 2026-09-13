const tails = new Map();

export async function withExitOnlyLock(key, work) {
  const previous = tails.get(key) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  tails.set(key, tail);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (tails.get(key) === tail) tails.delete(key);
  }
}
