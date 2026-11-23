import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getBearer(req: Request) {
  const header = req.headers.get("Authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SAMEL_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "Configuration serveur incomplète." }, 500);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const token = getBearer(req);
    if (!token) return json({ error: "Authentification requise." }, 401);

    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Session invalide." }, 401);

    const { data: profile, error: profileError } = await admin
      .from("profiles").select("role").eq("user_id", authData.user.id).maybeSingle();
    if (profileError) throw profileError;
    if (profile?.role !== "super_admin") {
      return json({ error: "Seul le Super Administrateur peut créer des administrateurs." }, 403);
    }

    const body = await req.json();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "Adresse e-mail invalide." }, 400);
    }
    if (password.length < 12) {
      return json({ error: "Le mot de passe temporaire doit contenir au moins 12 caractères." }, 400);
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email, password, email_confirm: false,
    });
    if (createError) throw createError;

    const { error: insertError } = await admin.from("profiles").insert({
      user_id: created.user.id, role: "admin",
    });
    if (insertError) {
      await admin.auth.admin.deleteUser(created.user.id);
      throw insertError;
    }

    return json({ success: true, message: "Compte administrateur créé.", user_id: created.user.id });
  } catch (error) {
    console.error("admin-create-user:", error);
    return json({ error: error instanceof Error ? error.message : "Erreur inattendue." }, 500);
  }
});
