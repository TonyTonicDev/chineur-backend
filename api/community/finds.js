import { getUser } from "../../lib/auth.js";
import { supabase } from "../../lib/supabase.js";
import { cors } from "../../lib/cors.js";

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  // GET — top 10 finds of current month
  if (req.method === "GET") {
    const month = new Date().toISOString().substring(0, 7);
    try {
      const { data, error } = await supabase
        .from("finds")
        .select("id, name, detail, verdict, prix_revente, prix_paye, marge_reelle, location, image_url, description, created_at, month, user_id, profiles:user_id(username, avatar_url)")
        .eq("month", month)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Fetch votes and comments counts separately
      const finds = await Promise.all((data || []).map(async f => {
        const [votesRes, commRes] = await Promise.all([
          supabase.from("votes").select("direction").eq("find_id", f.id),
          supabase.from("comments").select("id", { count: "exact", head: true }).eq("find_id", f.id),
        ]);
        const votes = votesRes.data || [];
        const up = votes.filter(v => v.direction === "up").length;
        const down = votes.filter(v => v.direction === "down").length;
        const net = up - down;
        return {
          ...f,
          votes_up: up,
          votes_down: down,
          net_votes: net,
          comment_count: commRes.count || 0,
          score: net * (f.prix_revente || 0),
        };
      }));

      finds.sort((a, b) => b.score - a.score);
      return res.status(200).json({ finds: finds.slice(0, 10) });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // POST — share a find
  if (req.method === "POST") {
    const { user, error: authError } = await getUser(req);
    if (authError || !user) return res.status(401).json({ error: "Unauthorized" });

    const { name, detail, verdict, prix_revente, prix_paye, marge_reelle, location, image_url, description } = req.body || {};
    if (!name) return res.status(400).json({ error: "Missing name" });

    const month = new Date().toISOString().substring(0, 7);

    try {
      const { data, error } = await supabase.from("finds").insert({
        user_id: user.id,
        name,
        detail: detail || null,
        verdict: verdict || "warn",
        prix_revente: Number(prix_revente) || 0,
        prix_paye: Number(prix_paye) || 0,
        marge_reelle: Number(marge_reelle) || 0,
        location: location || null,
        image_url: image_url || null,
        description: description || null,
        month,
      }).select().single();

      if (error) throw error;

      // Auto-upvote by sharer
      await supabase.from("votes").insert({ find_id: data.id, user_id: user.id, direction: "up" });

      return res.status(201).json({ find: data });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).end();
}
