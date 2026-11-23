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

    let callerRole = profile?.role || null;
    if (!callerRole) {
      const { data: adminProfile, error: adminProfileError } = await admin
        .from("admin_profiles").select("role").eq("user_id", authData.user.id).maybeSingle();
      if (adminProfileError) throw adminProfileError;
      callerRole = adminProfile?.role || null;
    }

    if (!["admin", "super_admin"].includes(callerRole || "")) {
      return json({ error: "Droits administrateur insuffisants." }, 403);
    }

    const body = await req.json();
    const action = String(body.action || "");
    const clean = (v: unknown) => String(v ?? "").trim();
    const member = {
      nom: clean(body.nom), prenom: clean(body.prenom), sexe: clean(body.sexe),
      telephone: clean(body.telephone), numero_pdv: clean(body.numero_pdv),
      region: clean(body.region), ville: clean(body.ville), commune: clean(body.commune),
      emplacement: clean(body.emplacement), poste_occupe: clean(body.poste_occupe),
      numero_carte_origine: clean(body.numero_carte_origine),
    };

    if (member.numero_carte_origine !== "") {
      if (!/^\\d+$/.test(member.numero_carte_origine)) {
        return json({ error: "L'ancien numéro de carte doit être un nombre entier." }, 400);
      }
      const oldCardNumber = Number(member.numero_carte_origine);
      if (!Number.isSafeInteger(oldCardNumber) || oldCardNumber < 0) {
        return json({ error: "L'ancien numéro de carte est invalide." }, 400);
      }
      member.numero_carte_origine = String(oldCardNumber);
    }

    if (action === "add") {
      if (!member.nom || !member.prenom || !member.sexe || !member.telephone || !member.numero_pdv) {
        return json({ error: "Nom, prénom, sexe, téléphone et numéro PDV sont obligatoires." }, 400);
      }
      if (!["Féminin", "Masculin"].includes(member.sexe)) return json({ error: "Sexe invalide." }, 400);
      const requested = clean(body.member_number);
      const number = requested ? Number(requested) : null;
      if (requested && (!Number.isInteger(number) || number < 1 || number > 21)) {
        return json({ error: "La saisie manuelle est réservée aux numéros 1 à 21." }, 400);
      }
      const { data, error } = await admin.rpc("insert_member_by_admin", {
        p_member: member, p_member_number: number,
      });
      if (error) throw error;
      return json({ success: true, member_number: data?.member_number, message: "Membre enregistré." });
    }

    if (action === "update") {
      const id = clean(body.id);
      if (!id) return json({ error: "Identifiant du membre manquant." }, 400);
      if (!member.nom || !member.prenom || !member.sexe || !member.telephone || !member.numero_pdv) {
        return json({ error: "Nom, prénom, sexe, téléphone et numéro PDV sont obligatoires." }, 400);
      }
      if (!["Féminin", "Masculin"].includes(member.sexe)) return json({ error: "Sexe invalide." }, 400);
      const { data, error } = await admin.from("members").update({
        nom: member.nom, prenom: member.prenom, sexe: member.sexe,
        telephone: member.telephone, numero_pdv: member.numero_pdv,
        region: member.region || null, ville: member.ville || null, commune: member.commune || null,
        emplacement: member.emplacement || null, poste_occupe: member.poste_occupe || null,
        numero_carte_origine: member.numero_carte_origine !== ""
          ? Number(member.numero_carte_origine)
          : null,
      }).eq("id", id).select("id,member_number,numero_carte_origine").maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: "Membre introuvable." }, 404);
      return json({
        success: true,
        message: "Dossier du membre mis à jour.",
        member_number: data.member_number,
        numero_carte_origine: data.numero_carte_origine,
      });
    }

    if (action === "delete") {
      const id = clean(body.id);
      if (!id) return json({ error: "Identifiant du membre manquant." }, 400);
      const { data: existing, error: readError } = await admin.from("members")
        .select("id,selfie_path,member_number").eq("id", id).maybeSingle();
      if (readError) throw readError;
      if (!existing) return json({ error: "Membre introuvable." }, 404);
      const { error: deleteError } = await admin.from("members").delete().eq("id", id);
      if (deleteError) throw deleteError;
      if (existing.selfie_path && !existing.selfie_path.startsWith("manual/")) {
        const { error: photoError } = await admin.storage.from("member-selfies").remove([existing.selfie_path]);
        if (photoError) console.warn("Suppression selfie:", photoError.message);
      }
      return json({ success: true, message: `Membre N° ${existing.member_number} supprimé.` });
    }

    return json({ error: "Action inconnue." }, 400);
  } catch (error) {
    console.error("admin-manage-member:", error);
    return json({ error: error instanceof Error ? error.message : "Erreur inattendue." }, 500);
  }
});
