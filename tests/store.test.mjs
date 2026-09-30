import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createStore } from "../lib/store.js";

test("related records and account updates roll back together on conflicts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "antlaqh-store-"));
  const db = await createStore({ driver: "sqlite", dir });
  try {
    await db.insert("loginPhone", { id: "phone", userId: "existing" }, "existing");
    await assert.rejects(db.insertMany([
      { kind: "user", item: { id: "new", name: "New" }, owner: "new" },
      { kind: "loginPhone", item: { id: "phone", userId: "new" }, owner: "new" },
    ]));
    assert.equal(await db.get("user", "new"), null);
    assert.equal((await db.get("loginPhone", "phone")).userId, "existing");
    await db.insert("user", { id: "existing", name: "Original" }, "existing");
    await assert.rejects(db.update("user", "existing", (u) => { u.name = "Changed"; return u; }, [
      { kind: "loginPhone", item: { id: "phone", userId: "existing" }, owner: "existing" },
    ]));
    assert.equal((await db.get("user", "existing")).name, "Original");
    await db.update("user", "existing", (u) => { u.loginPhone = "other"; return u; }, [
      { kind: "loginPhone", item: { id: "other", userId: "existing" }, owner: "existing" },
    ]);
    assert.equal((await db.get("user", "existing")).loginPhone, "other");
    assert.equal((await db.get("loginPhone", "other")).userId, "existing");
  } finally {
    await db.close();
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
    await rm(dir, { recursive: true, force: true });
  }
});

test("an unknown database driver fails instead of silently storing in SQLite", async () => {
  await assert.rejects(createStore({ driver: "mysl" }), /DB_DRIVER/);
});
