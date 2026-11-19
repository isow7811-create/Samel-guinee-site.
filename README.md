# SAMEL-Guinée — plateforme d'identification

Cette livraison contient le code source et la configuration serveur. Elle n'est pas encore publiée sur Internet : il faut d'abord créer le projet Supabase, configurer les secrets et déployer le dossier sur un hébergeur (ex. Vercel/Netlify).

## Fonctionnalités prévues
- Formulaire public avec selfie (caméra ou fichier).
- Numéro de membre attribué côté serveur à partir de 22.
- Numéros 1 à 21 réservés à la saisie manuelle par l'administration.
- Espace de connexion administrateur.
- Rôles `super_admin` et `admin` ; seul `super_admin` peut créer des administrateurs.
- Recherche, consultation et modification des dossiers.
- Photos conservées dans un stockage privé.
- Notification e-mail via Resend vers `samelguinee224@gmail.com`.
- Coordonnées affichées : téléphone `627308730`, contact `centregeneral9@gmail.com`. Les notifications d’inscription restent destinées à `samelguinee224@gmail.com`.

## Mise en service
1. Créer un projet sur https://supabase.com.
2. Dans SQL Editor, exécuter `supabase/migrations/001_schema.sql`.
3. Créer un bucket privé `member-selfies` (ou exécuter le SQL fourni).
4. Déployer les fonctions Edge :
   - `submit-member`
   - `admin-create-user`
   - `admin-update-member`
5. Configurer les secrets des fonctions :
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (secret serveur uniquement, jamais dans le navigateur)
   - `RESEND_API_KEY`
   - `MAIL_FROM` (adresse d'envoi vérifiée dans Resend)
   - `SUPER_ADMIN_EMAIL` (ton adresse e-mail de connexion)
6. Créer le compte Super administrateur initial depuis Supabase Auth (Dashboard > Authentication > Users > Add user), avec l'adresse définie dans `SUPER_ADMIN_EMAIL`.
7. Dans SQL Editor, remplacer `UUID_DU_SUPER_ADMIN` ci-dessous par l'UUID réel du compte, puis exécuter :
   `insert into public.profiles(user_id, role) values ('UUID_DU_SUPER_ADMIN','super_admin');`
8. Dans `index.html`, remplacer `SUPABASE_URL_ICI` et `SUPABASE_ANON_KEY_ICI` par les valeurs du projet (Project Settings > API).
9. Publier le dossier sur Vercel/Netlify. Configurer les variables d'environnement si nécessaire et associer le domaine.

## Important
- Ne jamais partager la clé `service_role` ni la clé Resend.
- L'adresse de réception des notifications est Samelguinee224@gmail.com.
- L'adresse samelguinee224@gmail.com est uniquement le contact institutionnel.
- Pour la conformité et la confidentialité, informer les personnes de l'usage de leurs données et limiter l'accès aux photos.
- Avant ouverture publique, tester les inscriptions, l'unicité des numéros, les rôles et les e-mails.


**Dernière mise à jour du formulaire :** le champ Maison de distribution est retiré; la localisation devient Région / Ville / Commune; la photo se capture directement depuis la caméra et aucune galerie n est utilisée. Les nouvelles inscriptions notifient `samelguinee224@gmail.com`; le selfie est inclus dans le mail via un lien privé temporaire de 7 jours.


## État de cette livraison
- Le bouton « Adhérer » est visible dans l’en-tête et reste accessible en bas de l’écran sur mobile.
- L’adresse de contact affichée est `centregeneral9@gmail.com`.
- Les notifications d’inscription restent adressées à `samelguinee224@gmail.com` par la fonction serveur.
- Le formulaire, le selfie, la base Supabase et l’espace admin nécessitent encore la configuration réelle des clés et le déploiement des fonctions. Cette archive seule ne signifie pas que le site est publié ni que les e-mails ont été testés.
