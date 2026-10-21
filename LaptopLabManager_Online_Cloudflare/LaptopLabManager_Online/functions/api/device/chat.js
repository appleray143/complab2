import { bodyJson, json, requireDevice, safeText, nowIso, unauthorized } from "../../_lib.js";

export async function onRequestPost(context) {
  const device = await requireDevice(context.request, context.env);
  if (!device) return unauthorized();
  let body;
  try { body = await bodyJson(context.request); } catch { return json({ error: "Invalid JSON" }, 400); }
  const message = safeText(body.message, 300);
  if (!message) return json({ error: "Message is empty or too long." }, 400);
  await context.env.DB.prepare("INSERT INTO chat_messages (id, device_id, sender, message, created_at) VALUES (?, ?, 'client', ?, ?)")
    .bind(crypto.randomUUID(), device.id, message, nowIso()).run();
  return json({ ok: true });
}
