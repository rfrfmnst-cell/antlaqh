import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { jsonBody, checkPassword } from "../lib/security.js";

function jsonRequest(value, contentType = "application/json") {
  const req = Readable.from([Buffer.from(JSON.stringify(value))]);
  req.headers = { "content-type": contentType };
  return req;
}

test("JSON APIs require an object and an exact JSON media type", async () => {
  for (const value of [null, [], "text", 1, true])
    await assert.rejects(jsonBody(jsonRequest(value)), { status: 400 });
  await assert.rejects(jsonBody(jsonRequest({}, "application/jsonp")), { status: 415 });
  assert.deepEqual(await jsonBody(jsonRequest({ ok: true }, "Application/JSON; charset=utf-8")), { ok: true });
});

test("malformed stored password hashes fail authentication without throwing", async () => {
  for (const stored of ["", "bad:00", "bad:zz", null, {}, "bad:" + "aa".repeat(65)])
    assert.equal(await checkPassword("test-password", stored), false);
});
