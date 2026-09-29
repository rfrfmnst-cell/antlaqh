import { test } from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

test(
  "LiteSpeed-style require starts the ESM application through server.cjs",
  { timeout: 20000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "antlaqh-launcher-"));
    let worker;
    try {
      worker = new Worker(
        `
      const { parentPort, workerData } = require("node:worker_threads");
      require(workerData.entry).then(({ server }) => {
        const ready = () => parentPort.postMessage(server.address().port);
        if (server.listening) ready();
        else server.once("listening", ready);
      });
    `,
        {
          eval: true,
          workerData: { entry: resolve(import.meta.dirname, "../server.cjs") },
          // Isolate this startup from all developer and production credentials.
          env: {
            NODE_ENV: "test",
            PORT: "0",
            APP_URL: "http://localhost",
            DB_DRIVER: "sqlite",
            DATA_DIR: dir,
          },
        },
      );
      const port = await new Promise((done, fail) => {
        const timer = setTimeout(
          () => fail(new Error("Launcher startup timed out")),
          10000,
        );
        worker.once("message", (value) => {
          clearTimeout(timer);
          done(value);
        });
        worker.once("error", (error) => {
          clearTimeout(timer);
          fail(error);
        });
        worker.once("exit", (code) => {
          clearTimeout(timer);
          fail(new Error(`Launcher exited early (${code})`));
        });
      });
      assert.ok(port > 0);
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        status: "ok",
        version: "5.0.0",
      });
    } finally {
      if (worker) await worker.terminate();
      assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
      await rm(dir, { recursive: true, force: true });
    }
  },
);
