import { bodyJson, json, readAdminDevice, safeText, clampInt, nowIso, sha256 } from "../../../../_lib.js";

function randomToken(bytes = 32) {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const b of raw) binary += String.fromCharCode(b);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export async function onRequestPost(context) {
  const checked = await readAdminDevice(context);
  if (checked.error) return checked.error;
  let body;
  try { body = await bodyJson(context.request); } catch { return json({ error: "Invalid JSON" }, 400); }
  const { DB } = context.env;
  const id = checked.device.id;
  const action = safeText(body.action, 30);

  if (action === "set_allowance") {
    const minutes = Number(body.minutes);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) return json({ error: "Allowance must be between 0 and 1440 minutes." }, 400);
    await DB.prepare("UPDATE devices SET allowance_minutes = ? WHERE id = ?").bind(minutes, id).run();
    return json({ ok: true, allowance_minutes: minutes });
  }
  if (action === "adjust_time") {
    const delta = Number(body.delta);
    if (!Number.isInteger(delta) || ![-60, -30, -10, 10, 30, 60].includes(delta)) return json({ error: "Adjustment must be -60, -30, -10, 10, 30, or 60 minutes." }, 400);
    const next = clampInt(Number(checked.device.allowance_minutes) + delta, 0, 1440, 60);
    await DB.prepare("UPDATE devices SET allowance_minutes = ? WHERE id = ?").bind(next, id).run();
    return json({ ok: true, allowance_minutes: next });
  }
  if (action === "block" || action === "unblock") {
    const blocked = action === "block" ? 1 : 0;
    await DB.prepare("UPDATE devices SET blocked = ? WHERE id = ?").bind(blocked, id).run();
    return json({ ok: true, blocked: !!blocked });
  }
  if (action === "rotate_token") {
    const token = randomToken();
    await DB.prepare("UPDATE devices SET token_hash = ? WHERE id = ?").bind(await sha256(token), id).run();
    return json({ ok: true, device_token: token });
  }
  if (action === "message") {
    const message = safeText(body.message, 300);
    if (!message) return json({ error: "Enter a message up to 300 characters." }, 400);
    await DB.prepare("INSERT INTO chat_messages (id, device_id, sender, message, created_at) VALUES (?, ?, 'admin', ?, ?) ")
      .bind(crypto.randomUUID(), id, message, nowIso()).run();
    return json({ ok: true });
  }
  return json({ error: "Unknown action" }, 400);
}
