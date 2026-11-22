

/* SAMEL-GUINEE — app.js complet
   Remplacer la clé ci-dessous par la clé Publishable du projet Supabase.
   Ne jamais utiliser ici une clé service_role, secret ou Resend. */

const SUPABASE_URL = "https://muzxcqrcalvmjzhjyeat.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_F8OJKc0ZCtnXxEKRnkFMfA_5Ep8naL0";

const configured = !!window.supabase &&
  SUPABASE_URL.startsWith("https://") &&
  !SUPABASE_PUBLISHABLE_KEY.includes("COLLER_ICI");

const client = configured ? window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
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

      if ($("selfie-preview")) {
        $("selfie-preview").hidden = true;
      }

      $("start-camera").hidden = true;
      $("take-selfie").hidden = false;
      $("retake-selfie").hidden = true;

      await video.play();

      status(
        "form-status",
        "Caméra ouverte. Cadrez votre visage puis prenez le selfie."
      );

    } catch (err) {
      console.error("Caméra :", err);

      status(
        "form-status",
        "Impossible d'ouvrir la caméra. Autorisez son accès puis réessayez."
      );
    }
  });
}

if ($("take-selfie")) {
  $("take-selfie").addEventListener("click", () => {
    const video = $("camera-video");
    const canvas = $("camera-canvas");

    if (!video?.videoWidth || !canvas) {
      status(
        "form-status",
        "La caméra n'est pas encore prête. Patientez quelques secondes."
      );
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    canvas.getContext("2d").drawImage(
      video,
      0,
      0,
      canvas.width,
      canvas.height
    );

    canvas.toBlob(blob => {
      if (!blob) {
        status(
          "form-status",
          "La capture du selfie a échoué. Réessayez."
        );
        return;
      }

      selfieBlob = blob;

      $("selfie-preview").src = URL.createObjectURL(blob);
      $("selfie-preview").hidden = false;

      video.hidden = true;
      stopCamera();

      $("take-selfie").hidden = true;
      $("retake-selfie").hidden = false;

      status(
        "form-status",
        "Selfie capturé. Vous pouvez envoyer votre inscription."
      );

    }, "image/jpeg", 0.88);
  });
}

if ($("retake-selfie")) {
  $("retake-selfie").addEventListener("click", () => {
    resetSelfie();

    status(
      "form-status",
      "Reprenez votre selfie avec la caméra."
    );
  });
}

/* INSCRIPTION DES MEMBRES */

if (!configured) {
  status(
    "form-status",
    "Configuration Supabase incomplète : ajoutez la clé Publishable dans app.js."
  );
}

if ($("member-form")) {
  $("member-form").addEventListener("submit", async event => {
    event.preventDefault();

    if (!client) {
      status(
        "form-status",
        "Le site n'est pas connecté à Supabase. Vérifiez la clé Publishable."
      );
      return;
    }

    const form = event.currentTarget;

    const button = form.querySelector(
      'button[type="submit"],button:not([type])'
    );

    if (!selfieBlob) {
      status(
        "form-status",
        "Veuillez prendre votre selfie avant d'envoyer votre inscription."
      );
      return;
    }

    if (selfieBlob.size > 5 * 1024 * 1024) {
      status(
        "form-status",
        "La photo ne doit pas dépasser 5 Mo."
      );
      return;
    }

    const fd = new FormData(form);

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
        throw new Error(
          "Le serveur n'a pas retourné le numéro de membre."
        );
      }

      status(
        "form-status",
        `Inscription envoyée avec succès ! Votre numéro de membre est : ${data.member_number}.`
      );

      form.reset();
      resetSelfie();

    } catch (err) {
      console.error("Échec inscription :", err);

      status(
        "form-status",
        `Échec de l'inscription : ${err.message}`
      );

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
    return {
      role: first.data.role,
      source: "profiles"
    };
  }

  console.warn(
    "Lecture profiles :",
    first.error || "Profil absent"
  );

  const second = await client
    .from("admin_profiles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (!second.error && second.data?.role) {
    return {
      role: second.data.role,
      source: "admin_profiles"
    };
  }

  console.error(
    "Lecture admin_profiles :",
    second.error || "Profil absent"
  );

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
      status(
        "admin-status",
        "Configuration Supabase incomplète. Vérifiez la clé Publishable."
      );
      return;
    }

    const form = event.currentTarget;

    const button = form.querySelector(
      'button[type="submit"],button:not([type])'
    );

    if (button) button.disabled = true;

    status(
      "admin-status",
      "Vérification de vos identifiants…"
    );

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
    const {
      data: userData,
      error: userError
    } = await client.auth.getUser();

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

      status(
        "admin-status",
        `Compte connecté, mais profil inaccessible : ${err.message}`
      );

      await client.auth.signOut();
      return;
    }

    currentAdminRole = profile.role;

    if (!["super_admin", "admin"].includes(profile.role)) {
      status(
        "admin-status",
        "Ce compte ne possède pas un rôle administrateur autorisé."
      );

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

    status(
      "admin-status",
      "Connexion réussie. Chargement des membres…"
    );

    await loadMembers();

    status("admin-status", "");

  } catch (err) {
    console.error("Erreur tableau de bord :", err);

    status(
      "admin-status",
      `Impossible de charger le tableau de bord : ${err.message}`
    );
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

    box.textContent =
      `Impossible de charger les membres : ${error.message}`;

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

    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button type="button" id="show-add-member"
        style="background:#087b46;color:white;padding:12px 18px;border:0;border-radius:8px">
        + Ajouter un membre
      </button>

      <button type="button" id="export-all-members-pdf"
        style="background:#1d4ed8;color:white;padding:12px 18px;border:0;border-radius:8px">
        Télécharger la liste complète en PDF
      </button>
    </div>

    <form id="manual-member-form" hidden
      style="margin-top:16px;display:grid;gap:10px">

      <h4 id="manual-form-title">Ajouter un membre (sans selfie)</h4>

      <input type="hidden" name="id">

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

      <label>Région
        <input name="region">
      </label>

      <label>Ville
        <input name="ville">
      </label>

      <label>Commune
        <input name="commune">
      </label>

      <label>Emplacement
        <input name="emplacement">
      </label>

      <label>Poste occupé
        <input name="poste_occupe">
      </label>

      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="submit" id="save-manual-member">
          Enregistrer
        </button>

        <button type="button" id="cancel-manual-member">
          Annuler
        </button>
      </div>

      <p id="manual-member-status" role="status"></p>
    </form>
  `;

  const adminCreate = $("admin-create");

  if (adminCreate?.parentNode) {
    adminCreate.parentNode.insertBefore(
      section,
      adminCreate.nextSibling
    );
  } else {
    panel.insertBefore(section, panel.firstChild);
  }

  $("show-add-member").addEventListener("click", () => {
    openManualMemberForm(null);
  });

  $("export-all-members-pdf").addEventListener(
    "click",
    exportAllMembersPDF
  );

  $("cancel-manual-member").addEventListener("click", () => {
    $("manual-member-form").hidden = true;
    $("manual-member-form").reset();

    status("manual-member-status", "");
  });

  $("manual-member-form").addEventListener(
    "submit",
    saveManualMember
  );
}

function openManualMemberForm(member) {
  const form = $("manual-member-form");

  if (!form) return;

  form.reset();

  form.elements.id.value = member?.id || "";

  [
    "nom",
    "prenom",
    "sexe",
    "telephone",
    "numero_pdv",
    "region",
    "ville",
    "commune",
    "emplacement",
    "poste_occupe"
  ].forEach(k => {
    form.elements[k].value = member?.[k] ?? "";
  });

  $("manual-form-title").textContent = member
    ? `Modifier le membre N° ${member.member_number}`
    : "Ajouter un membre (sans selfie)";

  $("save-manual-member").textContent = member
    ? "Enregistrer les modifications"
    : "Enregistrer le membre";

  form.hidden = false;

  status("manual-member-status", "");

  form.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });
}

/* APPEL DE LA FONCTION DE GESTION */

async function invokeMemberManagement(body) {
  const {
    data: sessionData,
    error: sessionError
  } = await client.auth.getSession();

  if (sessionError) throw sessionError;

  const session = sessionData?.session;

  if (!session) {
    throw new Error(
      "Session administrateur expirée. Reconnectez-vous."
    );
  }

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

      if (bodyError?.error) {
        message = bodyError.error;
      }
    } catch (_) {}

    throw new Error(message);
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data;
}

/* AJOUT ET MODIFICATION */

async function saveManualMember(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const button = $("save-manual-member");

  button.disabled = true;

  status(
    "manual-member-status",
    "Enregistrement en cours…"
  );

  try {
    const values = Object.fromEntries(
      new FormData(form).entries()
    );

    const action = values.id ? "update" : "add";

    const result = await invokeMemberManagement({
      ...values,
      action
    });

    alert(result?.message || "Opération réussie.");

    form.reset();
    form.hidden = true;

    await loadMembers();

  } catch (err) {
    console.error("Gestion membre :", err);

    status(
      "manual-member-status",
      `Erreur : ${err.message}`
    );

  } finally {
    button.disabled = false;
  }
}

/* SUPPRESSION D'UN MEMBRE */

async function deleteMember(id) {
  const member = currentMembers.find(
    m => String(m.id) === String(id)
  );

  if (!member) {
    return alert("Membre introuvable.");
  }

  const label =
    `N° ${member.member_number} — ${member.nom || ""} ${member.prenom || ""}`;

  if (!confirm(
    `Confirmer la suppression définitive de ${label} ? Cette action ne peut pas être annulée.`
  )) {
    return;
  }

  try {
    const result = await invokeMemberManagement({
      action: "delete",
      id
    });

    alert(result?.message || "Membre supprimé.");

    await loadMembers();

  } catch (err) {
    console.error("Suppression membre :", err);

    alert(
      `Suppression impossible : ${err.message}`
    );
  }
}

/* AFFICHAGE DU TABLEAU DES MEMBRES */

function renderMembers() {
  const box = $("members");

  if (!box) return;

  const q = ($("search")?.value || "")
    .trim()
    .toLocaleLowerCase("fr");

  const rows = currentMembers.filter(m => [
    m.member_number,
    m.nom,
    m.prenom,
    m.sexe,
    m.telephone,
    m.numero_pdv,
    m.region,
    m.ville,
    m.commune,
    m.emplacement,
    m.poste_occupe
  ].join(" ").toLocaleLowerCase("fr").includes(q));

  if (!rows.length) {
    box.textContent = currentMembers.length
      ? "Aucun membre ne correspond à votre recherche."
      : "Aucun membre enregistré pour le moment.";

    return;
  }

  const canManage = [
    "admin",
    "super_admin"
  ].includes(currentAdminRole);

  box.innerHTML = `
    <p>
      <strong>Nombre de membres affichés : ${rows.length}</strong>
    </p>

    <div style="overflow-x:auto">
      <table>
        <thead>
          <tr>
            <th>N° membre</th>
            <th>Nom et prénom</th>
            <th>Sexe</th>
            <th>Téléphone</th>
            <th>N° PDV</th>
            <th>Région / Ville / Commune</th>
            <th>Emplacement</th>
            <th>Poste</th>
            <th>Date d'inscription</th>
            <th>Selfie</th>
            ${canManage ? "<th>Actions</th>" : ""}
          </tr>
        </thead>

        <tbody>
          ${rows.map(m => `
            <tr>
              <td>${escapeHTML(m.member_number)}</td>

              <td>
                ${escapeHTML(m.nom)}
                ${escapeHTML(m.prenom)}
              </td>

              <td>${escapeHTML(m.sexe)}</td>

              <td>${escapeHTML(m.telephone)}</td>

              <td>${escapeHTML(m.numero_pdv)}</td>

              <td>
                ${escapeHTML(
                  [m.region, 