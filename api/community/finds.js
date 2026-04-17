import { getUser } from "../../lib/auth.js";
import { supabase } from "../../lib/supabase.js";
import { cors } from "../../lib/cors.js";

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  // GET — fetch top 10 finds of current month, sorted by score (votes × price)
  if (req.method === "GET") {
    const month = new Date().toISOString().substring(0, 7); // "2026-04"

    const { data, error } = await supabase
      .from("finds")
      .select(`
        id, name, detail, verdict, prix_revente, image_url,
        created_at, month,
        profiles:user_id ( username, avatar_url ),
        votes ( direction ),
        comments ( count )
      `)
      .eq("month", month)
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    // Compute score = net_votes × prix_revente
    const scored = (data || []).map(find => {
      const up   = find.votes.filter(v => v.direction === "up").length;
      const down = find.votes.filter(v => v.direction === "down").length;
      const net  = up - down;
      return {
        ...find,
        votes_up: up,
        votes_down: down,
        net_votes: net,
        comment_count: find.comments?.[0]?.count || 0,
        score: net * (find.prix_revente || 0),
      };
    });

    scored.sort((a, b) => b.score - a.score);
    const top10 = scored.slice(0, 10);

    return res.status(200).json({ finds: top10 });
  }

  // POST — share a new find
  if (req.method === "POST") {
    const { user, error: authError } = await getUser(req);
    if (authError || !user) return res.status(401).json({ error: "Unauthorized" });

    const { name, detail, verdict, prix_revente, image_url, analyse } = req.body || {};
    if (!name) return res.status(400).json({ error: "Missing name" });

    const month = new Date().toISOString().substring(0, 7);

    const { data, error } = await supabase.from("finds").insert({
      user_id: user.id,
      name,
      detail,
      verdict,
      prix_revente: Number(prix_revente) || 0,
      image_url,
      analyse,
      month,
    }).select().single();

    if (error) return res.status(500).json({ error: error.message });

    // Auto-upvote by the sharer
    await supabase.from("votes").insert({
      find_id: data.id,
      user_id: user.id,
      direction: "up",
    });

    return res.status(201).json({ find: data });
  }

  return res.status(405).end();
}
