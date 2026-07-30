import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY;

if (!url || !anonKey) {
  throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required");
}

const botEmail = process.env.SUPABASE_BOT_EMAIL;
const botPassword = process.env.SUPABASE_BOT_PASSWORD;

if (!botEmail || !botPassword) {
  throw new Error("SUPABASE_BOT_EMAIL and SUPABASE_BOT_PASSWORD are required");
}

const botEmailStr = botEmail as string;
const botPasswordStr = botPassword as string;


class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

export const db = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: new MemoryStorage(),
  },
});

export async function ensureAuth() {
  const { data: { session } } = await db.auth.getSession();
  if (session) return session;

  const { data, error } = await db.auth.signInWithPassword({
    email: botEmailStr,
    password: botPasswordStr,
  });

  if (error) throw new Error(`bot sign-in failed: ${error.message}`);
  if (!data.session) throw new Error("bot sign-in returned no session");
  return data.session;
}

export async function logEvent(
  level: "debug" | "info" | "warn" | "error" | "heartbeat",
  message: string,
  payload?: unknown,
) {
  try {
    await ensureAuth();
    const { error } = await db.from("bot_events").insert({ level, message, payload: payload ?? null });
    if (error) console.error("[log] failed:", error.message);
    if (level !== "heartbeat") console.log(`[${level}] ${message}`);
  } catch (err) {
    console.error("[log] auth failed:", err);
  }
}
