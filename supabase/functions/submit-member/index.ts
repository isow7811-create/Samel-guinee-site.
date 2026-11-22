
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_SIZE = 5 * 1024 * 1024;
const NOTIFICATION_EMAIL = "samelguinee224@gmail.com";

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function getValue(form: FormData, name: string): string {
  const item = form.get(name);
  return typeof item === "string" ? item.trim() : "";
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Méthode non autorisée." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) {
    console.error("Configuration Supabase incomplète.");
    return jsonResponse({
      error: "Configuration serveur incomplète.",
    }, 500);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  let uploadedPath: string | null = null;

  try {
    const form = await req.formData();

    const nom = getValue(form, "nom");
    const prenom = getValue(form, "prenom");
    const sexe = getValue(form, "sexe");
    const localisation = getValue(form, "region_ville_commune");
    const emplacement = getValue(form, "emplacement");
    const telephone = getValue(form, "telephone");
    const numeroPdv = getValue(form, "numero_pdv");
    const poste = getValue(form, "poste_occupe");
    const numeroAncien = getValue(form, "numero_existant");
    const selfie = form.get("selfie");

    if (
      !nom || !prenom || !sexe || !localisation ||
      !emplacement || !telephone || !numeroPdv
    ) {
      return jsonResponse({
        error: "Veuillez remplir tous les champs obligatoires.",
      }, 400);
    }

    if (!["Féminin", "Masculin"].includes(sexe)) {
      return jsonResponse({ error: "Sexe invalide." }, 400);
    }

    if (!(selfie instanceof File)) {
      return jsonResponse({ error: "Le selfie est obligatoire." }, 400);
    }

    if (selfie.size <= 0 || selfie.size > MAX_SIZE) {
      return jsonResponse({
        error: "Le selfie ne doit pas dépasser 5 Mo.",
      }, 400);
    }

    if (!["image/jpeg", "image/png", "image/webp"].includes(selfie.type)) {
      return jsonResponse({ error: "Format de photo non accepté." }, 400);
    }

    let memberNumber: number;
    let existingNumber: number | null = null;

    if (numeroAncien) {
      existingNumber = Number(numeroAncien);

      if (
        !Number.isInteger(existingNumber) ||
        existingNumber < 1 ||
        existingNumber > 21
      ) {
        return jsonResponse({
          error: "Le numéro d'une ancienne carte doit être compris entre 1 et 21.",
        }, 400);
      }

      memberNumber = existingNumber;
    } else {
      const { data, error } = await admin.rpc("allocate_member_number");

      if (error) {
        console.error("Erreur compteur :", error);
        throw new Error("Impossible d'attribuer un numéro de membre.");
      }

      memberNumber = Number(data);

      if (!Number.isInteger(memberNumber) || memberNumber < 22) {
        throw new Error("Le numéro attribué doit commencer à 22.");
      }
    }

    const extension =
      selfie.type === "image/png" ? "png" :
      selfie.type === "image/webp" ? "webp" : "jpg";

    uploadedPath = `${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } = await admin.storage
      .from("member-selfies")
      .upload(uploadedPath, selfie, {
        contentType: selfie.type,
        upsert: false,
      });

    if (uploadError) {
      console.error("Erreur photo :", uploadError);
      throw new Error("Impossible d'enregistrer le selfie.");
    }

    const { data: member, error: insertError } = await admin
      .from("members")
      .insert({
        member_number: memberNumber,
        nom,
        prenom,
        sexe,
        region_ville_commune: localisation,
        emplacement,
        telephone,
        numero_pdv: numeroPdv,
        poste_occupe: poste || null,
        numero_existant: existingNumber,
        selfie_path: uploadedPath,
      })
      .select("id, member_number")
      .single();

    if (insertError) {
      console.error("Erreur base de données :", insertError);

      if (insertError.code === "23505") {
        throw new Error("Ce numéro de membre est déjà enregistré.");
      }

      throw new Error("Impossible d'enregistrer le dossier du membre.");
    }

    let emailSent = false;

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const mailFrom = Deno.env.get("MAIL_FROM");

    if (resendKey && mailFrom) {
      try {
        const { data: signed, error: signedError } =
          await admin.storage
            .from("member-selfies")
            .createSignedUrl(uploadedPath, 7 * 24 * 60 * 60);

        const photoLink = !signedError ? signed?.signedUrl : null;

        const emailHtml = `
          <h2>Nouvelle inscription SAMEL-Guinée</h2>
          <p><b>Numéro de membre :</b> ${memberNumber}</p>
          <p><b>Nom :</b> ${escapeHtml(nom)} ${escapeHtml(prenom)}</p>
          <p><b>Sexe :</b> ${escapeHtml(sexe)}</p>
          <p><b>Téléphone :</b> ${escapeHtml(telephone)}</p>
          <p><b>Numéro PDV :</b> ${escapeHtml(numeroPdv)}</p>
          <p><b>Région / Ville / Commune :</b> ${escapeHtml(localisation)}</p>
          <p><b>Emplacement :</b> ${escapeHtml(emplacement)}</p>
          <p><b>Poste occupé :</b> ${escapeHtml(poste || "Non renseigné")}</p>
          <p><b>Selfie :</b> ${
            photoLink
              ? `<a href="${escapeHtml(photoLink)}">Consulter le selfie (lien valable 7 jours)</a>`
              : "Disponible dans l'espace administration"
          }</p>
        `;

        const mailResponse = await fetch(
          "https://api.resend.com/emails",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${resendKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: mailFrom,
              to: [NOTIFICATION_EMAIL],
              subject: `Nouvelle inscription SAMEL-Guinée — N° ${memberNumber}`,
              html: emailHtml,
            }),
          }
        );

        if (mailResponse.ok) {
          emailSent = true;
        } else {
          console.error("Erreur Resend :", await mailResponse.text());
        }
      } catch (mailError) {
        console.error("Erreur notification :", mailError);
      }
    } else {
      console.warn("Clés e-mail non configurées.");
    }

    return jsonResponse({
      success: true,
      member_number: member.member_number,
      email_sent: emailSent,
      message: "Inscription enregistrée avec succès.",
    });

  } catch (error) {
    console.error("Erreur submit-member :", error);

    if (uploadedPath) {
      const { error: cleanupError } = await admin.storage
        .from("member-selfies")
        .remove([uploadedPath]);

      if (cleanupError) {
        console.error("Erreur nettoyage photo :", cleanupError);
      }
    }

    return jsonResponse({
      error: error instanceof Error
        ? error.message
        : "Une erreur inattendue est survenue.",
    }, 400);
  }
});
