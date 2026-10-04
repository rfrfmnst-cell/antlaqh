import { test } from "node:test";
import assert from "node:assert/strict";
import { createCryptoWork } from "../lib/crypto-work.js";

test("password work bounds concurrent memory and rejects queue overflow", async () => {
  const run = createCryptoWork({ parallel: 2, queued: 1 });
  let active = 0, peak = 0;
  const release = [];
  const job = () => new Promise(resolve => {
    peak = Math.max(peak, ++active);
    release.push(() => { active--; resolve("ok"); });
  });
  const a = run(job), b = run(job), c = run(job);
  await assert.rejects(run(job), { status: 503 });
  assert.equal(peak, 2);
  release.shift()();
  await a;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(peak, 2);
  assert.equal(release.length, 2);
  release.splice(0).forEach(fn => fn());
  assert.deepEqual(await Promise.all([b, c]), ["ok", "ok"]);
});

test("failed password work releases its slot and queued requests continue", async () => {
  const run = createCryptoWork({ parallel: 1, queued: 1 });
  const failed = run(() => { throw new Error("crypto failed"); });
  const next = run(() => "next");
  await assert.rejects(failed, /crypto failed/);
  assert.equal(await next, "next");
  assert.equal(await run(() => "again"), "again");
});
