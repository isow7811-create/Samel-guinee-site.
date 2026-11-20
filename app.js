
/* SAMEL-GUINEE — app.js complet
   Connexion Supabase, inscriptions et administration. */
const SUPABASE_URL = "https://muzxcqrcalvmjzhjyeat.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_F8OJKc0ZCtnXxEKRnkFMfA_5Ep8naL0";

const configured = !!window.supabase &&
  SUPABASE_URL.startsWith("https://") &&
  !SUPABASE_PUBLISHABLE_KEY.includes("COLLER_ICI");

const client = configured ? window.supabase.createClient(
  SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY,
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
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  })[c]);
}

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("fr-FR", {
    dateStyle:"short", timeStyle:"short"
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
    if (preview.src?.startsWith("blob:")) URL.revokeObjectURL(preview.src);
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
if ($("start-camera")) $("start-camera").addEventListener("click", async () => {
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Caméra non prise en charge.");
    stopCamera();
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video:{facingMode:"user"}, audio:false
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

if ($("take-selfie")) $("take-selfie").addEventListener("click", () => {
  const video = $("camera-video"), canvas = $("camera-canvas");
  if (!video?.videoWidth || !canvas) {
    status("form-status", "La caméra n'est pas encore prête. Patientez quelques secondes.");
    return;
  }
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  canvas.toBlob(blob => {
    if (!blob) {
      status("form-status", "La capture de la photo a échoué. Réessayez.");
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

if ($("retake-selfie")) $("retake-selfie").addEventListener("click", () => {
  resetSelfie();
  status("form-status", "Reprenez votre selfie avec la caméra.");
});

/* INSCRIPTION DES MEMBRES */
if (!configured) status(
  "form-status",
  "Configuration Supabase incomplète : ajoutez la clé Publishable dans app.js."
);

if ($("member-form")) $("member-form").addEventListener("submit", async event => {
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
  // Les numéros 1 à 21 sont réservés à l'intégration manuelle.
  // Le serveur attribue automatiquement les nouveaux numéros à partir de 22.
  fd.delete("numero_existant");
  fd.append("selfie", selfieBlob, "selfie.jpg");
  if (button) button.disabled = true;
  status("form-status", "Envoi de votre inscription en cours…");
  try {
    const {data, error} = await client.functions.invoke("submit-member", {body:fd});
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
    if (!data?.member_number) throw new Error("Le serveur n'a pas retourné le numéro de membre.");
    status("form-status", `Inscription envoyée avec succès ! Votre numéro de membre est : ${data.member_number}.`);
    form.reset();
    resetSelfie();
  } catch (err) {
    console.error("Échec inscription :", err);
    status("form-status", `Échec de l'inscription : ${err.message}`);
  } finally {
    if (button) button.disabled = false;
  }
});

/* PROFIL ADMINISTRATEUR */
async function getAdminProfile(userId) {
  const first = await client.from("profiles")
    .select("role").eq("user_id", userId).maybeSingle();

  if (!first.error && first.data?.role) {
    return {role:first.data.role, source:"profiles"};
  }
  console.warn("Lecture profiles :", first.error || "Profil absent");

  const second = await client.from("admin_profiles")
    .select("role").eq("user_id", userId).maybeSingle();

  if (!second.error && second.data?.role) {
    return {role:second.data.role, source:"admin_profiles"};
  }
  console.error("Lecture admin_profiles :", second.error || "Profil absent");
  throw new Error(
    second.error?.message || first.error?.message ||
    "Aucun profil administrateur associé à ce compte."
  );
}

/* CONNEXION */
if ($("login-form")) $("login-form").addEventListener("submit", async event => {
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
    const {error} = await client.auth.signInWithPassword({
      email:$("login-email").value.trim(),
      password:$("login-password").value
    });
    if (error) throw error;
    await loadAdmin();
  } catch (err) {
    console.error("Erreur connexion :", err);
    status("admin-status", `Connexion impossible : ${err.message || "Vérifiez l'e-mail et le mot de passe."}`);
  } finally {
    if (button) button.disabled = false;
  }
});

/* CHARGEMENT DU TABLEAU DE BORD */
async function loadAdmin() {
  if (!client) return;
  try {
    const {data:userData, error:userError} = await client.auth.getUser();
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
    if (!["super_admin","admin"].includes(profile.role)) {
      status("admin-status", "Ce compte ne possède pas un rôle administrateur autorisé.");
      await client.auth.signOut();
      return;
    }

    if ($("login-form")) $("login-form").hidden = true;
    if ($("admin-panel")) $("admin-panel").hidden = false;
    if ($("role")) $("role").textContent =
      `Connecté : ${user.email} — rôle : ${profile.role === "super_admin" ? "Super Administrateur" : "Administrateur"}`;
    if ($("admin-create")) $("admin-create").hidden = profile.role !== "super_admin";

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

  const {data, error} = await client.from("members")
    .select("id,member_number,nom,prenom,sexe,telephone,numero_pdv,region,ville,commune,emplacement,poste_occupe,created_at,selfie_path")
    .order("member_number", {ascending:true});

  if (error) {
    console.error("Chargement membres :", error);
    box.textContent = `Impossible de charger les membres : ${error.message}`;
    return;
  }
  currentMembers = data || [];
  renderMembers();
}

function renderMembers() {
  const box = $("members");
  if (!box) return;
  const q = ($("search")?.value || "").trim().toLocaleLowerCase("fr");
  const rows = currentMembers.filter(m => [
    m.member_number,m.nom,m.prenom,m.sexe,m.telephone,m.numero_pdv,
    m.region,m.ville,m.commune,m.emplacement,m.poste_occupe
  ].join(" ").toLocaleLowerCase("fr").includes(q));

  if (!rows.length) {
    box.textContent = currentMembers.length
      ? "Aucun membre ne correspond à votre recherche."
      : "Aucun membre enregistré pour le moment.";
    return;
  }

  box.innerHTML = `
    <p><strong>Nombre de membres affichés : ${rows.length}</strong></p>
    <div style="overflow-x:auto"><table>
      <thead><tr>
        <th>N° membre</th><th>Nom et prénom</th><th>Sexe</th><th>Téléphone</th>
        <th>N° PDV</th><th>Région / Ville / Commune</th><th>Emplacement</th>
        <th>Poste</th><th>Date d'inscription</th><th>Selfie</th>
      </tr></thead>
      <tbody>${rows.map(m => `<tr>
        <td>${escapeHTML(m.member_number)}</td>
        <td>${escapeHTML(m.nom)} ${escapeHTML(m.prenom)}</td>
        <td>${escapeHTML(m.sexe)}</td><td>${escapeHTML(m.telephone)}</td>
        <td>${escapeHTML(m.numero_pdv)}</td>
        <td>${escapeHTML([m.region,m.ville,m.commune].filter(Boolean).join(" / "))}</td>
        <td>${escapeHTML(m.emplacement)}</td><td>${escapeHTML(m.poste_occupe)}</td>
        <td>${escapeHTML(formatDate(m.created_at))}</td>
        <td>${m.selfie_path ? `<button type="button" data-photo="${escapeHTML(m.id)}">Voir le selfie</button>` : "Non disponible"}</td>
      </tr>`).join("")}</tbody>
    </table></div>`;

  box.querySelectorAll("[data-photo]").forEach(btn => {
    btn.addEventListener("click", () => openMemberPhoto(btn.dataset.photo));
  });
}

/* OUVERTURE SECURISEE DU SELFIE */
async function openMemberPhoto(id) {
  const member = currentMembers.find(m => String(m.id) === String(id));
  if (!member?.selfie_path) {
    alert("Aucun selfie disponible pour ce membre.");
    return;
  }
  try {
    const {data,error} = await client.storage.from("member-selfies")
      .createSignedUrl(member.selfie_path, 120);
    if (error) throw error;
    if (!data?.signedUrl) throw new Error("Lien sécurisé de la photo indisponible.");
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  } catch (err) {
    console.error("Erreur selfie :", err);
    alert(`Impossible d'afficher le selfie : ${err.message}`);
  }
}

/* RECHERCHE ET ACTUALISATION */
if ($("refresh")) $("refresh").addEventListener("click", loadMembers);
if ($("search")) $("search").addEventListener("input", renderMembers);

/* CREATION D'UN ADMINISTRATEUR — réservée au super_admin */
if ($("create-admin")) $("create-admin").addEventListener("submit", async event => {
  event.preventDefault();
  if (!client || currentAdminRole !== "super_admin") {
    status("admin-status", "Seul le Super Administrateur peut créer un administrateur.");
    return;
  }
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"],button:not([type])');
  try {
    const {data:sessionData,error:sessionError} = await client.auth.getSession();
    if (sessionError) throw sessionError;
    const session = sessionData?.session;
    if (!session) throw new Error("Session administrateur introuvable.");
    if (button) button.disabled = true;
    status("admin-status", "Création du compte administrateur en cours…");
    const formData = Object.fromEntries(new FormData(form).entries());
    const {error} = await client.functions.invoke("admin-create-user", {
      body:formData,
      headers:{Authorization:`Bearer ${session.access_token}`}
    });
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

/* DECONNEXION */
if ($("logout")) $("logout").addEventListener("click", async () => {
  try {
    const {error} = await client.auth.signOut();
    if (error) throw error;
    currentAdminRole = null;
    currentMembers = [];
    if ($("admin-panel")) $("admin-panel").hidden = true;
    if ($("login-form")) $("login-form").hidden = false;
    if ($("login-password")) $("login-password").value = "";
    if ($("members")) $("members").innerHTML = "";
    status("admin-status", "Vous êtes déconnecté.");
  } catch (err) {
    console.error("Déconnexion :", err);
    status("admin-status", `Erreur de déconnexion : ${err.message}`);
  }
});

/* RESTAURATION AUTOMATIQUE DE LA SESSION */
async function restoreAdminSession() {
  if (!client) return;
  try {
    const {data,error} = await client.auth.getSession();
    if (error) throw error;
    if (data?.session) await loadAdmin();
  } catch (err) {
    console.warn("Restauration session :", err);
  }
}

if (client) restoreAdminSession();
