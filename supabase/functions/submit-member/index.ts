
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_SIZE = 5 * 1024 * 1024;
const NOTIFICATION_EMAIL = "samelguinee224@gmail.com";

function jsonResponse(
  body: Record<string, unknown>,
  status = 200
): Response {
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

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({
      error: "Méthode non autorisée.",
    }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey =
    Deno.env.get("SAMEL_SERVICE_ROLE_KEY") ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

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
  let memberInserted = false;

  try {
    const form = await req.formData();

    // Récupération des champs du formulaire HTML.
    const nom = getValue(form, "nom");
    const prenom = getValue(form, "prenom");
    const sexe = getValue(form, "sexe");
    const region = getValue(form, "region");
    const ville = getValue(form, "ville");
    const commune = getValue(form, "commune");
    const emplacement = getValue(form, "emplacement");
    const telephone = getValue(form, "telephone");
    const numeroPdv = getValue(form, "numero_pdv");
    const poste = getValue(form, "poste_occupe");
    const numeroCarteText = getValue(form, "numero_existant");
    const selfie = form.get("selfie");

    // Vérification des informations obligatoires.
    if (
      !nom ||
      !prenom ||
      !sexe ||
      !region ||
      !ville ||
      !commune ||
      !emplacement ||
      !telephone ||
      !numeroPdv
    ) {
      return jsonResponse({
        error: "Veuillez remplir tous les champs obligatoires.",
      }, 400);
    }

    if (!["Féminin", "Masculin"].includes(sexe)) {
      return jsonResponse({
        error: "Sexe invalide.",
      }, 400);
    }

    // Vérification du numéro de carte d'origine.
    let numeroCarte: number | null = null;

    if (numeroCarteText !== "") {
      if (!/^\d+$/.test(numeroCarteText)) {
        return jsonResponse({
          error: "Le numéro de carte doit être un nombre entier.",
        }, 400);
      }

      numeroCarte = Number(numeroCarteText);

      if (
        !Number.isSafeInteger(numeroCarte) ||
        numeroCarte < 22
      ) {
        return jsonResponse({
          error: "Les numéros de carte de 1 à 21 sont réservés au BEN.",
        }, 400);
      }
    }

    // Vérification du selfie.
    if (!(selfie instanceof File)) {
      return jsonResponse({
        error: "Le selfie est obligatoire.",
      }, 400);
    }

    if (selfie.size <= 0 || selfie.size > MAX_SIZE) {
      return jsonResponse({
        error: "Le selfie ne doit pas dépasser 5 Mo.",
      }, 400);
    }

    if (!["image/jpeg", "image/png", "image/webp"].includes(selfie.type)) {
      return jsonResponse({
        error: "Format de photo non accepté.",
      }, 400);
    }

    const extension =
      selfie.type === "image/png" ? "png" :
      selfie.type === "image/webp" ? "webp" : "jpg";

    // Conservation du stockage privé des selfies.
    uploadedPath =
      `inscriptions/${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } = await admin.storage
      .from("member-selfies")
      .upload(uploadedPath, selfie, {
        contentType: selfie.type,
        upsert: false,
      });

    if (uploadError) {
      console.error("Erreur stockage selfie :", uploadError);
      throw new Error("Impossible d'enregistrer le selfie.");
    }

    // Attribution du numéro par la fonction SQL existante.
    // Les numéros 1 à 21 ne sont jamais attribués publiquement.
    const { data: member, error: insertError } =
      await admin.rpc("insert_member_with_auto_number", {
        p_member: {
          nom,
          prenom,
          sexe,
          telephone,
          numero_pdv: numeroPdv,
          region,
          ville,
          commune,
          emplacement,
          poste_occupe: poste || null,
          selfie_path: uploadedPath,
        },
        p_requested_number: numeroCarte,
      });

    if (insertError) {
      console.error("Erreur insertion membre :", insertError);
      throw new Error(
        insertError.message ||
        "Impossible d'enregistrer le dossier du membre."
      );
    }

    if (!member || !member.member_number) {
      throw new Error(
        "Le numéro d'identification du membre est introuvable."
      );
    }

    // À partir d'ici, le dossier est enregistré.
    // Une erreur d'e-mail ne doit pas supprimer le membre.
    memberInserted = true;

    const memberNumber = member.member_number;

    // Notification automatique par Resend.
    let emailSent = false;

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const mailFrom = Deno.env.get("MAIL_FROM");

    if (resendKey && mailFrom) {
      try {
        const { data: signed, error: signedError } =
          await admin.storage
            .from("member-selfies")
            .createSignedUrl(
              uploadedPath,
              7 * 24 * 60 * 60
            );

        const photoLink =
          !signedError ? signed?.signedUrl : null;

        const emailHtml = `
          <h2>Nouvelle inscription SAMEL-Guinée</h2>

          <p><b>Numéro de membre :</b> ${escapeHtml(memberNumber)}</p>
          <p><b>Nom :</b> ${escapeHtml(nom)}</p>
          <p><b>Prénom :</b> ${escapeHtml(prenom)}</p>
          <p><b>Sexe :</b> ${escapeHtml(sexe)}</p>
          <p><b>Téléphone :</b> ${escapeHtml(telephone)}</p>
          <p><b>Numéro PDV :</b> ${escapeHtml(numeroPdv)}</p>
          <p><b>Région :</b> ${escapeHtml(region)}</p>
          <p><b>Ville :</b> ${escapeHtml(ville)}</p>
          <p><b>Commune :</b> ${escapeHtml(commune)}</p>
          <p><b>Emplacement :</b> ${escapeHtml(emplacement)}</p>
          <p><b>Poste occupé :</b> ${escapeHtml(poste || "Non renseigné")}</p>
          <p><b>Numéro de carte d'origine :</b>
            ${numeroCarte ?? "Non renseigné"}
          </p>

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
              subject:
                `Nouvelle inscription SAMEL-Guinée — N° ${memberNumber}`,
              html: emailHtml,
            }),
          }
        );

        if (mailResponse.ok) {
          emailSent = true;
        } else {
          console.error(
            "Erreur Resend :",
            await mailResponse.text()
          );
        }
      } catch (mailError) {
        console.error("Erreur notification :", mailError);
      }
    } else {
      console.warn("Clés e-mail non configurées.");
    }

    // Réponse attendue par l'application.
    return jsonResponse({
      success: true,
      member_number: memberNumber,
      email_sent: emailSent,
      message:
        `Félicitations ! Votre inscription au sein du SAMEL-Guinée a été effectuée avec succès. Votre demande d'adhésion a bien été enregistrée. Votre numéro de membre est : ${memberNumber}. Nous vous remercions pour votre confiance et vous souhaitons la bienvenue au sein de notre organisation. SAMEL-GUINÉE — Travail • Compétence • Solidarité — ON EST LÀ, POUR NOS DROITS ON SE BAT !`,
    });

  } catch (error) {
    console.error("Erreur submit-member :", error);

    // Nettoyage du selfie uniquement si l'inscription n'a pas abouti.
    if (uploadedPath && !memberInserted) {
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
    }, 500);
  }
});
