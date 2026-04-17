import { getUser } from "../../lib/auth.js";
import { supabase } from "../../lib/supabase.js";
import { cors } from "../../lib/cors.js";

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const { user, error: authError } = await getUser(req);
  if (authError || !user) return res.status(401).json({ error: "Unauthorized" });

  // GET — fetch own profile
  if (req.method === "GET") {
    const { data } = await supabase
      .from("profiles")
      .select("id, username, avatar_url, stripe_customer_id, created_at")
      .eq("id", user.id)
      .single();

    return res.status(200).json({ profile: data || { id: user.id, username: null } });
  }

  // PATCH — update username or avatar
  if (req.method === "PATCH") {
    const { username, avatar_url } = req.body || {};
    const updates = {};
    if (username !== undefined) {
      if (username.length < 2 || username.length > 30) {
        return res.status(400).json({ error: "Username must be 2–30 characters" });
      }
      updates.username = username.trim();
    }
    if (avatar_url !== undefined) updates.avatar_url = avatar_url;
    if (!Object.keys(updates).length) return res.status(400).json({ error: "Nothing to update" });

    const { data, error } = await supabase
      .from("profiles")
      .upsert({ id: user.id, ...updates })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ profile: data });
  }

  return res.status(405).end();
}
