import { supabase } from "./supabase.js";

export async function getUser(req) {
  const token = (req.headers["authorization"] || "").replace("Bearer ", "").trim();
  if (!token) return { user: null, error: "Missing token" };
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return { user: null, error: "Invalid token" };
  return { user: data.user, error: null };
}
