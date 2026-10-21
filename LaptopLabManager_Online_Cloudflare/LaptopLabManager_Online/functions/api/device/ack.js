import { bodyJson, json, requireDevice, nowIso, unauthorized } from "../../_lib.js";

export async function onRequestPost(context) {
  const device = await requireDevice(context.request, context.env);
  if (!device) return unauthorized();
  let body;
  try { body = await bodyJson(context.request); } catch { return json({ error: "Invalid JSON" }, 400); }
  const ids = Array.isArray(body.message_ids) ? body.message_ids.filter((id) => typeof id === "string" && id.length <= 64).slice(0, 20) : [];
  const deliveredAt = nowIso();
  for (const id of ids) {
    await context.env.DB.prepare("UPDATE chat_messages SET delivered_at = ? WHERE id = ? AND device_id = ? AND sender = 'admin' AND delivered_at IS NULL")
      .bind(deliveredAt, id, device.id).run();
  }
  return json({ ok: true });
}
