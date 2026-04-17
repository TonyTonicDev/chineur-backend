import Stripe from "stripe";
import { supabase } from "../lib/supabase.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const rawBody = await getRawBody(req);
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).json({ error: "Invalid signature" });
  }

  const sub = event.data.object;
  const userId = sub.metadata?.supabase_user_id;

  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
    if (userId) await supabase.from("subscriptions").upsert({
      user_id: userId,
      stripe_subscription_id: sub.id,
      status: sub.status,
      current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
  }

  if (event.type === "customer.subscription.deleted") {
    if (userId) await supabase.from("subscriptions")
      .update({ status: "canceled", updated_at: new Date().toISOString() })
      .eq("user_id", userId);
  }

  if (event.type === "invoice.payment_failed") {
    const inv = event.data.object;
    if (inv.subscription) {
      const s = await stripe.subscriptions.retrieve(inv.subscription);
      const uid = s.metadata?.supabase_user_id;
      if (uid) await supabase.from("subscriptions")
        .update({ status: "past_due", updated_at: new Date().toISOString() })
        .eq("user_id", uid);
    }
  }

  return res.status(200).json({ received: true });
}
