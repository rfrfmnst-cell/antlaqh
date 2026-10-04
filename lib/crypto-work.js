// Bound memory-intensive password work; never let an unbounded request queue grow.
export function createCryptoWork({ parallel = 2, queued = 8 } = {}) {
  let active = 0;
  const waiting = [];
  return function run(fn) {
    return new Promise((resolve, reject) => {
      const start = () => {
        active++;
        Promise.resolve().then(fn).then(resolve, reject).finally(() => {
          active--;
          waiting.shift()?.();
        });
      };
      if (active < parallel) start();
      else if (waiting.length < queued) waiting.push(start);
      else reject(Object.assign(new Error("الخدمة مشغولة مؤقتًا. أعد المحاولة بعد قليل."), { status: 503 }));
    });
  };
}
