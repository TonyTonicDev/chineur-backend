import Anthropic from "@anthropic-ai/sdk";
import { getUser } from "../lib/auth.js";
import { isPremium } from "../lib/subscription.js";
import { supabase } from "../lib/supabase.js";
import { cors } from "../lib/cors.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DAILY_FREE_LIMIT = 10;
const FREE_AD_THRESHOLD = 3;

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const { user, error: authError } = await getUser(req);
  if (authError || !user) return res.status(401).json({ error: "Unauthorized" });

  let premium = false;
  try { premium = await isPremium(user.id); } catch(e) { premium = false; }

  const today = new Date().toISOString().split("T")[0];

  let analysesToday = 0;
  try {
    const { count } = await supabase
      .from("usage")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("date", today);
    analysesToday = count || 0;
  } catch(e) { analysesToday = 0; }

  if (!premium && analysesToday >= DAILY_FREE_LIMIT) {
    return res.status(429).json({
      error: "daily_limit_reached",
      limit: DAILY_FREE_LIMIT,
      premium_cta: true,
    });
  }

  const { imageB64, lang, extra } = req.body || {};
  if (!imageB64) return res.status(400).json({ error: "Missing imageB64" });

  const show_ad = !premium && analysesToday >= FREE_AD_THRESHOLD;
  const extraNote = extra ? `\nDétail : ${extra}` : "";

  const prompts = {
    fr: `Tu es un expert en antiquités, brocante, vintage et objets de collection.${extraNote}\nAnalyse cette image. Réponds UNIQUEMENT avec un JSON valide, aucun texte avant/après :\n{"objet_nom":"...","objet_detail":"marque/modèle/époque","confiance":"haute","confiance_note":"phrase","verdict":"ok","verdict_label":"Bonne affaire","verdict_desc":"phrase","prix_achat_min":0,"prix_achat_max":0,"prix_revente_min":0,"prix_revente_max":0,"analyse":"2-3 phrases","verifications":["p1","p2","p3"],"questions_refinement":["q1","q2"]}`,
    en: `You are an expert in antiques, flea markets and collectibles.${extraNote}\nAnalyse this image. Reply ONLY with valid JSON, no text before/after:\n{"objet_nom":"...","objet_detail":"brand/model/era","confiance":"haute","confiance_note":"phrase","verdict":"ok","verdict_label":"Good deal","verdict_desc":"phrase","prix_achat_min":0,"prix_achat_max":0,"prix_revente_min":0,"prix_revente_max":0,"analyse":"2-3 sentences","verifications":["p1","p2","p3"],"questions_refinement":["q1","q2"]}`,
    nl: `Je bent expert in antiek en vlooienmarkten.${extraNote}\nAnalyseer dit beeld. Antwoord ALLEEN met geldig JSON:\n{"objet_nom":"...","objet_detail":"merk/model/tijdperk","confiance":"haute","confiance_note":"zin","verdict":"ok","verdict_label":"Goede deal","verdict_desc":"zin","prix_achat_min":0,"prix_achat_max":0,"prix_revente_min":0,"prix_revente_max":0,"analyse":"2-3 zinnen","verifications":["p1","p2","p3"],"questions_refinement":["q1","q2"]}`,
    es: `Eres experto en antigüedades y mercadillos.${extraNote}\nAnaliza esta imagen. Responde SOLO con JSON válido:\n{"objet_nom":"...","objet_detail":"marca/modelo/época","confiance":"haute","confiance_note":"frase","verdict":"ok","verdict_label":"Buena oferta","verdict_desc":"frase","prix_achat_min":0,"prix_achat_max":0,"prix_revente_min":0,"prix_revente_max":0,"analyse":"2-3 frases","verifications":["p1","p2","p3"],"questions_refinement":["q1","q2"]}`,
  };

  try {
    let mediaType = "image/jpeg";
    if (imageB64.startsWith("/9j/")) mediaType = "image/jpeg";
    else if (imageB64.startsWith("iVBOR")) mediaType = "image/png";
    else if (imageB64.startsWith("R0lGO")) mediaType = "image/gif";
    else if (imageB64.startsWith("UklGR")) mediaType = "image/webp";

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1200,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: imageB64 } },
        { type: "text", text: prompts[lang] || prompts.fr }
      ]}]
    });

    const raw = response.content.map(b => b.type === "text" ? b.text : "").join("");
    let result = null;
    for (const fn of [
      () => JSON.parse(raw.trim()),
      () => JSON.parse(raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```\s*$/, "").trim()),
      () => { const m = raw.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); throw 0; },
    ]) { try { result = fn(); if (result?.objet_nom) break; result = null; } catch(e) {} }

    if (!result?.objet_nom) throw new Error("Invalid JSON: " + raw.substring(0, 200));

    result.confiance = result.confiance || "moyenne";
    result.verdict = ["ok","warn","ko"].includes(result.verdict) ? result.verdict : "warn";
    ["prix_achat_min","prix_achat_max","prix_revente_min","prix_revente_max"].forEach(k => {
      result[k] = Number(result[k]) || 0;
    });
    result.verifications = Array.isArray(result.verifications) ? result.verifications : [];
    result.questions_refinement = Array.isArray(result.questions_refinement) ? result.questions_refinement : [];

    try { await supabase.from("usage").insert({ user_id: user.id, date: today }); } catch(e) {}

    return res.status(200).json({
      result, premium, show_ad,
      analyses_today: analysesToday + 1,
      daily_limit: DAILY_FREE_LIMIT,
      analyses_remaining: premium ? null : DAILY_FREE_LIMIT - analysesToday - 1,
    });

  } catch (err) {
    return res.status(500).json({ error: "Analysis failed: " + err.message });
  }
}
