import Anthropic from "@anthropic-ai/sdk";
import { getUser } from "../lib/auth.js";
import { isPremium } from "../lib/subscription.js";
import { supabase } from "../lib/supabase.js";
import { cors } from "../lib/cors.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DAILY_FREE_LIMIT = 10;

const SYSTEM_PROMPT = `Tu es un expert en brocante, antiquités et objets de collection avec 20 ans d'expérience. Tu connais les vraies cotations du marché de l'occasion en Europe (eBay vendu, Vinted, LeBonCoin, Catawiki).

RÈGLES ABSOLUES :
1. Sois CONSERVATEUR et PRUDENT. En cas de doute, dis "À vérifier" plutôt que "Bonne affaire".
2. Ne te base jamais sur le prix neuf — l'occasion vaut toujours bien moins.
3. Si tu ne peux pas identifier clairement l'objet ou la marque sur la photo → confiance = "faible", verdict = "warn".
4. Un objet courant de brocante sans marque identifiable vaut rarement plus de 5-15€.
5. Les prix de revente sont les prix RÉELS constatés sur eBay occasions vendues, pas les prix demandés.
6. Sois honnête sur les risques : contrefaçon, état inconnu, marché saturé.

GUIDE PAR CATÉGORIE :

MONTRES :
- Sans marque visible → prix_revente_max 15€, verdict warn
- Entrée de gamme (Casio, Timex, Seiko basique) → 10-40€ si bon état
- Milieu de gamme (Tissot, Longines, Citizen vintage) → 50-200€ si état excellent et fonctionnelle
- Premium (Omega, Tag Heuer, IWC) → 200-2000€ mais vérifier authenticité absolument
- Alertes : verre rayé, couronne manquante, rouille, bracelet de remplacement bas de gamme
- Question prioritaire : "La montre fonctionne-t-elle ? Quelle référence est inscrite au dos ?"

APPAREILS PHOTO :
- Compacts numériques 2000-2015 → 5-20€, marché très saturé
- Reflex numériques (Canon, Nikon) → 30-150€ selon génération
- Argentiques mécaniques (Pentax, Olympus, Minolta) → 20-80€ si fonctionnel
- Leica, Hasselblad, Rolleiflex → 200-2000€ mais authenticité à vérifier
- Alertes : moisissures sur optique, obturateur bloqué, film coincé, impacts
- Question prioritaire : "L'obturateur se déclenche-t-il ? Y a-t-il des moisissures dans l'objectif ?"

CARTES POKÉMON :
- Cartes communes récentes → 0,10-0,50€ pièce, quasi sans valeur en vrac
- Rares récentes → 1-10€ sauf exceptions
- 1ère édition 1999 (logo + absence d'ombre) → 20-500€+ selon carte et état
- Holographiques Base Set → 10-200€ selon carte et état
- CRUCIAL : moindre pli = -80% de valeur. Vérifier authenticité des lots.
- Question prioritaire : "Vois-tu un logo 1ère édition ? Quel est l'état précis (plis, rayures) ?"

VÊTEMENTS VINTAGE :
- Sans marque identifiable → 3-15€ max
- Vintage désirable (Levi's 501, Carhartt, Harrington) → 20-80€
- Luxe vintage (Hermès, Chanel) → 50-500€ mais authenticité à vérifier
- Streetwear 90s (Nike, Adidas, Champion) → 15-60€
- Alertes : taches visibles, usure excessive, étiquette manquante
- Question prioritaire : "Y a-t-il des défauts visibles (taches, trous, décoloration) ?"

RÈGLE DE VERDICT :
- "ok" SEULEMENT si : marge > 50% ET objet clairement identifié ET état visible bon → maximum 30% des cas
- "warn" : doute sur identité OU état OU marge < 50% → cas le plus fréquent
- "ko" : faux probable OU état clairement mauvais OU objet sans valeur réelle

Ne mets jamais "ok" si tu n'es pas certain à 80% minimum. Mieux vaut un "warn" honnête qu'un "ok" trompeur.`;

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

  const extraNote = extra ? `\nDétail fourni par l'utilisateur : ${extra}` : "";

  const userPrompts = {
    fr: `${extraNote}
Analyse cette photo d'un objet de brocante. Réponds UNIQUEMENT avec un JSON valide, sans texte avant ou après.

Format JSON attendu :
{
  "objet_nom": "nom précis de l'objet",
  "objet_detail": "marque, modèle, époque — sois précis ou indique 'Non identifié'",
  "confiance": "haute" | "moyenne" | "faible",
  "confiance_note": "explique pourquoi cette confiance en 1 phrase",
  "verdict": "ok" | "warn" | "ko",
  "verdict_label": "Bonne affaire" | "À vérifier" | "Risqué",
  "verdict_desc": "justification honnête du verdict en 1 phrase",
  "prix_achat_min": 0,
  "prix_achat_max": 0,
  "prix_revente_min": 0,
  "prix_revente_max": 0,
  "analyse": "analyse honnête en 2-3 phrases, mentionne les risques et incertitudes",
  "verifications": ["point à vérifier sur place 1", "point 2", "point 3"],
  "questions_refinement": ["question la plus utile pour affiner l'analyse", "question 2"]
}`,

    en: `${extraNote}
Analyse this photo of a flea market item. Reply ONLY with valid JSON, no text before or after.

Expected JSON format:
{
  "objet_nom": "precise item name",
  "objet_detail": "brand, model, era — be precise or state 'Not identified'",
  "confiance": "haute" | "moyenne" | "faible",
  "confiance_note": "explain this confidence level in 1 sentence",
  "verdict": "ok" | "warn" | "ko",
  "verdict_label": "Good deal" | "Check it" | "Risky",
  "verdict_desc": "honest verdict justification in 1 sentence",
  "prix_achat_min": 0,
  "prix_achat_max": 0,
  "prix_revente_min": 0,
  "prix_revente_max": 0,
  "analyse": "honest 2-3 sentence analysis, mention risks and uncertainties",
  "verifications": ["on-site check 1", "check 2", "check 3"],
  "questions_refinement": ["most useful question to refine the analysis", "question 2"]
}`,

    nl: `${extraNote}
Analyseer deze foto van een vlooienmarktartikel. Antwoord ALLEEN met geldige JSON, geen tekst ervoor of erna.

Verwacht JSON-formaat:
{
  "objet_nom": "precieze naam van het artikel",
  "objet_detail": "merk, model, tijdperk — wees precies of vermeld 'Niet geïdentificeerd'",
  "confiance": "haute" | "moyenne" | "faible",
  "confiance_note": "leg dit vertrouwensniveau uit in 1 zin",
  "verdict": "ok" | "warn" | "ko",
  "verdict_label": "Goede deal" | "Controleren" | "Riskant",
  "verdict_desc": "eerlijke verdichtverklaring in 1 zin",
  "prix_achat_min": 0,
  "prix_achat_max": 0,
  "prix_revente_min": 0,
  "prix_revente_max": 0,
  "analyse": "eerlijke analyse van 2-3 zinnen, vermeld risico's en onzekerheden",
  "verifications": ["te controleren punt 1", "punt 2", "punt 3"],
  "questions_refinement": ["meest nuttige vraag om analyse te verfijnen", "vraag 2"]
}`,

    es: `${extraNote}
Analiza esta foto de un artículo de mercadillo. Responde SOLO con JSON válido, sin texto antes ni después.

Formato JSON esperado:
{
  "objet_nom": "nombre preciso del artículo",
  "objet_detail": "marca, modelo, época — sé preciso o indica 'No identificado'",
  "confiance": "haute" | "moyenne" | "faible",
  "confiance_note": "explica este nivel de confianza en 1 frase",
  "verdict": "ok" | "warn" | "ko",
  "verdict_label": "Buena oferta" | "Verificar" | "Arriesgado",
  "verdict_desc": "justificación honesta del veredicto en 1 frase",
  "prix_achat_min": 0,
  "prix_achat_max": 0,
  "prix_revente_min": 0,
  "prix_revente_max": 0,
  "analyse": "análisis honesto de 2-3 frases, menciona riesgos e incertidumbres",
  "verifications": ["punto a verificar in situ 1", "punto 2", "punto 3"],
  "questions_refinement": ["pregunta más útil para afinar el análisis", "pregunta 2"]
}`,
  };

  try {
    let mediaType = "image/jpeg";
    if (imageB64.startsWith("/9j/")) mediaType = "image/jpeg";
    else if (imageB64.startsWith("iVBOR")) mediaType = "image/png";
    else if (imageB64.startsWith("R0lGO")) mediaType = "image/gif";
    else if (imageB64.startsWith("UklGR")) mediaType = "image/webp";

    // Build image content — main + optional extra photos (max 3 total)
    const { extraImages } = req.body || {};
    const imageContent = [
      { type: "image", source: { type: "base64", media_type: mediaType, data: imageB64 } }
    ];
    if (Array.isArray(extraImages) && extraImages.length > 0) {
      extraImages.slice(0, 2).forEach(b64 => {
        let mt = "image/jpeg";
        if (b64.startsWith("/9j/")) mt = "image/jpeg";
        else if (b64.startsWith("iVBOR")) mt = "image/png";
        else if (b64.startsWith("UklGR")) mt = "image/webp";
        imageContent.push({ type: "image", source: { type: "base64", media_type: mt, data: b64 } });
      });
    }

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: [
        ...imageContent,
        { type: "text", text: (extraImages?.length > 0 ? '(' + (extraImages.length + 1) + ' photos fournies) ' : '') + (userPrompts[lang] || userPrompts.fr) }
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

    result.confiance = ["haute","moyenne","faible"].includes(result.confiance) ? result.confiance : "faible";
    result.verdict = ["ok","warn","ko"].includes(result.verdict) ? result.verdict : "warn";
    ["prix_achat_min","prix_achat_max","prix_revente_min","prix_revente_max"].forEach(k => {
      result[k] = Number(result[k]) || 0;
    });
    result.verifications = Array.isArray(result.verifications) ? result.verifications : [];
    result.questions_refinement = Array.isArray(result.questions_refinement) ? result.questions_refinement : [];

    try { await supabase.from("usage").insert({ user_id: user.id, date: today }); } catch(e) {}

    return res.status(200).json({
      result,
      premium,
      show_ad: false,
      analyses_today: analysesToday + 1,
      daily_limit: DAILY_FREE_LIMIT,
      analyses_remaining: premium ? null : DAILY_FREE_LIMIT - analysesToday - 1,
    });

  } catch (err) {
    return res.status(500).json({ error: "Analysis failed: " + err.message });
  }
}
