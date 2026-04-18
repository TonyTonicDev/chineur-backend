import { getUser } from "../../lib/auth.js";
import { supabase } from "../../lib/supabase.js";
import { cors } from "../../lib/cors.js";

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const { find_id } = req.query;
  if (!find_id) return res.status(400).json({ error: "Missing find_id" });

  // GET — fetch all comments
  if (req.method === "GET") {
    const { data: comments, error } = await supabase
      .from("comments")
      .select("id, text, created_at, user_id")
      .eq("find_id", find_id)
      .order("created_at", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    if (!comments || comments.length === 0) return res.status(200).json({ comments: [] });

    // Fetch usernames separately
    const userIds = [...new Set(comments.map(c => c.user_id))];
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, username")
      .in("id", userIds);

    const enriched = comments.map(c => ({
      ...c,
      username: profiles?.find(p => p.id === c.user_id)?.username || "chineur",
    }));

    return res.status(200).json({ comments: enriched });
  }

  // POST — add a comment
  if (req.method === "POST") {
    const { user, error: authError } = await getUser(req);
    if (authError || !user) return res.status(401).json({ error: "Unauthorized" });

    const { text } = req.body || {};
    if (!text?.trim()) return res.status(400).json({ error: "Missing text" });
    if (text.length > 500) return res.status(400).json({ error: "Comment too long" });

    const { data, error } = await supabase.from("comments").insert({
      find_id,
      user_id: user.id,
      text: text.trim(),
    }).select("id, text, created_at, user_id").single();

    if (error) return res.status(500).json({ error: error.message });

    // Fetch username
    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .single();

    return res.status(201).json({
      comment: { ...data, username: profile?.username || "chineur" }
    });
  }

  return res.status(405).end();
}
