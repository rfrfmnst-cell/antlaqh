import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";

// Files belong to the existing Antlaqh order/permission model. Storage credentials
// must never be exposed to the browser or used to make this bucket public.
const unavailable = () => Object.assign(
  new Error("تعذر الوصول إلى مخزن الملفات. حاول مجددًا لاحقًا."), { status: 503 },
);
const notFound = () => Object.assign(new Error("الملف غير موجود."), { status: 404 });

export function createFileStorage({
  directory,
  env = process.env,
  request = globalThis.fetch,
} = {}) {
  if (!directory) throw new Error("File storage directory is required.");
  const driver = env.FILE_STORAGE_DRIVER || "local";
  if (!["local", "supabase"].includes(driver))
    throw new Error("FILE_STORAGE_DRIVER must be local or supabase.");

  let base, key, bucket;
  if (driver === "supabase") {
    const rawUrl = env.SUPABASE_URL || "";
    key = env.SUPABASE_SERVICE_ROLE_KEY || "";
    bucket = env.SUPABASE_STORAGE_BUCKET || "antlaqh-private";
    let parsed;
    try { parsed = new URL(rawUrl); } catch {}
    if (!parsed || parsed.protocol !== "https:" || !parsed.hostname ||
        parsed.username || parsed.password || parsed.search || parsed.hash ||
        parsed.pathname !== "/" || !key ||
        !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) {
      throw new Error("Supabase file storage requires a valid HTTPS URL, private service role key, and bucket.");
    }
    base = parsed.origin + "/storage/v1/object/";
  }

  const ensureId = (file) => {
    if (!file || !/^[a-f0-9]{36}$/.test(file.id)) throw notFound();
    return file.id;
  };
  const headers = () => ({
    apikey: key,
    Authorization: "Bearer " + key,
  });
  const perform = async (url, options) => {
    try {
      return await request(url, { ...options, signal: AbortSignal.timeout(15000) });
    } catch {
      throw unavailable();
    }
  };

  async function save(file, bytes) {
    const id = ensureId(file);
    if (driver === "local") {
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, id), bytes, { flag: "wx" });
      return file;
    }
    const response = await perform(base + encodeURIComponent(bucket) + "/" + id, {
      method: "POST",
      headers: {
        ...headers(),
        "Content-Type": file.mime,
        "x-upsert": "false",
      },
      body: bytes,
    });
    if (!response.ok) throw unavailable();
    return { ...file, storage: "supabase" };
  }

  async function read(file) {
    const id = ensureId(file);
    // Pre-migration records do not have a storage marker. They always remain
    // readable from the original Hostinger volume, even after switching writes.
    if (file.storage !== "supabase") return readFile(join(directory, id));
    if (driver !== "supabase") throw unavailable();
    const response = await perform(
      base + "authenticated/" + encodeURIComponent(bucket) + "/" + id,
      { method: "GET", headers: headers() },
    );
    if (response.status === 404) throw notFound();
    if (!response.ok) throw unavailable();
    try {
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 10 * 1024 * 1024) throw unavailable();
      return Buffer.from(bytes);
    } catch (error) {
      if (error.status) throw error;
      throw unavailable();
    }
  }

  async function remove(file) {
    const id = ensureId(file);
    if (file.storage !== "supabase") return unlink(join(directory, id));
    if (driver !== "supabase") throw unavailable();
    const response = await perform(base + encodeURIComponent(bucket), {
      method: "DELETE",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: [id] }),
    });
    if (!response.ok) throw unavailable();
  }

  return { driver, save, read, remove };
}
