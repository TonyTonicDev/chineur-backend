import { supabase } from "./supabase.js";

export async function isPremium(userId) {
  try {
    const { data } = await supabase
      .from("subscriptions")
      .select("status, current_period_end")
      .eq("user_id", userId)
      .maybeSingle();

    if (!data) return false;

    const isActive = data.status === "active" || data.status === "trialing";
    const notExpired = new Date(data.current_period_end) > new Date();
    return isActive && notExpired;
  } catch(e) {
    return false;
  }
}
