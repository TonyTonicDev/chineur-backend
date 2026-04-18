import { getUser } from "../lib/auth.js";
import { isPremium } from "../lib/subscription.js";
import { supabase } from "../lib/supabase.js";
import { cors } from "../lib/cors.js";

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const { user, error } = await getUser(req);
  if (error || !user) return res.status(401).json({ error: "Unauthorized" });

  let premium = false;
  try { premium = await isPremium(user.id); } catch(e) {}

  // Get real analyses count for today
  const today = new Date().toISOString().split("T")[0];
  let analysesToday = 0;
  try {
    const { count } = await supabase
      .from("usage")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("date", today);
    analysesToday = count || 0;
  } catch(e) {}

  return res.status(200).json({
    id: user.id,
    email: user.email,
    premium,
    analyses_today: analysesToday,
    daily_limit: 10,
    analyses_remaining: premium ? null : Math.max(10 - analysesToday, 0),
  });
}

