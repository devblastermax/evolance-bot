import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
}

export const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export async function logEvent(
  level: "debug" | "info" | "warn" | "error" | "heartbeat",
  message: string,
  payload?: unknown,
) {
  const { error } = await db.from("bot_events").insert({ level, message, payload: payload ?? null });
  if (error) console.error("[log] failed:", error.message);
  if (level !== "heartbeat") console.log(`[${level}] ${message}`);
}
