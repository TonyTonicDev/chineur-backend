import { getUser } from "../lib/auth.js";
import { supabase } from "../lib/supabase.js";
import { cors } from "../lib/cors.js";

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  // Auth optionnelle — on accepte aussi les feedbacks anonymes
  const { user } = await getUser(req).catch(() => ({ user: null }));

  const { message, type, email } = req.body || {};
  if (!message?.trim()) return res.status(400).json({ error: "Missing message" });
  if (message.length > 2000) return res.status(400).json({ error: "Message too long (max 2000 chars)" });

  const validTypes = ["bug", "suggestion", "autre"];
  const feedbackType = validTypes.includes(type) ? type : "autre";

  // 1. Sauvegarder en base
  await supabase.from("feedbacks").insert({
    user_id: user?.id || null,
    user_email: user?.email || email || null,
    type: feedbackType,
    message: message.trim(),
  });

  // 2. Envoyer un email via Supabase Edge Function ou directement via l'API Resend/SMTP
  // On utilise ici l'API Resend (gratuit jusqu'à 3000 emails/mois)
  // Si vous préférez ne pas configurer Resend, les feedbacks sont quand même sauvegardés en base
  if (process.env.RESEND_API_KEY) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: "Chineur App <onboarding@resend.dev>",
          to: ["vousbijour@gmail.com"],
          subject: "Feedbacks Chineur",
          html: `
            <h2>Nouveau feedback Chineur</h2>
            <table style="border-collapse:collapse;width:100%;max-width:600px;">
              <tr><td style="padding:8px;font-weight:bold;color:#6b6b6b;">Type</td><td style="padding:8px;">${feedbackType}</td></tr>
              <tr style="background:#f5f5f3;"><td style="padding:8px;font-weight:bold;color:#6b6b6b;">Utilisateur</td><td style="padding:8px;">${user?.email || email || "Anonyme"}</td></tr>
              <tr><td style="padding:8px;font-weight:bold;color:#6b6b6b;">Message</td><td style="padding:8px;white-space:pre-wrap;">${message.trim()}</td></tr>
              <tr style="background:#f5f5f3;"><td style="padding:8px;font-weight:bold;color:#6b6b6b;">Date</td><td style="padding:8px;">${new Date().toLocaleString("fr-FR")}</td></tr>
            </table>
          `,
        }),
      });
    } catch (e) {
      // Email failed but feedback is saved — not critical
      console.error("Email send failed:", e.message);
    }
  }

  return res.status(201).json({ success: true });
}
