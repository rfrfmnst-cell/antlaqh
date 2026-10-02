import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createStore, mysqlPoolOptions, normalizeMysqlHost } from "../lib/store.js";

test("normalizes Hostinger loopback MySQL hosts to localhost", () => {
  assert.equal(normalizeMysqlHost("127.0.0.1"), "localhost");
  assert.equal(normalizeMysqlHost("::1"), "localhost");
  assert.equal(normalizeMysqlHost(" localhost "), "localhost");
  assert.equal(normalizeMysqlHost("mysql.internal.example"), "mysql.internal.example");
});


test("uses the local Unix socket for Hostinger localhost MySQL", () => {
  const options = mysqlPoolOptions({
    DB_HOST: "localhost",
    DB_USER: "u_test",
    DB_PASSWORD: "secret",
    DB_NAME: "db_test",
    DB_PORT: "3306",
    DB_SSL: "false",
  });
  assert.equal(options.socketPath, "/var/lib/mysql/mysql.sock");
  assert.equal("host" in options, false);
  assert.equal("port" in options, false);
});

test("keeps TCP settings for a remote MySQL host", () => {
  const options = mysqlPoolOptions({
    DB_HOST: "mysql.example.internal",
    DB_PORT: "3307",
    DB_USER: "u_test",
    DB_PASSWORD: "secret",
    DB_NAME: "db_test",
    DB_SSL: "false",
  });
  assert.equal(options.host, "mysql.example.internal");
  assert.equal(options.port, 3307);
  assert.equal("socketPath" in options, false);
});


test("falls back to SQLite when MySQL startup fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "antlaqh-db-fallback-"));
  const original = {
    DB_HOST: process.env.DB_HOST,
    DB_SOCKET_PATH: process.env.DB_SOCKET_PATH,
    DB_USER: process.env.DB_USER,
    DB_PASSWORD: process.env.DB_PASSWORD,
    DB_NAME: process.env.DB_NAME,
    DB_SSL: process.env.DB_SSL,
  };
  try {
    process.env.DB_HOST = "localhost";
    process.env.DB_SOCKET_PATH = "/definitely/missing/mysql.sock";
    process.env.DB_USER = "invalid";
    process.env.DB_PASSWORD = "invalid";
    process.env.DB_NAME = "invalid";
    process.env.DB_SSL = "false";

    const store = await createStore({
      driver: "mysql",
      dir,
      allowSqliteFallback: true,
    });
    assert.equal(store.mode, "sqlite-fallback");
    assert.ok(store.fallbackReason);
    await store.insert("health", { id: "ok", value: true });
    assert.deepEqual(await store.get("health", "ok"), { id: "ok", value: true });
    await store.close();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
