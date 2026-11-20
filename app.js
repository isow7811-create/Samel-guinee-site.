
// =====================================================
// SAMEL-GUINÉE — APPLICATION PRINCIPALE
// Connexion Supabase, inscriptions et administration
// =====================================================

const SUPABASE_URL = "https://muzxcqrcalvmjzhjyeat.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_F8OJKc0ZCtnXxEKRnkFMfA_5Ep8naL0";

const client = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

const $ = (id) => document.getElementById(id);

let cameraStream = null;
let selfieBlob = null;

// -----------------------------------------------------
// AFFICHAGE DES MESSAGES
// -----------------------------------------------------

function status(id, message) {
  const element = $(id);
  if (element) element.textContent = message;
}

// -----------------------------------------------------
// CAMÉRA ET CAPTURE DU SELFIE
// -----------------------------------------------------

const video = $("camera-video");
const canvas = $("camera-canvas");
const preview = $("selfie-preview");

if ($("start-camera")) {
  $("start-camera").addEventListener("click", async () => {
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false
      });

      video.srcObject = cameraStream;
      video.hidden = false;
      preview.hidden = true;

      $("take-selfie").hidden = false;
      $("start-camera").hidden = true;
      $("retake-selfie").hidden = true;

      await video.play();

    } catch (error) {
      status(
        "form-status",
        "Impossible d'ouvrir la caméra. Autorisez son accès et réessayez."
      );
    }
  });
}

if ($("take-selfie")) {
  $("take-selfie").addEventListener("click", () => {
    if (!video || !video.videoWidth) {
      status("form-status", "La caméra n'est pas encore prête.");
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

    canvas.toBlob((blob) => {
      if (!blob) {
        status("form-status", "La capture de la photo a échoué.");
        return;
      }

      selfieBlob = blob;
      preview.src = URL.createObjectURL(blob);
      preview.hidden = false;
      video.hidden = true;

      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
      }

      $("take-selfie").hidden = true;
      $("retake-selfie").hidden = false;

      status(
        "form-status",
        "Selfie capturé. Vous pouvez envoyer votre inscription."
      );

    }, "image/jpeg", 0.9);
  });
}

if ($("retake-selfie")) {
  $("retake-selfie").addEventListener("click", () => {
    selfieBlob = null;

    preview.hidden = true;
    preview.removeAttribute("src");

    $("start-camera").hidden = false;
    $("take-selfie").hidden = true;
    $("retake-selfie").hidden = true;
  });
}

// -----------------------------------------------------
// INSCRIPTION DES MEMBRES
// -----------------------------------------------------

if ($("member-form")) {
  $("member-form").addEventListener("submit", async (event) => {
    event.preventDefault();

    const form = event.currentTarget;

    if (!selfieBlob) {
      status(
        "form-status",
        "Veuillez prendre votre selfie avant d'envoyer votre inscription."
      );
      return;
    }

    if (selfieBlob.size > 5 * 1024 * 1024) {
      status("form-status", "La photo ne doit pas dépasser 5 Mo.");
      return;
    }

    const formData = new FormData(form);

    // Les numéros 1 à 21 restent réservés aux membres
    // existants intégrés manuellement par l'administration.
    formData.delete("numero_existant");

    formData.append("selfie", selfieBlob, "selfie.jpg");

    const submitButton = form.querySelector('[type="submit"]');
    if (submitButton) submitButton.disabled = true;

    status("form-status", "Envoi de votre inscription en cours...");

    try {
      const { data, error } = await client.functions.invoke(
        "submit-member",
        { body: formData }
      );

      if (error) {
        console.error("Erreur inscription :", error);
        throw error;
      }

      if (!data || !data.member_number) {
        throw new Error("Le numéro de membre n'a pas été retourné.");
      }

      status(
        "form-status",
        `Inscription envoyée avec succès ! Votre numéro de membre est : ${data.member_number}.`
      );

      form.reset();
      selfieBlob = null;

      preview.hidden = true;
      preview.removeAttribute("src");

      $("start-camera").hidden = false;
      $("take-selfie").hidden = true;
      $("retake-selfie").hidden = true;

    } catch (error) {
      console.error(error);

      status(
        "form-status",
        "Échec de l'inscription. Vérifiez votre connexion ou contactez l'administration."
      );

    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

// -----------------------------------------------------
// CONNEXION ADMINISTRATEUR
// -----------------------------------------------------

if ($("login-form")) {
  $("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();

    status("admin-status", "Connexion en cours...");

    const email = $("login-email").value.trim();
    const password = $("login-password").value;

    try {
      const { error } = await client.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      await loadAdmin();

    } catch (error) {
      console.error("Erreur de connexion :", error);

      status(
        "admin-status",
        "Connexion refusée. Vérifiez votre adresse e-mail et votre mot de passe."
      );
    }
  });
}

// -----------------------------------------------------
// DÉCONNEXION
// -----------------------------------------------------

if ($("logout")) {
  $("logout").addEventListener("click", async () => {
    await client.auth.signOut();

    $("admin-panel").hidden = true;
    $("login-form").hidden = false;

    status("admin-status", "Vous êtes déconnecté.");
  });
}

// -----------------------------------------------------
// ACTUALISATION ET RECHERCHE
// -----------------------------------------------------

if ($("refresh")) {
  $("refresh").addEventListener("click", loadAdmin);
}

if ($("search")) {
  $("search").addEventListener("input", loadAdmin);
}

// -----------------------------------------------------
// CHARGEMENT DU TABLEAU DE BORD ADMINISTRATEUR
// -----------------------------------------------------

async function loadAdmin() {
  try {
    const {
      data: { user },
      error: userError
    } = await client.auth.getUser();

    if (userError || !user) {
      $("admin-panel").hidden = true;
      $("login-form").hidden = false;
      return;
    }

    // Vérification du rôle de l'administrateur
    const { data: profile, error: profileError } = await client
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    if (profileError || !profile) {
      status(
        "admin-status",
        "Profil administrateur introuvable ou accès non autorisé."
      );
      return;
    }

    $("login-form").hidden = true;
    $("admin-panel").hidden = false;

    $("role").textContent =
      "Connecté : " + user.email + " — Rôle : " + profile.role;

    // Seul le Super Administrateur peut créer des administrateurs
    $("admin-create").hidden = profile.role !== "super_admin";

    await loadMembers();

  } catch (error) {
    console.error("Erreur tableau de bord :", error);
    status("admin-status", "Impossible de charger le tableau de bord.");
  }
}

// -----------------------------------------------------
// CHARGEMENT DES MEMBRES
// -----------------------------------------------------

async function loadMembers() {
  const container = $("members");

  if (!container) return;

  container.textContent = "Chargement des membres...";

  const { data, error } = await client
    .from("members")
    .select(`
      id,
      member_number,
      nom,
      prenom,
      sexe,
      telephone,
      numero_pdv,
      region,
      ville,
      commune,
      emplacement,
      poste_occupe,
      created_at,
      selfie_path
    `)
    .order("member_number", { ascending: true });

  if (error) {
    console.error("Erreur chargement membres :", error);
    container.textContent =
      "Impossible de charger les membres. Vérifiez les autorisations de la base de données.";
    return;
  }

  const search = ($("search")?.value || "").toLowerCase().trim();

  const members = (data || []).filter(member => {
    const searchable = [
      member.member_number,
      member.nom,
      member.prenom,
      member.telephone,
      member.numero_pdv,
      member.region,
      member.ville,
      member.commune
    ].join(" ").toLowerCase();

    return searchable.includes(search);
  });

  if (members.length === 0) {
    container.textContent = "Aucun membre trouvé.";
    return;
  }

  container.innerHTML = `
    <p><strong>Nombre de membres affichés : ${members.length}</strong></p>

    <div style="overflow-x:auto;">
      <table>
        <thead>
          <tr>
            <th>N° membre</th>
            <th>Nom et prénom</th>
            <th>Sexe</th>
            <th>Téléphone</th>
            <th>N° PDV</th>
            <th>Région</th>
            <th>Ville</th>
            <th>Commune</th>
            <th>Emplacement</th>
            <th>Poste</th>
            <th>Date d'inscription</th>
            <th>Selfie</th>
          </tr>
        </thead>

        <tbody>
          ${members.map(member => `
            <tr>
              <td>${escapeHTML(member.member_number)}</td>
              <td>${escapeHTML(member.nom)} ${escapeHTML(member.prenom)}</td>
              <td>${escapeHTML(member.sexe)}</td>
              <td>${escapeHTML(member.telephone)}</td>
              <td>${escapeHTML(member.numero_pdv)}</td>
              <td>${escapeHTML(member.region)}</td>
              <td>${escapeHTML(member.ville)}</td>
              <td>${escapeHTML(member.commune)}</td>
              <td>${escapeHTML(member.emplacement)}</td>
              <td>${escapeHTML(member.poste_occupe)}</td>
              <td>${formatDate(member.created_at)}</td>
              <td>
                <button type="button" data-photo="${escapeHTML(member.id)}">
                  Voir le selfie
                </button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  // Affichage sécurisé des selfies depuis le stockage privé
  container.querySelectorAll("[data-photo]").forEach(button => {
    button.addEventListener("click", async () => {
      const member = members.find(
        item => item.id === button.dataset.photo
      );

      if (!member || !member.selfie_path) {
        alert("Aucun selfie disponible pour ce membre.");
        return;
      }

      const { data: signedData, error: photoError } = await client
        .storage
        .from("member-selfies")
        .createSignedUrl(member.selfie_path, 60);

      if (photoError || !signedData?.signedUrl) {
        alert("Impossible d'afficher le selfie.");
        return;
      }

      window.open(
        signedData.signedUrl,
        "_blank",
        "noopener,noreferrer"
      );
    });
  });
}

// -----------------------------------------------------
// CRÉATION D'UN ADMINISTRATEUR
// -----------------------------------------------------

if ($("create-admin")) {
  $("create-admin").addEventListener("submit", async (event) => {
    event.preventDefault();

    const form = event.currentTarget;

    try {
      const {
        data: { session },
        error: sessionError
      } = await client.auth.getSession();

      if (sessionError || !session) {
        throw new Error("Session administrateur introuvable.");
      }

      const formData = Object.fromEntries(
        new FormData(form).entries()
      );

      status("admin-status", "Création du compte en cours...");

      const { error } = await client.functions.invoke(
        "admin-create-user",
        {
          body: formData,
          headers: {
            Authorization: "Bearer " + session.access_token
          }
        }
      );

      if (error) throw error;

      status("admin-status", "Compte administrateur créé avec succès.");
      form.reset();

    } catch (error) {
      console.error("Erreur création administrateur :", error);

      status(
        "admin-status",
        "Création impossible. Vérifiez que la fonction admin-create-user est bien déployée et que vos droits sont valides."
      );
    }
  });
}

// -----------------------------------------------------
// OUTILS DE SÉCURITÉ ET DE FORMATAGE
// -----------------------------------------------------

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function formatDate(value) {
  if (!value) return "";

  return new Date(value).toLocaleString("fr-FR", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

// -----------------------------------------------------
// RESTAURATION DE SESSION ADMINISTRATEUR
// -----------------------------------------------------

(async function restoreAdminSession() {
  const { data: { session } } = await client.auth.getSession();

  if (session) {
    await loadAdmin();
  }
})();
