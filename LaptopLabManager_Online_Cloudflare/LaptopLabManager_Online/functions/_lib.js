const encoder = new TextEncoder();

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

export async function bodyJson(request) {
  const text = await request.text();
  if (text.length > 20_000) throw new Error("Request body too large");
  return text ? JSON.parse(text) : {};
}

export function safeText(value, max = 250) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function toBase64Url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function fromBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(data)));
}

export async function createSession(username, secret) {
  const payload = toBase64Url(encoder.encode(JSON.stringify({ sub: username, exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60 })));
  const signature = toBase64Url(await hmac(secret, payload));
  return `${payload}.${signature}`;
}

export async function verifySession(token, secret) {
  try {
    if (!token || !secret || !token.includes(".")) return null;
    const [payload, signature] = token.split(".");
    const expected = toBase64Url(await hmac(secret, payload));
    if (!constantTimeEqual(signature, expected)) return null;
    const data = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
    if (!data.sub || !Number.isFinite(data.exp) || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch { return null; }
}

export async function requireAdmin(context) {
  const authorization = context.request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return verifySession(token, context.env.SESSION_SECRET);
}

export async function requireDevice(request, env) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return null;
  const tokenHash = await sha256(token);
  return env.DB.prepare("SELECT * FROM devices WHERE token_hash = ?").bind(tokenHash).first();
}

export function unauthorized() { return json({ error: "Authentication required" }, 401); }
export function nowIso() { return new Date().toISOString(); }

export async function readAdminDevice(context) {
  const auth = await requireAdmin(context);
  if (!auth) return { error: unauthorized() };
  const id = context.params.id;
  const device = await context.env.DB.prepare("SELECT * FROM devices WHERE id = ?").bind(id).first();
  if (!device) return { error: json({ error: "PC not found" }, 404) };
  return { auth, device };
}

export function clampInt(value, min, max, fallback = min) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
