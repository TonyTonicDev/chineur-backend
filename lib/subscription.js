import { supabase } from "./supabase.js";

export async function isPremium(userId) {
  const { data } = await supabase
    .from("subscriptions")
    .select("status, current_period_end")
    .eq("user_id", userId)
    .single();
  if (!data) return false;
  return (data.status === "active" || data.status === "trialing")
    && new Date(data.current_period_end) > new Date();
}
