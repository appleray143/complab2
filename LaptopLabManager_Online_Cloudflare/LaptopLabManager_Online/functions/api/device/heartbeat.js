import { bodyJson, json, requireDevice, safeText, clampInt, nowIso, unauthorized } from "../../_lib.js";

export async function onRequestPost(context) {
  const device = await requireDevice(context.request, context.env);
  if (!device) return unauthorized();
  let body;
  try { body = await bodyJson(context.request); } catch { return json({ error: "Invalid JSON" }, 400); }
  const username = safeText(body.username, 80);
  const usage = clampInt(body.usage_minutes_today, 0, 1440, 0);
  const recentUrl = safeText(body.recent_url, 500);
  const usageDay = safeText(body.usage_day, 10);
  await context.env.DB.prepare(
    "UPDATE devices SET username = ?, usage_minutes_today = ?, recent_url = ?, last_seen = ?, usage_day = ? WHERE id = ?"
  ).bind(username, usage, recentUrl, nowIso(), usageDay, device.id).run();
  const fresh = await context.env.DB.prepare("SELECT allowance_minutes, blocked FROM devices WHERE id = ?").bind(device.id).first();
  return json({ ok: true, state: { allowance_minutes: fresh.allowance_minutes, blocked: !!fresh.blocked } });
}
