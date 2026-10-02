import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMysqlHost } from "../lib/store.js";

test("normalizes Hostinger loopback MySQL hosts to localhost", () => {
  assert.equal(normalizeMysqlHost("127.0.0.1"), "localhost");
  assert.equal(normalizeMysqlHost("::1"), "localhost");
  assert.equal(normalizeMysqlHost(" localhost "), "localhost");
  assert.equal(normalizeMysqlHost("mysql.internal.example"), "mysql.internal.example");
});
