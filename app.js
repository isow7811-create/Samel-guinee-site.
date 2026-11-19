// Configuration publique Supabase : ces deux valeurs ne sont PAS des secrets.
const SUPABASE_URL = "SUPABASE_URL_ICI";
const SUPABASE_ANON_KEY = "SUPABASE_ANON_KEY_ICI";
const configured = !SUPABASE_URL.includes("_ICI") && !SUPABASE_ANON_KEY.includes("_ICI");
const client = configured ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const $ = id => document.getElementById(id);
let cameraStream=null, selfieBlob=null;
const video=$("camera-video"), canvas=$("camera-canvas"), preview=$("selfie-preview");
$("start-camera").onclick=async()=>{
 try{
  cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"user"},audio:false});
  video.srcObject=cameraStream; video.hidden=false; preview.hidden=true;
  $("take-selfie").hidden=false; $("start-camera").hidden=true; $("retake-selfie").hidden=true;
 }catch(err){status("form-status","Impossible d'ouvrir la caméra. Autorisez l'accès à la caméra et réessayez.");}
};
$("take-selfie").onclick=()=>{
 if(!video.videoWidth)return;
 canvas.width=video.videoWidth; canvas.height=video.videoHeight;
 canvas.getContext("2d").drawImage(video,0,0,canvas.width,canvas.height);
 canvas.toBlob(blob=>{if(!blob)return; selfieBlob=blob; preview.src=URL.createObjectURL(blob); preview.hidden=false; video.hidden=true;
 if(cameraStream){cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null;}
 $("take-selfie").hidden=true; $("retake-selfie").hidden=false; status("form-status","Selfie capturé. Vous pouvez envoyer votre inscription."); },"image/jpeg",0.9);
};
$("retake-selfie").onclick=()=>{selfieBlob=null;preview.hidden=true;preview.removeAttribute("src");$("start-camera").hidden=false;$("retake-selfie").hidden=true;};
const status = (id,msg) => $(id).textContent=msg;
if(!configured) status("form-status","Mise en service en attente : les identifiants publics du projet Supabase doivent être ajoutés.");
$("member-form").addEventListener("submit", async e=>{
 e.preventDefault(); if(!client){status("form-status","Le site n'est pas encore connecté à sa base de données.");return;}
 const f=e.currentTarget, data=Object.fromEntries(new FormData(f).entries()), photo=selfieBlob;
 if(!photo){status("form-status","Veuillez prendre votre selfie avec la caméra avant l'envoi.");return;}
 if(photo.size>5*1024*1024){status("form-status","La photo doit faire 5 Mo maximum.");return;}
 const fd=new FormData(); Object.entries(data).forEach(([k,v])=>fd.append(k,v));fd.append("selfie",photo,"selfie.jpg");
 status("form-status","Envoi en cours…");
 const {data:result,error}=await client.functions.invoke("submit-member",{body:fd});
 if(error){status("form-status","Échec de l'envoi. Vérifiez votre connexion ou contactez l'administration.");return;}
 status("form-status",`Demande envoyée. Votre numéro de membre est : ${result.member_number}.`);
 f.reset(); selfieBlob=null; preview.hidden=true; preview.removeAttribute("src"); $("start-camera").hidden=false; $("take-selfie").hidden=true; $("retake-selfie").hidden=true;
});
$("login-form").addEventListener("submit",async e=>{
 e.preventDefault();if(!client){status("admin-status","Configuration Supabase nécessaire.");return;}
 const {error}=await client.auth.signInWithPassword({email:$("login-email").value,password:$("login-password").value});
 if(error){status("admin-status","Connexion refusée. Vérifiez vos identifiants.");return;} await loadAdmin();
});
$("logout").onclick=async()=>{await client.auth.signOut();$("admin-panel").hidden=true;$("login-form").hidden=false;};
$("refresh").onclick=loadAdmin;$("search").oninput=loadAdmin;
async function loadAdmin(){
 const {data:{user}}=await client.auth.getUser();if(!user)return;
 const {data:profile}=await client.from("profiles").select("role").eq("user_id",user.id).single();
 if(!profile){status("admin-status","Profil administrateur introuvable.");return;}
 $("login-form").hidden=true;$("admin-panel").hidden=false;$("role").textContent="Connecté : "+user.email+" — rôle : "+profile.role;
 $("admin-create").hidden=profile.role!=="super_admin";
 const {data,error}=await client.from("members").select("id,member_number,nom,prenom,telephone,numero_pdv,region_ville_commune,created_at,selfie_path").order("member_number");
 if(error){status("admin-status","Impossible de charger les membres.");return;}
 const q=$("search").value.toLowerCase(), rows=(data||[]).filter(m=>[m.member_number,m.nom,m.prenom,m.telephone,m.numero_pdv].join(" ").toLowerCase().includes(q));
 $("members").innerHTML="<table><thead><tr><th>N° membre</th><th>Nom</th><th>Téléphone</th><th>PDV</th><th>Région/Ville/Commune</th><th>Selfie</th></tr></thead><tbody>"+rows.map(m=>`<tr><td>${m.member_number}</td><td>${esc(m.nom)} ${esc(m.prenom)}</td><td>${esc(m.telephone)}</td><td>${esc(m.numero_pdv)}</td><td>${esc(m.region_ville_commune)}</td><td><button data-photo="${m.id}">Voir</button></td></tr>`).join("")+"</tbody></table>";
 $("members").querySelectorAll("[data-photo]").forEach(b=>b.onclick=async()=>{const m=rows.find(x=>x.id===b.dataset.photo);const {data,error}=await client.storage.from("member-selfies").createSignedUrl(m.selfie_path,60);if(!error)window.open(data.signedUrl,"_blank","noopener");});
}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
$("create-admin").addEventListener("submit",async e=>{
 e.preventDefault();const {data:{session}}=await client.auth.getSession();const form=Object.fromEntries(new FormData(e.currentTarget).entries());
 const {error}=await client.functions.invoke("admin-create-user",{body:form,headers:{Authorization:"Bearer "+session.access_token}});
 status("admin-status",error?"Création impossible. Vérifiez les droits et la configuration.":"Compte administrateur créé.");e.currentTarget.reset();
});
