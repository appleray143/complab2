import { bodyJson, json, createSession } from "../../_lib.js";

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
    return json({ error: "Server setup incomplete. Add ADMIN_USERNAME, ADMIN_PASSWORD, and SESSION_SECRET secrets in Cloudflare Pages settings." }, 503);
  }
  let body;
  try { body = await bodyJson(request); } catch { return json({ error: "Invalid request" }, 400); }
  if (!constantTimeEqual(body.username, env.ADMIN_USERNAME) || !constantTimeEqual(body.password, env.ADMIN_PASSWORD)) {
    return json({ error: "Incorrect username or password" }, 401);
  }
  return json({ token: await createSession(env.ADMIN_USERNAME, env.SESSION_SECRET), expiresInSeconds: 28800 });
}
