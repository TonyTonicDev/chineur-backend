import { getUser } from "../../lib/auth.js";
import { supabase } from "../../lib/supabase.js";
import { cors } from "../../lib/cors.js";

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const { find_id } = req.query;
  if (!find_id) return res.status(400).json({ error: "Missing find_id" });

  // GET — fetch all comments for a find
  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("comments")
      .select(`
        id, text, created_at,
        profiles:user_id ( username, avatar_url )
      `)
      .eq("find_id", find_id)
      .order("created_at", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ comments: data || [] });
  }

  // POST — add a comment
  if (req.method === "POST") {
    const { user, error: authError } = await getUser(req);
    if (authError || !user) return res.status(401).json({ error: "Unauthorized" });

    const { text } = req.body || {};
    if (!text?.trim()) return res.status(400).json({ error: "Missing text" });
    if (text.length > 500) return res.status(400).json({ error: "Comment too long (max 500 chars)" });

    const { data, error } = await supabase.from("comments").insert({
      find_id,
      user_id: user.id,
      text: text.trim(),
    }).select(`
      id, text, created_at,
      profiles:user_id ( username, avatar_url )
    `).single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ comment: data });
  }

  // DELETE — delete own comment
  if (req.method === "DELETE") {
    const { user, error: authError } = await getUser(req);
    if (authError || !user) return res.status(401).json({ error: "Unauthorized" });

    const { comment_id } = req.body || {};
    if (!comment_id) return res.status(400).json({ error: "Missing comment_id" });

    const { error } = await supabase.from("comments")
      .delete()
      .eq("id", comment_id)
      .eq("user_id", user.id); // can only delete own comments

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ deleted: true });
  }

  return res.status(405).end();
}
