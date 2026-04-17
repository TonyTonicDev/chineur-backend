import { getUser } from "../lib/auth.js";
import { isPremium } from "../lib/subscription.js";
import { cors } from "../lib/cors.js";

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  const { user, error } = await getUser(req);
  if (error || !user) return res.status(401).json({ error: "Unauthorized" });
  const premium = await isPremium(user.id);
  return res.status(200).json({ id: user.id, email: user.email, premium });
}
