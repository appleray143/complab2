import { json, requireDevice, unauthorized } from "../../_lib.js";

export async function onRequestPost(context) {
  const device = await requireDevice(context.request, context.env);
  if (!device) return unauthorized();
  const { DB } = context.env;
  const latest = await DB.prepare("SELECT allowance_minutes, blocked FROM devices WHERE id = ?").bind(device.id).first();
  const result = await DB.prepare(
    "SELECT id, message, created_at FROM chat_messages WHERE device_id = ? AND sender = 'admin' AND delivered_at IS NULL ORDER BY created_at ASC LIMIT 20"
  ).bind(device.id).all();
  const messages = result.results || [];
  return json({ state: { allowance_minutes: latest.allowance_minutes, blocked: !!latest.blocked }, messages });
}
