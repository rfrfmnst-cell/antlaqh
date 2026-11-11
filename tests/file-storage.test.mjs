import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileStorage } from "../lib/file-storage.js";

const file = { id: "a".repeat(36), mime: "application/pdf", name: "receipt.pdf" };
const payload = Buffer.from("%PDF-test");
const env = {
  FILE_STORAGE_DRIVER: "supabase",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-only-private-key",
  SUPABASE_STORAGE_BUCKET: "antlaqh-private",
};

test("local file storage keeps old behavior with no Supabase credentials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "antlaqh-files-"));
  try {
    const store = createFileStorage({ directory: dir, env: {} });
    assert.equal(store.driver, "local");
    const saved = await store.save(file, payload);
    assert.equal(saved.storage, undefined);
    assert.deepEqual(await store.read(saved), payload);
    assert.deepEqual(await readFile(join(dir, file.id)), payload);
    await store.remove(saved);
    await assert.rejects(store.read(saved), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Supabase private storage uploads, reads and removes files server-side", async () => {
  const calls = [];
  const mockRequest = async (url, options) => {
    calls.push({ url, options });
    if (options.method === "GET")
      return { ok: true, arrayBuffer: async () => payload };
    return { ok: true };
  };
  const store = createFileStorage({ directory: "/unused-for-remote", env, request: mockRequest });
  const saved = await store.save(file, payload);
  assert.equal(saved.storage, "supabase");
  assert.equal(calls[0].url, "https://example.supabase.co/storage/v1/object/antlaqh-private/" + file.id);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.apikey, env.SUPABASE_SERVICE_ROLE_KEY);
  assert.equal(calls[0].options.headers["x-upsert"], "false");
  assert.deepEqual(await store.read(saved), payload);
  assert.equal(calls[1].url, "https://example.supabase.co/storage/v1/object/authenticated/antlaqh-private/" + file.id);
  assert.equal(calls[1].options.method, "GET");
  await store.remove(saved);
  assert.equal(calls[2].options.method, "DELETE");
  assert.deepEqual(JSON.parse(calls[2].options.body), { prefixes: [file.id] });
});

test("old unmarked files remain on local disk after Supabase is selected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "antlaqh-legacy-"));
  try {
    await writeFile(join(dir, file.id), payload);
    const store = createFileStorage({
      directory: dir, env,
      request: async () => { throw new Error("Should not request Supabase for legacy files"); },
    });
    assert.deepEqual(await store.read(file), payload);
    await store.remove(file);
    await assert.rejects(store.read(file), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("remote errors never silently fall back to a different local file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "antlaqh-errors-"));
  try {
    await writeFile(join(dir, file.id), payload);
    const store = createFileStorage({
      directory: dir, env,
      request: async () => ({ ok: false, status: 503 }),
    });
    await assert.rejects(store.read({ ...file, storage: "supabase" }), (e) => e.status === 503);
    await assert.rejects(store.save(file, payload), (e) => e.status === 503);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("invalid configuration and file identifiers are rejected", async () => {
  assert.throws(() => createFileStorage({
    directory: "/tmp", env: { FILE_STORAGE_DRIVER: "supabase", SUPABASE_URL: "http://localhost" },
  }), /requires a valid HTTPS URL/);
  const store = createFileStorage({ directory: "/tmp", env: {} });
  await assert.rejects(store.read({ ...file, id: "../private" }), (e) => e.status === 404);
});
