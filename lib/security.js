import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { createCryptoWork } from "./crypto-work.js";
const scrypt = promisify(scryptCb);
const cryptoWork = createCryptoWork();
// A valid-shaped dummy hash gives unknown accounts the same expensive verification path.
export const dummyPasswordHash = "00".repeat(16) + ":" + "00".repeat(64);
export const id = () => randomBytes(18).toString("hex");
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export const fail = (status, message) =>
  Object.assign(new Error(message), { status });
export function text(value, min = 0, max = 2000) {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.length > max
  )
    throw fail(400, "تحقق من الحقول المطلوبة وطول النص.");
  return value.trim();
}
export function email(value) {
  const result = text(value, 5, 180).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result))
    throw fail(400, "أدخل بريدًا إلكترونيًا صحيحًا.");
  return result;
}
export function password(value) {
  if (typeof value !== "string" || value.length < 12 || value.length > 128)
    throw fail(400, "استخدم كلمة مرور بين 12 و128 حرفًا.");
  return value;
}
export function phone(value) {
  let normalized = text(value, 9, 30)
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 1776))
    .replace(/[\s()-]/g, "");
  if (/^05\d{8}$/.test(normalized)) normalized = "+966" + normalized.slice(1);
  else if (/^9665\d{8}$/.test(normalized)) normalized = "+" + normalized;
  else if (normalized.startsWith("00")) normalized = "+" + normalized.slice(2);
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) throw fail(400, "أدخل رقم جوال صحيحًا، مثل 05XXXXXXXX أو +9665XXXXXXXX.");
  return normalized;
}
export async function hashPassword(value) {
  const salt = randomBytes(16).toString("hex");
  const hash = await cryptoWork(() => scrypt(value, salt, 64, {
    N: 131072,
    r: 8,
    p: 1,
    maxmem: 256 * 1024 * 1024,
  }));
  return `${salt}:${hash.toString("hex")}`;
}
export async function checkPassword(value, stored) {
  if (typeof value !== "string" || value.length > 128 || typeof stored !== "string") return false;
  const parts = stored.split(":");
  if (parts.length !== 2) return false;
  const [salt, expected] = parts;
  if (!/^[a-f0-9]{32}$/i.test(salt) || !/^[a-f0-9]{128}$/i.test(expected)) return false;
  const hash = await cryptoWork(() => scrypt(value, salt, 64, {
    N: 131072,
    r: 8,
    p: 1,
    maxmem: 256 * 1024 * 1024,
  }));
  return timingSafeEqual(hash, Buffer.from(expected, "hex"));
}
export function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone || "",
    loginPhone: u.loginPhone || "",
    phoneVerified: !!u.phoneVerified,
    role: u.role,
    ...(u.guest === true ? { guest: true } : {}),
    createdAt: u.createdAt,
  };
}
export async function body(req, max = 1024 * 1024) {
  if (Number(req.headers["content-length"]) > max) {
    req.resume();
    throw fail(413, "الملف أو الطلب أكبر من الحجم المسموح.");
  }
  const chunks = [];
  let size = 0,
    oversized = false;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) {
      oversized = true;
      chunks.length = 0;
    }
    if (!oversized) chunks.push(chunk);
  }
  if (oversized) throw fail(413, "الملف أو الطلب أكبر من الحجم المسموح.");
  return Buffer.concat(chunks);
}
export async function jsonBody(req, max = 200000) {
  const contentType = (req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json")
    throw fail(415, "صيغة الطلب غير مدعومة.");
  try {
    const parsed = JSON.parse((await body(req, max)).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw fail(400, "بيانات الطلب غير صحيحة.");
    return parsed;
  } catch (e) {
    if (e.status) throw e;
    throw fail(400, "بيانات الطلب غير صحيحة.");
  }
}
function xlsxArchive(buffer) {
  // Inspect the ZIP directory without extracting or executing uploaded content.
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) return false;
  let end = buffer.length - 22;
  for (; end >= Math.max(0, buffer.length - 65557); end--) {
    if (buffer.readUInt32LE(end) === 0x06054b50 && end + 22 + buffer.readUInt16LE(end + 20) === buffer.length) break;
  }
  if (end < Math.max(0, buffer.length - 65557)) return false;
  const count = buffer.readUInt16LE(end + 10), size = buffer.readUInt32LE(end + 12);
  let cursor = buffer.readUInt32LE(end + 16), total = 0;
  if (!count || count > 2000 || cursor + size !== end || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6)) return false;
  const names = new Set();
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== 0x02014b50 || buffer.readUInt16LE(cursor + 8) & 1) return false;
    const length = buffer.readUInt16LE(cursor + 28), extra = buffer.readUInt16LE(cursor + 30), comment = buffer.readUInt16LE(cursor + 32);
    if (cursor + 46 + length + extra + comment > end) return false;
    const name = buffer.subarray(cursor + 46, cursor + 46 + length).toString("utf8");
    if (name.startsWith("/") || name.includes("\\") || name.split("/").includes("..") || /vbaProject|activeX|embeddings/i.test(name)) return false;
    names.add(name); total += buffer.readUInt32LE(cursor + 24);
    if (total > 100 * 1024 * 1024) return false;
    cursor += 46 + length + extra + comment;
  }
  return cursor === end && names.has("[Content_Types].xml") && names.has("xl/workbook.xml");
}
export function validFile(buffer, kind, studyFile = false) {
  const ok =
    (kind === "application/pdf" &&
      buffer.subarray(0, 5).toString() === "%PDF-") ||
    (kind === "image/png" &&
      buffer
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (kind === "image/jpeg" &&
      buffer[0] === 255 &&
      buffer[1] === 216 &&
      buffer[2] === 255) ||
    (studyFile && kind === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" && xlsxArchive(buffer)) ||
    (studyFile && kind === "text/csv" && buffer.length > 0 && !buffer.includes(0) && (() => {
      try { new TextDecoder("utf-8", { fatal: true }).decode(buffer); return true; } catch { return false; }
    })());
  if (!ok) throw fail(400, studyFile ? "ارفع PDF أو PNG أو JPEG أو XLSX دون ماكرو أو CSV بترميز UTF-8 صالحًا." : "ارفع ملف PDF أو صورة PNG أو JPEG صحيحة.");
}
