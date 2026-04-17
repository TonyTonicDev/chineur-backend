import Stripe from "stripe";
import { getUser } from "../lib/auth.js";
import { supabase } from "../lib/supabase.js";
import { cors } from "../lib/cors.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const { user, error } = await getUser(req);
  if (error || !user) return res.status(401).json({ error: "Unauthorized" });

  const { successUrl, cancelUrl } = req.body || {};

  let customerId;
  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .single();

  if (profile?.stripe_customer_id) {
    customerId = profile.stripe_customer_id;
  } else {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { supabase_user_id: user.id }
    });
    customerId = customer.id;
    await supabase.from("profiles").upsert({ id: user.id, stripe_customer_id: customerId });
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
    success_url: successUrl || `${process.env.APP_URL}?premium=success`,
    cancel_url:  cancelUrl  || `${process.env.APP_URL}?premium=cancel`,
    subscription_data: { metadata: { supabase_user_id: user.id } }
  });

  return res.status(200).json({ url: session.url });
}
