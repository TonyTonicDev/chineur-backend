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
      // Fetch finds
      const { data: finds, error } = await supabase
        .from("finds")
        .select("id, name, detail, verdict, prix_revente, prix_paye, marge_reelle, location, image_url, description, created_at, month, user_id")
        .eq("month", month)
        .order("created_at", { ascending: false });

      if (error) throw error;
      if (!finds || finds.length === 0) return res.status(200).json({ finds: [] });

      // Fetch all votes and comments for these finds in bulk
      const findIds = finds.map(f => f.id);

      const [votesRes, commRes, profilesRes] = await Promise.all([
        supabase.from("votes").select("find_id, direction").in("find_id", findIds),
        supabase.from("comments").select("find_id").in("find_id", findIds),
        supabase.from("profiles").select("id, username").in("id", finds.map(f => f.user_id)),
      ]);

      const votes = votesRes.data || [];
      const comments = commRes.data || [];
      const profiles = profilesRes.data || [];

      const enriched = finds.map(f => {
        const fVotes = votes.filter(v => v.find_id === f.id);
        const up = fVotes.filter(v => v.direction === "up").length;
        const down = fVotes.filter(v => v.direction === "down").length;
        const net = up - down;
        const profile = profiles.find(p => p.id === f.user_id);
        return {
          ...f,
          votes_up: up,
          votes_down: down,
          net_votes: net,
          comment_count: comments.filter(c => c.find_id === f.id).length,
          score: net * (f.prix_revente || 1), // at least 1 so new items appear
          username: profile?.username || "chineur",
        };
      });

      enriched.sort((a, b) => b.score - a.score);
      return res.status(200).json({ finds: enriched.slice(0, 10) });

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
      await supabase.from("votes").insert({
        find_id: data.id,
        user_id: user.id,
        direction: "up"
      });

      return res.status(201).json({ find: data });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).end();
}
