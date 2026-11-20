
/* SAMEL-GUINEE — app.js complet
   Connexion Supabase, inscriptions, administration,
   gestion des membres et exports PDF. */

const SUPABASE_URL = "https://muzxcqrcalvmjzhjyeat.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_F8OJKc0ZCtnXxEKRnkFMfA_5Ep8naL0";

const configured = !!window.supabase &&
  SUPABASE_URL.startsWith("https://") &&
  !SUPABASE_PUBLISHABLE_KEY.includes("COLLER_ICI");

const client = configured ? window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
) : null;

const $ = id => document.getElementById(id);

let cameraStream = null;
let selfieBlob = null;
let currentMembers = [];
let currentAdminRole = null;

function status(id, message) {
  const el = $(id);
  if (el) el.textContent = message || "";
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("fr-FR", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }

  if ($("camera-video")) {
    $("camera-video").pause();
    $("camera-video").srcObject = null;
  }
}

function resetSelfie() {
  selfieBlob = null;
  const preview = $("selfie-preview");

  if (preview) {
    if (preview.src?.startsWith("blob:")) {
      URL.revokeObjectURL(preview.src);
    }
    preview.removeAttribute("src");
    preview.hidden = true;
  }

  if ($("camera-video")) $("camera-video").hidden = true;
  if ($("start-camera")) $("start-camera").hidden = false;
  if ($("take-selfie")) $("take-selfie").hidden = true;
  if ($("retake-selfie")) $("retake-selfie").hidden = true;

  stopCamera();
}

/* CAMERA ET SELFIE */

if ($("start-camera")) {
  $("start-camera").addEventListener("click", async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Caméra non prise en charge.");
      }

      stopCamera();

      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false
      });

      const video = $("camera-video");
      video.srcObject = cameraStream;
      video.hidden = false;

      if ($("selfie-preview")) $("selfie-preview").hidden = true;

      $("start-camera").hidden = true;
      $("take-selfie").hidden = false;
      $("retake-selfie").hidden = true;

      await video.play();

      status("form-status", "Caméra ouverte. Cadrez votre visage puis prenez le selfie.");

    } catch (err) {
      console.error("Caméra :", err);
      status("form-status", "Impossible d'ouvrir la caméra. Autorisez son accès puis réessayez.");
    }
  });
}

if ($("take-selfie")) {
  $("take-selfie").addEventListener("click", () => {
    const video = $("camera-video");
    const canvas = $("camera-canvas");

    if (!video?.videoWidth || !canvas) {
      status("form-status", "La caméra n'est pas encore prête. Patientez quelques secondes.");
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    canvas.getContext("2d").drawImage(
      video, 0, 0, canvas.width, canvas.height
    );

    canvas.toBlob(blob => {
      if (!blob) {
        status("form-status", "La capture du selfie a échoué. Réessayez.");
        return;
      }

      selfieBlob = blob;
      $("selfie-preview").src = URL.createObjectURL(blob);
      $("selfie-preview").hidden = false;

      video.hidden = true;
      stopCamera();

      $("take-selfie").hidden = true;
      $("retake-selfie").hidden = false;

      status("form-status", "Selfie capturé. Vous pouvez envoyer votre inscription.");

    }, "image/jpeg", 0.88);
  });
}

if ($("retake-selfie")) {
  $("retake-selfie").addEventListener("click", () => {
    resetSelfie();
    status("form-status", "Reprenez votre selfie avec la caméra.");
  });
}

/* INSCRIPTION PUBLIQUE DES MEMBRES */

if (!configured) {
  status(
    "form-status",
    "Configuration Supabase incomplète : vérifiez la clé Publishable dans app.js."
  );
}

if ($("member-form")) {
  $("member-form").addEventListener("submit", async event => {
    event.preventDefault();

    if (!client) {
      status("form-status", "Le site n'est pas connecté à Supabase. Vérifiez la clé Publishable.");
      return;
    }

    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"],button:not([type])');

    if (!selfieBlob) {
      status("form-status", "Veuillez prendre votre selfie avant d'envoyer votre inscription.");
      return;
    }

    if (selfieBlob.size > 5 * 1024 * 1024) {
      status("form-status", "La photo ne doit pas dépasser 5 Mo.");
      return;
    }

    const fd = new FormData(form);
    fd.delete("numero_existant");
    fd.append("selfie", selfieBlob, "selfie.jpg");

    if (button) button.disabled = true;

    status("form-status", "Envoi de votre inscription en cours…");

    try {
      const { data, error } = await client.functions.invoke(
        "submit-member",
        { body: fd }
      );

      if (error) {
        console.error("Erreur inscription :", error);
        let message = error.message || "Erreur lors de l'envoi.";

        try {
          const body = await error.context?.json?.();
          if (body?.error) message = body.error;
          else if (body?.message) message = body.message;
        } catch (_) {}

        throw new Error(message);
      }

      if (!data?.member_number) {
        throw new Error("Le serveur n'a pas retourné le numéro de membre.");
      }

      status(
        "form-status",
        `Inscription envoyée avec succès ! Votre numéro de membre est : ${data.member_number}.`
      );

      form.reset();
      resetSelfie();

    } catch (err) {
      console.error("Échec inscription :", err);
      status("form-status", `Échec de l'inscription : ${err.message}`);

    } finally {
      if (button) button.disabled = false;
    }
  });
}

/* PROFIL ADMINISTRATEUR */

async function getAdminProfile(userId) {
  const first = await client
    .from("profiles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (!first.error && first.data?.role) {
    return { role: first.data.role, source: "profiles" };
  }

  console.warn("Lecture profiles :", first.error || "Profil absent");

  const second = await client
    .from("admin_profiles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (!second.error && second.data?.role) {
    return { role: second.data.role, source: "admin_profiles" };
  }

  console.error("Lecture admin_profiles :", second.error || "Profil absent");

  throw new Error(
    second.error?.message ||
    first.error?.message ||
    "Aucun profil administrateur associé à ce compte."
  );
}

/* CONNEXION ADMINISTRATEUR */

if ($("login-form")) {
  $("login-form").addEventListener("submit", async event => {
    event.preventDefault();

    if (!client) {
      status("admin-status", "Configuration Supabase incomplète. Vérifiez la clé Publishable.");
      return;
    }

    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"],button:not([type])');

    if (button) button.disabled = true;

    status("admin-status", "Vérification de vos identifiants…");

    try {
      const { error } = await client.auth.signInWithPassword({
        email: $("login-email").value.trim(),
        password: $("login-password").value
      });

      if (error) throw error;
      await loadAdmin();

    } catch (err) {
      console.error("Erreur connexion :", err);
      status(
        "admin-status",
        `Connexion impossible : ${err.message || "Vérifiez l'e-mail et le mot de passe."}`
      );

    } finally {
      if (button) button.disabled = false;
    }
  });
}

/* CHARGEMENT DU TABLEAU DE BORD */

async function loadAdmin() {
  if (!client) return;

  try {
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError) throw userError;

    const user = userData?.user;

    if (!user) {
      if ($("admin-panel")) $("admin-panel").hidden = true;
      if ($("login-form")) $("login-form").hidden = false;
      status("admin-status", "Veuillez vous connecter.");
      return;
    }

    let profile;

    try {
      profile = await getAdminProfile(user.id);
    } catch (err) {
      console.error("Profil administrateur :", err);
      status("admin-status", `Compte connecté, mais profil inaccessible : ${err.message}`);
      await client.auth.signOut();
      return;
    }

    currentAdminRole = profile.role;

    if (!["super_admin", "admin"].includes(profile.role)) {
      status("admin-status", "Ce compte ne possède pas un rôle administrateur autorisé.");
      await client.auth.signOut();
      return;
    }

    if ($("login-form")) $("login-form").hidden = true;
    if ($("admin-panel")) $("admin-panel").hidden = false;

    if ($("role")) {
      $("role").textContent =
        `Connecté : ${user.email} — rôle : ${
          profile.role === "super_admin"
            ? "Super Administrateur"
            : "Administrateur"
        }`;
    }

    if ($("admin-create")) {
      $("admin-create").hidden = profile.role !== "super_admin";
    }

    ensureMemberManagementUI();

    status("admin-status", "Connexion réussie. Chargement des membres…");
    await loadMembers();
    status("admin-status", "");

  } catch (err) {
    console.error("Erreur tableau de bord :", err);
    status("admin-status", `Impossible de charger le tableau de bord : ${err.message}`);
  }
}

/* LISTE DES MEMBRES */

async function loadMembers() {
  const box = $("members");
  if (!box || !client) return;

  box.textContent = "Chargement des membres…";

  const { data, error } = await client
    .from("members")
    .select(
      "id,member_number,nom,prenom,sexe,telephone,numero_pdv,region,ville,commune,emplacement,poste_occupe,created_at,selfie_path"
    )
    .order("member_number", { ascending: true });

  if (error) {
    console.error("Chargement membres :", error);
    box.textContent = `Impossible de charger les membres : ${error.message}`;
    return;
  }

  currentMembers = data || [];
  renderMembers();
}

/* INTERFACE DE GESTION DES MEMBRES */

function ensureMemberManagementUI() {
  const panel = $("admin-panel");
  if (!panel || $("member-management")) return;

  const section = document.createElement("section");
  section.id = "member-management";
  section.style.cssText =
    "margin:18px 0;padding:16px;border:1px solid #dce8df;border-radius:14px;background:#fff";

  section.innerHTML = `
    <h3 style="color:#087b46">Gestion des membres</h3>

    <button type="button" id="show-add-member"
      style="background:#087b46;color:white;padding:12px 18px;border:0;border-radius:8px">
      + Ajouter un membre
    </button>

    <button type="button" id="export-members-pdf"
      style="background:#174b32;color:white;padding:12px 18px;border:0;border-radius:8px;margin:8px 0">
      Télécharger la liste complète en PDF
    </button>

    <form id="manual-member-form" hidden style="margin-top:16px;display:grid;gap:10px">
      <h4 id="manual-form-title">Ajouter un membre (sans selfie)</h4>
      <input type="hidden" name="id">

      <label>Numéro de membre (anciens membres : 1 à 21)
        <input name="member_number" type="number" min="1" max="21" step="1"
          placeholder="Laisser vide pour attribution automatique à partir de 22">
      </label>

      <small>
        Pour intégrer un ancien membre, saisissez son numéro entre 1 et 21.
        Pour un nouveau membre, laissez ce champ vide.
      </small>

      <label>Nom *
        <input name="nom" required maxlength="100">
      </label>

      <label>Prénom *
        <input name="prenom" required maxlength="100">
      </label>

      <label>Sexe *
        <select name="sexe" required>
          <option value="">Choisir</option>
          <option>Féminin</option>
          <option>Masculin</option>
        </select>
      </label>

      <label>Téléphone *
        <input name="telephone" type="tel" required>
      </label>

      <label>Numéro PDV *
        <input name="numero_pdv" required>
      </label>

      <label>Région <input name="region"></label>
      <label>Ville <input name="ville"></label>
      <label>Commune <input name="commune"></label>
      <label>Emplacement <input name="emplacement"></label>
      <label>Poste occupé <input name="poste_occupe"></label>

      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="submit" id="save-manual-member">Enregistrer</button>
        <button type="button" id="cancel-manual-member">Annuler</button>
      </div>

      <p id="manual-member-status" role="status"></p>
    </form>
  `;

  const adminCreate = $("admin-create");

  if (adminCreate?.parentNode) {
    adminCreate.parentNode.insertBefore(section, adminCreate.nextSibling);
  } else {
    panel.insertBefore(section, panel.firstChild);
  }

  $("export-members-pdf").addEventListener("click", exportAllMembersPDF);

  $("show-add-member").addEventListener("click", () => {
    openManualMemberForm(null);
  });

  $("cancel-manual-member").addEventListener("click", () => {
    $("manual-member-form").hidden = true;
    $("manual-member-form").reset();
    $("manual-member-form").elements.member_number.disabled = false;
    status("manual-member-status", "");
  });

  $("manual-member-form").addEventListener("submit", saveManualMember);
}

function openManualMemberForm(member) {
  const form = $("manual-member-form");
  if (!form) return;

  form.reset();
  form.elements.id.value = member?.id || "";

  [
    "nom", "prenom", "sexe", "telephone", "numero_pdv",
    "region", "ville", "commune", "emplacement", "poste_occupe"
  ].forEach(key => {
    form.elements[key].value = member?.[key] ?? "";
  });

  form.elements.member_number.value = member?.member_number ?? "";
  form.elements.member_number.disabled = !!member;

  $("manual-form-title").textContent = member
    ? `Modifier le membre N° ${member.member_number}`
    : "Ajouter un membre (sans selfie)";

  $("save-manual-member").textContent = member
    ? "Enregistrer les modifications"
    : "Enregistrer le membre";

  form.hidden = false;
  status("manual-member-status", "");

  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

/* APPEL DE LA FONCTION DE GESTION */

async function invokeMemberManagement(body) {
  const { data: sessionData, error: sessionError } =
    await client.auth.getSession();

  if (sessionError) throw sessionError;

  const session = sessionData?.session;
  if (!session) throw new Error("Session administrateur expirée. Reconnectez-vous.");

  const { data, error } = await client.functions.invoke(
    "admin-manage-member",
    {
      body,
      headers: {
        Authorization: `Bearer ${session.access_token}`
      }
    }
  );

  if (error) {
    let message = error.message || "Erreur de la fonction.";

    try {
      const bodyError = await error.context?.json?.();
      if (bodyError?.error) message = bodyError.error;
    } catch (_) {}

    throw new Error(message);
  }

  if (data?.error) throw new Error(data.error);
  return data;
}

/* AJOUT ET MODIFICATION */

async function saveManualMember(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const button = $("save-manual-member");
  button.disabled = true;

  status("manual-member-status", "Enregistrement en cours…");

  try {
    const values = Object.fromEntries(new FormData(form).entries());
    const action = values.id ? "update" : "add";

    const result = await invokeMemberManagement({
      ...values,
      action
    });

    alert(result?.message || "Opération réussie.");

    form.reset();
    form.hidden = true;
    form.elements.member_number.disabled = false;

    await loadMembers();

  } catch (err) {
    console.error("Gestion membre :", err);
    status("manual-member-status", `Erreur : ${err.message}`);

  } finally {
    button.disabled = false;
  }
}

/* SUPPRESSION */

async function deleteMember(id) {
  const member = currentMembers.find(m => String(m.id) === String(id));

  if (!member) {
    alert("Membre introuvable.");
    return;
  }

  const label =
    `N° ${member.member_number} — ${member.nom || ""} ${member.prenom || ""}`;

  if (!confirm(
    `Confirmer la suppression définitive de ${label} ? Cette action ne peut pas être annulée.`
  )) return;

  try {
    const result = await invokeMemberManagement({ action: "delete", id });
    alert(result?.message || "Membre supprimé.");
    await loadMembers();

  } catch (err) {
    console.error("Suppression membre :", err);
    alert(`Suppression impossible : ${err.message}`);
  }
}

/* AFFICHAGE DU TABLEAU DES MEMBRES */

function renderMembers() {
  const box = $("members");
  if (!box) return;

  const q = ($("search")?.value || "").trim().toLocaleLowerCase("fr");

  const rows = currentMembers.filter(m => [
    m.member_number, m.nom, m.prenom, m.sexe, m.telephone,
    m.numero_pdv, m.region, m.ville, m.commune,
    m.emplacement, m.poste_occupe
  ].join(" ").toLocaleLowerCase("fr").includes(q));

  if (!rows.length) {
    box.textContent = currentMembers.length
      ? "Aucun membre ne correspond à votre recherche."
      : "Aucun membre enregistré pour le moment.";
    return;
  }

  const canManage = ["admin", "super_admin"].includes(currentAdminRole);

  box.innerHTML = `
    <p><strong>Nombre de membres affichés : ${rows.length}</strong></p>
    <div style="overflow-x:auto">
      <table>
        <thead>
          <tr>
            <th>N° membre</th><th>Nom et prénom</th><th>Sexe</th>
            <th>Téléphone</th><th>N° PDV</th>
            <th>Région / Ville / Commune</th><th>Emplacement</th>
            <th>Poste</th><th>Date d'inscription</th><th>Selfie</th>
            ${canManage ? "<th>Actions</th>" : ""}
          </tr>
        </thead>
        <tbody>
          ${rows.map(m => `
            <tr>
              <td>${escapeHTML(m.member_number)}</td>
              <td>${escapeHTML(m.nom)} ${escapeHTML(m.prenom)}</td>
              <td>${escapeHTML(m.sexe)}</td>
              <td>${escapeHTML(m.telephone)}</td>
              <td>${escapeHTML(m.numero_pdv)}</td>
              <td>${escapeHTML([m.region, m.ville, m.commune].filter(Boolean).join(" / "))}</td>
              <td>${escapeHTML(m.emplacement)}</td>
              <td>${escapeHTML(m.poste_occupe)}</td>
              <td>${escapeHTML(formatDate(m.created_at))}</td>
              <td>
                ${
                  m.selfie_path
                    ? `<button type="button" data-photo="${escapeHTML(m.id)}">Voir le selfie</button>`
                    : "Non disponible"
                }
              </td>
              ${
                canManage
                  ? `<td style="white-space:nowrap">
                       <button type="button" data-pdf="${escapeHTML(m.id)}">Dossier PDF</button>
                       <button type="button" data-edit="${escapeHTML(m.id)}">Modifier</button>
                       <button type="button" data-delete="${escapeHTML(m.id)}">Supprimer</button>
                     </td>`
                  : ""
              }
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  box.querySelectorAll("[data-photo]").forEach(btn => {
    btn.addEventListener("click", () => openMemberPhoto(btn.dataset.photo));
  });

  box.querySelectorAll("[data-pdf]").forEach(btn => {
    btn.addEventListener("click", () => exportIndividualMemberPDF(btn.dataset.pdf));
  });

  box.querySelectorAll("[data-edit]").forEach(btn => {
    btn.addEventListener("click", () => {
      const member = currentMembers.find(m => String(m.id) === btn.dataset.edit);
      openManualMemberForm(member);
    });
  });

  box.querySelectorAll("[data-delete]").forEach(btn => {
    btn.addEventListener("click", () => deleteMember(btn.dataset.delete));
  });
}

/* EXPORT PDF DES MEMBRES — ADMINISTRATEURS UNIQUEMENT */

function pdfField(label, value) {
  return `<tr><th>${escapeHTML(label)}</th><td>${escapeHTML(value || "Non renseigné")}</td></tr>`;
}

function pdfHeader() {
  return `
    <header>
      <img src="${location.origin}/logo.jpg" alt="Logo SAMEL-Guinée"
        onerror="this.style.display='none'">
      <h1>SAMEL-GUINÉE</h1>
      <p>Syndicat des Acteurs de la Monnaie Électronique de Guinée</p>
      <p><strong>Travail • Compétence • Solidarité</strong></p>
    </header>
  `;
}

function printDocument(title, body, orientation = "portrait") {
  const win = window.open("", "_blank");

  if (!win) {
    alert("Autorisez les fenêtres pop-up dans votre navigateur pour créer le PDF.");
    return;
  }

  win.document.open();
  win.document.write(`<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHTML(title)}</title>
<style>
@page{size:A4 ${orientation};margin:12mm}
*{box-sizing:border-box}
body{font-family:Arial,sans-serif;color:#222;font-size:10px}
header{text-align:center;border-bottom:3px solid #087b46;padding-bottom:10px;margin-bottom:14px}
header img{max-height:55px;max-width:140px;object-fit:contain}
h1{color:#087b46;font-size:19px;margin:7px 0 3px}
h2{font-size:14px;margin:12px 0 8px;color:#087b46}
p{margin:4px 0}
table{width:100%;border-collapse:collapse;margin-top:8px}
th,td{border:1px solid #aaa;padding:5px;text-align:left;vertical-align:top}
th{background:#eaf4ed}
.member-photo{display:block;max-width:135px;max-height:135px;object-fit:cover;margin:10px auto;border:1px solid #ccc}
.count{font-weight:bold;margin:9px 0}
.footer{margin-top:18px;border-top:1px solid #aaa;padding-top:7px;text-align:center;font-size:8px}
tr{page-break-inside:avoid}
@media screen{body{max-width:1100px;margin:18px auto;padding:18px}}
</style>
</head>
<body>
${body}
<div class="footer">SAMEL-Guinée — Document généré le ${new Date().toLocaleString("fr-FR")}</div>
<script>
window.addEventListener("load",()=>setTimeout(()=>window.print(),1000));
<\/script>
</body>
</html>`);
  win.document.close();
}

async function exportIndividualMemberPDF(id) {
  if (!["admin", "super_admin"].includes(currentAdminRole)) {
    alert("Accès réservé aux administrateurs.");
    return;
  }

  const member = currentMembers.find(m => String(m.id) === String(id));
  if (!member) {
    alert("Membre introuvable.");
    return;
  }

  // Fenêtre ouverte immédiatement pour éviter le blocage des pop-up sur mobile.
  const win = window.open("", "_blank");

  if (!win) {
    alert("Autorisez les fenêtres pop-up dans votre navigateur pour créer le PDF.");
    return;
  }

  win.document.write("<p style='font-family:Arial;padding:20px'>Préparation du dossier membre…</p>");

  try {
    let photoHtml = "";

    if (member.selfie_path) {
      const { data, error } = await client.storage
        .from("member-selfies")
        .createSignedUrl(member.selfie_path, 300);

      if (!error && data?.signedUrl) {
        photoHtml = `<h2>Photo du membre</h2>
          <img class="member-photo" src="${escapeHTML(data.signedUrl)}" alt="Selfie du membre">`;
      }
    }

    const body = `
      ${pdfHeader()}
      <h2>Dossier individuel du membre</h2>
      <p class="count">Numéro de membre : ${escapeHTML(member.member_number)}</p>
      ${photoHtml}
      <table>
        ${pdfField("Numéro de membre", member.member_number)}
        ${pdfField("Nom", member.nom)}
        ${pdfField("Prénom", member.prenom)}
        ${pdfField("Sexe", member.sexe)}
        ${pdfField("Téléphone", member.telephone)}
        ${pdfField("Numéro PDV", member.numero_pdv)}
        ${pdfField("Région", member.region)}
        ${pdfField("Ville", member.ville)}
        ${pdfField("Commune", member.commune)}
        ${pdfField("Emplacement", member.emplacement)}
        ${pdfField("Poste occupé", member.poste_occupe)}
        ${pdfField("Date d'inscription", formatDate(member.created_at))}
      </table>
    `;

    const doc = win.document;
    doc.open();
    doc.write(`<!doctype html><html lang="fr"><head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Dossier membre ${escapeHTML(member.member_number)}</title>
      <style>
      @page{size:A4 portrait;margin:14mm}
      *{box-sizing:border-box}
      body{font-family:Arial,sans-serif;color:#222;font-size:12px}
      header{text-align:center;border-bottom:3px solid #087b46;padding-bottom:12px;margin-bottom:18px}
      header img{max-height:60px;max-width:145px}
      h1{color:#087b46;font-size:20px;margin:8px 0 4px}
      h2{font-size:15px;color:#087b46;margin:18px 0 8px}
      table{width:100%;border-collapse:collapse}
      th,td{border:1px solid #bbb;padding:8px;text-align:left}
      th{width:35%;background:#eaf4ed}
      .member-photo{display:block;max-width:150px;max-height:150px;object-fit:cover;margin:12px auto}
      .footer{margin-top:22px;border-top:1px solid #aaa;padding-top:8px;text-align:center;font-size:9px}
      </style></head><body>
      ${body}
      <div class="footer">Document généré le ${new Date().toLocaleString("fr-FR")}</div>
      <script>window.addEventListener("load",()=>setTimeout(()=>window.print(),1200));<\/script>
      </body></html>`);
    doc.close();

  } catch (err) {
    console.error("Export dossier membre :", err);
    win.close();
    alert(`Impossible de préparer le dossier PDF : ${err.message}`);
  }
}

function exportAllMembersPDF() {
  if (!["admin", "super_admin"].includes(currentAdminRole)) {
    alert("Accès réservé aux administrateurs.");
    return;
  }

  if (!currentMembers.length) {
    alert("Aucun membre à exporter.");
    return;
  }

  const sorted = [...currentMembers].sort(
    (a, b) => Number(a.member_number) - Number(b.member_number)
  );

  const tableRows = sorted.map(m => `
    <tr>
      <td>${escapeHTML(m.member_number)}</td>
      <td>${escapeHTML(`${m.nom || ""} ${m.prenom || ""}`.trim())}</td>
      <td>${escapeHTML(m.sexe)}</td>
      <td>${escapeHTML(m.telephone)}</td>
      <td>${escapeHTML(m.numero_pdv)}</td>
      <td>${escapeHTML([m.region, m.ville, m.commune].filter(Boolean).join(" / "))}</td>
      <td>${escapeHTML(m.emplacement)}</td>
      <td>${escapeHTML(m.poste_occupe)}</td>
      <td>${escapeHTML(formatDate(m.created_at))}</td>
    </tr>
  `).join("");

  const body = `
    ${pdfHeader()}
    <h2>Liste générale des membres</h2>
    <p class="count">Effectif total : ${sorted.length} membre(s)</p>
    <table>
      <thead>
        <tr>
          <th>N°</th><th>Nom et prénom</th><th>Sexe</th>
          <th>Téléphone</th><th>N° PDV</th>
          <th>Région / Ville / Commune</th><th>Emplacement</th>
          <th>Poste</th><th>Date d'inscription</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
  `;

  printDocument(
    "Liste générale des membres — SAMEL-Guinée",
    body,
    "landscape"
  );
}

/* OUVERTURE SECURISEE DU SELFIE */

async function openMemberPhoto(id) {
  const member = currentMembers.find(m => String(m.id) === String(id));

  if (!member?.selfie_path) {
    alert("Aucun selfie disponible pour ce membre.");
    return;
  }

  try {
    const { data, error } = await client.storage
      .from("member-selfies")
      .createSignedUrl(member.selfie_path, 120);

    if (error) throw error;

    if (!data?.signedUrl) {
      throw new Error("Lien sécurisé de la photo indisponible.");
    }

    window.open(data.signedUrl, "_blank", "noopener,noreferrer");

  } catch (err) {
    console.error("Erreur selfie :", err);
    alert(`Impossible d'afficher le selfie : ${err.message}`);
  }
}

/* RECHERCHE ET ACTUALISATION */

if ($("refresh")) {
  $("refresh").addEventListener("click", loadMembers);
}

if ($("search")) {
  $("search").addEventListener("input", renderMembers);
}

/* CREATION D'UN ADMINISTRATEUR — SUPER ADMIN UNIQUEMENT */

if ($("create-admin")) {
  $("create-admin").addEventListener("submit", async event => {
    event.preventDefault();

    if (!client || currentAdminRole !== "super_admin") {
      status(
        "admin-status",
        "Seul le Super Administrateur peut créer un administrateur."
      );
      return;
    }

    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"],button:not([type])');

    try {
      const { data: sessionData, error: sessionError } =
        await client.auth.getSession();

      if (sessionError) throw sessionError;

      const session = sessionData?.session;
      if (!session) throw new Error("Session administrateur introuvable.");

      if (button) button.disabled = true;

      status("admin-status", "Création du compte administrateur en cours…");

      const formData = Object.fromEntries(new FormData(form).entries());

      const { error } = await client.functions.invoke(
        "admin-create-user",
        {
          body: formData,
          headers: {
            Authorization: `Bearer ${session.access_token}`
          }
        }
      );

      if (error) throw error;

      status("admin-status", "Compte administrateur créé avec succès.");
      form.reset();

    } catch (err) {
      console.error("Création administrateur :", err);
      status("admin-status", `Création impossible : ${err.message}`);

    } finally {
      if (button) button.disabled = false;
    }
  });
}

/* DECONNEXION */

if ($("logout")) {
  $("logout").addEventListener("click", async () => {
    try {
      const { error } = await client.auth.signOut();
      if (error) throw error;

      currentAdminRole = null;
      currentMembers = [];

      if ($("admin-panel")) $("admin-panel").hidden = true;
      if ($("login-form")) $("login-form").hidden = false;
      if ($("login-password")) $("login-password").value = "";
      if ($("members")) $("members").innerHTML = "";

      if ($("member-management")) {
        $("member-management").remove();
      }

      status("admin-status", "Vous êtes déconnecté.");

    } catch (err) {
      console.error("Déconnexion :", err);
      status("admin-status", `Erreur de déconnexion : ${err.message}`);
    }
  });
}

/* RESTAURATION AUTOMATIQUE DE LA SESSION */

async function restoreAdminSession() {
  if (!client) return;

  try {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;

    if (data?.session) {
      await loadAdmin();
    }

  } catch (err) {
    console.warn("Restauration session :", err);
  }
}

if (client) {
  restoreAdminSession();
}
