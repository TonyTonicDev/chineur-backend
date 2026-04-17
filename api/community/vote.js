import { getUser } from "../../lib/auth.js";
import { supabase } from "../../lib/supabase.js";
import { cors } from "../../lib/cors.js";

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const { user, error: authError } = await getUser(req);
  if (authError || !user) return res.status(401).json({ error: "Unauthorized" });

  const { find_id, direction } = req.body || {};
  if (!find_id || !["up", "down"].includes(direction)) {
    return res.status(400).json({ error: "Missing find_id or invalid direction" });
  }

  // Check existing vote
  const { data: existing } = await supabase
    .from("votes")
    .select("id, direction")
    .eq("find_id", find_id)
    .eq("user_id", user.id)
    .single();

  if (existing) {
    if (existing.direction === direction) {
      // Same vote → remove it (toggle off)
      await supabase.from("votes").delete().eq("id", existing.id);
      return res.status(200).json({ action: "removed" });
    } else {
      // Different vote → update
      await supabase.from("votes").update({ direction }).eq("id", existing.id);
      return res.status(200).json({ action: "updated", direction });
    }
  }

  // New vote
  await supabase.from("votes").insert({ find_id, user_id: user.id, direction });
  return res.status(201).json({ action: "created", direction });
}
