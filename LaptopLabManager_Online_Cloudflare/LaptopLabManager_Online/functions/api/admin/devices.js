import { bodyJson, json, requireAdmin, safeText, sha256, clampInt, nowIso, unauthorized } from "../../_lib.js";

function randomToken(bytes = 32) {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const b of raw) binary += String.fromCharCode(b);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export async function onRequestGet(context) {
  if (!await requireAdmin(context)) return unauthorized();
  const result = await context.env.DB.prepare(
    "SELECT id, pc_number, computer_name, username, last_seen, usage_minutes_today, allowance_minutes, blocked, recent_url, created_at FROM devices ORDER BY pc_number COLLATE NOCASE"
  ).all();
  const now = Date.now();
  const devices = (result.results || []).map((d) => ({
    ...d,
    online: !!d.last_seen && now - Date.parse(d.last_seen) <= 45_000,
    blocked: !!d.blocked,
  }));
  return json({ devices });
}

export async function onRequestPost(context) {
  if (!await requireAdmin(context)) return unauthorized();
  let body;
  try { body = await bodyJson(context.request); } catch { return json({ error: "Invalid JSON" }, 400); }
  const pcNumber = safeText(body.pc_number, 24);
  const computerName = safeText(body.computer_name, 80) || pcNumber;
  if (!/^[A-Za-z0-9_-]{1,24}$/.test(pcNumber)) return json({ error: "PC number must use 1–24 letters, numbers, dashes, or underscores." }, 400);
  const token = randomToken();
  const tokenHash = await sha256(token);
  const id = crypto.randomUUID();
  const created = nowIso();
  const allowance = clampInt(body.allowance_minutes, 0, 1440, 60);
  try {
    await context.env.DB.prepare(
      "INSERT INTO devices (id, pc_number, computer_name, token_hash, allowance_minutes, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(id, pcNumber, computerName, tokenHash, allowance, created).run();
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) return json({ error: "That PC number is already registered." }, 409);
    return json({ error: "Could not register PC." }, 500);
  }
  return json({ device: { id, pc_number: pcNumber, computer_name: computerName, allowance_minutes: allowance }, device_token: token }, 201);
}
