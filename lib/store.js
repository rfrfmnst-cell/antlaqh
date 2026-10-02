import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

export function normalizeMysqlHost(value) {
  const host = String(value || "").trim();
  return host === "127.0.0.1" || host === "::1" ? "localhost" : host;
}

export function mysqlPoolOptions(env = process.env) {
  const host = normalizeMysqlHost(env.DB_HOST);
  return {
    ...(host === "localhost"
      ? { socketPath: env.DB_SOCKET_PATH || "/var/lib/mysql/mysql.sock" }
      : { host, port: Number(env.DB_PORT || 3306) }),
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    connectionLimit: 8,
    charset: "utf8mb4",
    ...(env.DB_SSL === "true"
      ? { ssl: { rejectUnauthorized: true } }
      : {}),
  };
}

export async function createStore(config) {
  if (!["sqlite", "mysql"].includes(config.driver))
    throw new Error("DB_DRIVER must be sqlite or mysql.");

  let pool, sqlite;
  let mode = config.driver;
  let fallbackReason = null;

  const openSqlite = () => {
    mkdirSync(config.dir, { recursive: true });
    sqlite = new DatabaseSync(resolve(config.dir, "antlaqh.sqlite"));
    sqlite.exec(
      'PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, owner TEXT NOT NULL DEFAULT "", data TEXT NOT NULL, PRIMARY KEY(kind,id)); CREATE INDEX IF NOT EXISTS owner_idx ON records(kind,owner)',
    );
  };

  if (config.driver === "mysql") {
    const mysql = await import("mysql2/promise");
    try {
      pool = mysql.createPool(mysqlPoolOptions());
      await pool.execute(`CREATE TABLE IF NOT EXISTS records (
        kind VARCHAR(32) NOT NULL, id VARCHAR(80) NOT NULL, owner VARCHAR(80) NOT NULL DEFAULT '',
        data LONGTEXT NOT NULL, PRIMARY KEY(kind,id), INDEX owner_idx(kind,owner)
      ) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`);
    } catch (error) {
      if (pool) {
        try { await pool.end(); } catch {}
        pool = undefined;
      }
      if (!config.allowSqliteFallback) throw error;
      fallbackReason = String(error?.code || error?.message || "mysql_startup_failure").slice(0, 120);
      console.error(`MySQL unavailable; starting with SQLite fallback (${fallbackReason}).`);
      openSqlite();
      mode = "sqlite-fallback";
    }
  } else {
    openSqlite();
    mode = "sqlite";
  }

  async function query(sql, params = [], conn = pool) {
    if (pool) {
      const [rows] = await conn.execute(sql, params);
      return rows;
    }
    const stmt = sqlite.prepare(sql);
    return /^\s*SELECT/i.test(sql) ? stmt.all(...params) : stmt.run(...params);
  }
  const get = async (kind, id) => {
    const rows = await query("SELECT data FROM records WHERE kind=? AND id=?", [
      kind,
      id,
    ]);
    return rows[0] ? JSON.parse(rows[0].data) : null;
  };
  const list = async (kind, owner) =>
    (
      await query(
        `SELECT data FROM records WHERE kind=?${owner === undefined ? "" : " AND owner=?"}`,
        [kind, ...(owner === undefined ? [] : [owner])],
      )
    ).map((r) => JSON.parse(r.data));
  const insert = async (kind, item, owner = "") => {
    await query("INSERT INTO records(kind,id,owner,data) VALUES(?,?,?,?)", [
      kind,
      item.id,
      owner,
      JSON.stringify(item),
    ]);
    return item;
  };
  const insertSql = "INSERT INTO records(kind,id,owner,data) VALUES(?,?,?,?)";
  const recordParams = ({ kind, item, owner = "" }) => [kind, item.id, owner, JSON.stringify(item)];
  async function insertMany(records) {
    if (!pool) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const stmt = sqlite.prepare(insertSql);
        for (const record of records) stmt.run(...recordParams(record));
        sqlite.exec("COMMIT");
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    } else {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        for (const record of records) await query(insertSql, recordParams(record), conn);
        await conn.commit();
      } catch (error) {
        await conn.rollback();
        throw error;
      } finally { conn.release(); }
    }
    return records.map(({ item }) => item);
  }
  async function updateMany(updates, inserts = []) {
    if (!pool) {
      // All related changes commit together, including account identifiers.
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const values = [];
        for (const { kind, id, fn } of updates) {
          const row = sqlite.prepare("SELECT data FROM records WHERE kind=? AND id=?").get(kind, id);
          if (!row) throw Object.assign(new Error("السجل غير موجود"), { status: 404 });
          const item = JSON.parse(row.data);
          const value = fn(item) || item;
          sqlite.prepare("UPDATE records SET data=? WHERE kind=? AND id=?")
            .run(JSON.stringify(value), kind, id);
          values.push(value);
        }
        for (const record of inserts)
          sqlite.prepare(insertSql).run(...recordParams(record));
        sqlite.exec("COMMIT");
        return values;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    }
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const values = [];
      for (const { kind, id, fn } of updates) {
        const rows = await query("SELECT data FROM records WHERE kind=? AND id=? FOR UPDATE", [kind, id], conn);
        if (!rows[0]) throw Object.assign(new Error("السجل غير موجود"), { status: 404 });
        const item = JSON.parse(rows[0].data);
        const value = fn(item) || item;
        await query("UPDATE records SET data=? WHERE kind=? AND id=?", [JSON.stringify(value), kind, id], conn);
        values.push(value);
      }
      for (const record of inserts)
        await query(insertSql, recordParams(record), conn);
      await conn.commit();
      return values;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }
  async function update(kind, id, fn, inserts = []) {
    return (await updateMany([{ kind, id, fn }], inserts))[0];
  }
  const remove = async (kind, id) =>
    query("DELETE FROM records WHERE kind=? AND id=?", [kind, id]);
  return {
    get,
    list,
    insert,
    insertMany,
    update,
    updateMany,
    remove,
    mode,
    fallbackReason,
    close: async () => (pool ? pool.end() : sqlite.close()),
  };
}
