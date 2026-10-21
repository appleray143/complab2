import { json, readAdminDevice } from "../../../../_lib.js";

export async function onRequestGet(context) {
  const checked = await readAdminDevice(context);
  if (checked.error) return checked.error;
  const rows = await context.env.DB.prepare(
    "SELECT id, sender, message, created_at, delivered_at FROM chat_messages WHERE device_id = ? ORDER BY created_at DESC LIMIT 100"
  ).bind(checked.device.id).all();
  return json({ messages: (rows.results || []).reverse() });
}
