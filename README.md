# SAMEL-Guinée — plateforme d'identification

Le dépôt contient le site statique, l'application d'administration et les fonctions Supabase Edge. Le code seul ne rend pas le service public : la migration SQL, les secrets Supabase, le déploiement des fonctions et l'hébergement doivent être configurés sur les comptes propriétaires.

## Fonctionnalités présentes dans le code
- Formulaire public avec capture selfie par caméra (pas de sélection galerie).
- Enregistrement des membres et selfie dans le stockage privé `member-selfies`.
- Numérotation serveur à partir de 22 ; les numéros 1 à 21 restent réservés à l'intégration manuelle.
- Conservation du numéro de carte d'origine dans `numero_carte_origine`. Si le numéro demandé est déjà pris, le serveur attribue un numéro libre.
- Connexion administrateur, tableau des membres, recherche, actualisation, consultation sécurisée des selfies.
- Ajout, modification et suppression de dossiers.
- Création de comptes administrateurs réservée au rôle `super_admin`.
- Fiche individuelle PDF et liste générale PDF imprimable.
- Notification des nouvelles inscriptions à `samelguinee224@gmail.com`.
- Coordonnées institutionnelles affichées : téléphone `627308730`, e-mail `centregeneral9@gmail.com`.
- Devise : « Travail / Compétence / Solidarité » ; slogan : « ON EST LÀ, POUR NOS DROITS ON SE BAT. »

## Fichiers importants
- `index.html`, `style.css`, `app.js` : site et interface.
- `supabase/migrations/001_schema.sql` : schéma initial.
- `supabase/migrations/002_application_alignment.sql` : alignement des colonnes, sécurité RLS et fonctions SQL d'attribution.
- `supabase/functions/submit-member/index.ts` : inscription publique.
- `supabase/functions/admin-create-user/index.ts` : création d'administrateurs par le Super Administrateur.
- `supabase/functions/admin-manage-member/index.ts` : ajout, modification et suppression des membres.
- `supabase/config.toml` : configuration des fonctions Edge.
- `render.yaml` : blueprint d'hébergement statique Render.

## Mise en service — actions requises dans le compte Supabase
1. Vérifier le projet Supabase attendu et sauvegarder la base existante avant migration.
2. Exécuter `supabase/migrations/002_application_alignment.sql` dans le SQL Editor après avoir contrôlé le schéma réel et les données existantes.
3. Vérifier la présence du bucket privé `member-selfies`.
4. Déployer les trois fonctions Edge du dossier `supabase/functions`.
5. Configurer les secrets serveur :
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (ou `SAMEL_SERVICE_ROLE_KEY`), secret serveur uniquement
   - `RESEND_API_KEY`
   - `MAIL_FROM` (adresse d'envoi vérifiée dans Resend)
6. Créer ou vérifier le compte Super Administrateur et son enregistrement dans `public.profiles` avec le rôle `super_admin`.
7. Vérifier les URLs autorisées de redirection/authentification Supabase.

## Mise en ligne — Render
Le fichier `render.yaml` décrit un site statique. Il faut connecter ce dépôt à Render ou rattacher le blueprint à un service existant, puis attendre un déploiement réussi. L'ajout du fichier ne déploie pas à lui seul le site.

## Vérifications obligatoires avant ouverture publique
- Une inscription de test avec selfie.
- Numéro 22 attribué à un nouveau membre si aucun ancien numéro n'est demandé.
- Réutilisation d'un ancien numéro libre ; attribution d'un autre numéro si déjà utilisé.
- Refus public des numéros 1 à 21.
- Intégration manuelle d'un membre avec numéro 1 à 21 et refus des doublons.
- Connexion admin, recherche, actualisation, modification et suppression.
- Création d'un administrateur par le Super Administrateur et refus pour un administrateur ordinaire.
- Ouverture du selfie, fiche PDF individuelle, PDF de la liste complète.
- Réception réelle du courriel à `samelguinee224@gmail.com`.
- Test sur téléphone Android et vérification de l'accès public HTTPS.

## Sécurité
Ne jamais mettre une clé `service_role`, une clé Resend ou un mot de passe dans `app.js`, dans le dépôt ou dans une conversation. Les secrets doivent rester dans les paramètres Supabase.
