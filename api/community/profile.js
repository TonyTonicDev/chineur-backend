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
      .select("id, username, avatar_url, created_at")
      .eq("id", user.id)
      .maybeSingle();

    return res.status(200).json({ profile: data || { id: user.id, username: null } });
  }

  // PATCH — update username
  if (req.method === "PATCH") {
    const { username } = req.body || {};
    if (!username || username.trim().length < 2 || username.trim().length > 25) {
      return res.status(400).json({ error: "Username must be 2–25 characters" });
    }

    const clean = username.trim();

    // Check uniqueness
    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", clean)
      .neq("id", user.id)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: "Ce pseudo est déjà pris. Choisissez-en un autre." });
    }

    const { data, error } = await supabase
      .from("profiles")
      .upsert({ id: user.id, username: clean }, { onConflict: "id" })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ profile: data });
  }

  return res.status(405).end();
}
