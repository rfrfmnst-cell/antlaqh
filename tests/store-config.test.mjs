import test from "node:test";
import assert from "node:assert/strict";
import { mysqlPoolOptions, normalizeMysqlHost } from "../lib/store.js";

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
