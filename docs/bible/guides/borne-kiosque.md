# Guide — Installer la borne d'inscription du comptoir

> Pour : la personne qui installe la tablette au comptoir (décisions K-1 à K-4 du 18/09).
> La tablette n'est pas encore achetée : ce guide vaut pour un iPad comme pour une tablette Android.
> **Recommandation (21/09)** : une tablette **Android avec Fully Kiosk Browser** (§3), seule solution
> qui ramène la tablette à la borne toute seule quand un client laisse le configurateur ou les
> occasions ouverts (§3 bis).

## 1. Lancer la borne depuis Paramètres (le plus simple)

Dans le DMS, un administrateur ouvre **Paramètres → Borne d'inscription** (décision K-6). On y trouve :

- le bouton **« Lancer le mode borne sur cet appareil »** : la borne s'ouvre en plein écran sur
  l'appareil utilisé. La case « Me déconnecter avant de lancer la borne » est cochée par défaut :
  à laisser cochée sur la tablette du comptoir, pour que personne ne puisse revenir dans le DMS ;
- l'**adresse** de la borne, à copier ;
- un **QR code** de cette adresse : on le scanne avec l'appareil photo de la tablette pour ouvrir
  la borne sans rien taper, puis on l'ajoute à l'écran d'accueil (étapes ci-dessous) ;
- ce guide, lisible directement dans l'application ;
- les **adresses des cases « Configurer ma Ducati » et « Nos occasions »** de l'écran d'accueil
  (voir ci-dessous). Vider une adresse masque la case ; si les deux sont vides, la borne ouvre
  directement le formulaire, comme avant. Le réglage n'est modifiable qu'une fois la mise à jour de
  la base appliquée (migration `20260921180000`) ; en attendant, la borne utilise les adresses
  par défaut.

## 1 bis. L'adresse à ouvrir

```
<adresse de l'application>/borne
```

- Aujourd'hui : l'adresse Netlify de l'application suivie de `/borne`
  (ex. `https://ducatilive.netlify.app/borne`).
- Plus tard : `https://app.ducatibruxelles.be/borne` (adresse client, pas encore en ligne).

La page `/borne` est faite pour une tablette partagée. Elle s'ouvre sur un **écran d'accueil à
trois grandes cases** (décision K-7 du 21/09) :

- **Configurer ma Ducati** : le configurateur officiel Ducati (Belgique, français),
  par défaut `https://configurator.ducati.com/bikes/be/fr` ;
- **Créer mon compte** : le formulaire d'inscription de la borne ;
- **Nos occasions** : les motos d'occasion du site Ducati Bruxelles,
  par défaut `https://ducatibruxelles.be/collections/motos-doccasion-new`.

Ce que garantit la borne :

- les **deux seules sorties** sont ces deux cases ; aucun autre lien ne sort de la page (les
  informations sur les données personnelles s'ouvrent par-dessus) ;
- sur le formulaire, un bouton **« Accueil »** ramène à l'écran d'accueil et vide le formulaire ;
- le bouton « retour » ne quitte pas la borne, il ramène à l'écran d'accueil, formulaire vidé ;
- la borne revient à l'écran d'accueil, formulaire vide, 15 secondes après le message de bienvenue,
  et après 90 secondes sans que personne ne touche l'écran, même au milieu d'une saisie ;
- le client **choisit son mot de passe à la borne**, comme en ligne (décision K-5) : au moins 8 caractères,
  une majuscule, une minuscule, un chiffre et un caractère spécial, avec un bouton « Afficher » ; rien
  n'est mémorisé (le navigateur ne propose ni n'enregistre de mot de passe, et le formulaire est
  détruit à chaque retour à l'accueil) ;
- si l'adresse e-mail correspond à un client **déjà connu**, le mot de passe tapé n'ouvre pas le compte
  (sécurité) : le client reçoit un e-mail pour choisir son mot de passe, et l'écran le lui dit ;
- après chaque inscription, un e-mail « Bienvenue chez Ducati Bruxelles » part par Outlook ;
- la page se recharge seule, discrètement, vers 3 h du matin (pour prendre les nouvelles versions) ;
- si internet tombe, un bandeau le dit et l'envoi est retenté automatiquement.

Il reste à **verrouiller la tablette** pour qu'on ne puisse pas quitter le navigateur, et à régler le
**retour à la borne** depuis le configurateur et les occasions (§3 bis).

### Pourquoi le configurateur et les occasions ne s'affichent pas « dans » la borne

Idéalement, les deux sites s'afficheraient dans un cadre sous une barre fixe « Accueil borne /
Créer mon compte ». **C'est impossible** : les deux sites interdisent d'être affichés dans le cadre
d'un autre site (vérifié le 21/09 sur les en-têtes des pages) :

- `configurator.ducati.com` : `X-Frame-Options: DENY` ;
- `ducatibruxelles.be` : `X-Frame-Options: DENY` et `Content-Security-Policy: frame-ancestors 'none'`.

Le navigateur afficherait une case vide. Les deux sites s'ouvrent donc **à la place de la borne**,
dans le même onglet, et c'est l'**application kiosque** de la tablette qui garantit le retour :
un bouton « Accueil » toujours visible, un retour automatique à la borne après une minute ou deux
sans activité, et l'interdiction de naviguer ailleurs (§3 bis). Avant d'ouvrir un site, la borne
se remet à zéro : rien du client précédent ne reste.

## 2. iPad — Accès guidé

1. **Ouvrir la page en plein écran** : dans Safari, ouvrir l'adresse ci-dessus, bouton Partager →
   « Sur l'écran d'accueil » → Ajouter. L'icône « Ducati Bruxelles » ouvre la page sans barre
   d'adresse. Toujours lancer la borne depuis cette icône.
2. **Activer l'Accès guidé** : Réglages → Accessibilité → Accès guidé → activé.
   - « Réglages du code » → définir un **code** connu du seul personnel (différent du code de l'iPad).
   - « Verrouillage automatique » → **Jamais** (pendant l'Accès guidé).
3. **Démarrer** : ouvrir la borne depuis l'icône, **triple-clic** sur le bouton latéral (ou le bouton
   principal) → Accès guidé → dans « Options », désactiver « Boutons de volume » et laisser
   « Clavier » **activé** (le client doit pouvoir écrire) → Démarrer.
4. **Sortir** (personnel) : triple-clic, saisir le code, « Arrêter ».

## 3. Android

### Solution simple : épinglage d'écran (gratuit, intégré)

1. Paramètres → Sécurité (ou « Sécurité et confidentialité ») → Autres paramètres →
   **Épingler les applications** → activé, avec « Demander le code PIN avant de désépingler ».
2. Dans Chrome, ouvrir l'adresse, menu ⋮ → « Ajouter à l'écran d'accueil » (ouvre sans barre d'adresse).
3. Ouvrir la borne depuis l'icône → écran des applications récentes → icône de l'appli → **Épingler**.
4. Désépingler (personnel) : appui long Retour + Aperçu, puis code PIN.

### Solution robuste : Fully Kiosk Browser (licence payante, environ 7 € par appareil)

Recommandé si la tablette reste allumée toute la journée sans surveillance.

1. Installer **Fully Kiosk Browser** depuis le Play Store, le définir comme **application d'accueil**.
2. Réglages Fully :
   - Web Content Settings → **Start URL** = l'adresse de la borne ;
   - Kiosk Mode → activé, avec un **PIN** de sortie connu du personnel ;
   - Web Browsing → désactiver « Enable Back Button » n'est pas nécessaire (la page gère le retour),
     mais désactiver les **pop-ups** et la **navigation hors de l'adresse de départ** ;
   - Device Management → **Keep Screen On** activé ; **Reload on internet reconnect** activé ;
   - Advanced Web Settings → **Clear cache / form data on reload** activé (aucune saisie mémorisée).
3. Désactiver les suggestions du clavier (voir ci-dessous).
4. Régler le retour à la borne depuis le configurateur et les occasions : §3 bis.

## 3 bis. Configurateur et occasions : revenir à la borne

Les libellés exacts peuvent varier selon la version de l'application ; chercher le réglage le plus
proche. Remplacer `<adresse de l'application>` par l'adresse réelle de la borne.

### Android — Fully Kiosk Browser (recommandé)

Dans les réglages de Fully (licence Plus nécessaire pour la liste blanche) :

1. **Web Content Settings → Start URL** = `<adresse de l'application>/borne`.
2. **Liste blanche des adresses** (Web Filter / URL Whitelist), une ligne par domaine :
   - le domaine de la borne (ex. `ducatilive.netlify.app`, plus tard `app.ducatibruxelles.be`) ;
   - `configurator.ducati.com` et `www.ducati.com` (le configurateur charge des pages du site Ducati) ;
   - `ducatibruxelles.be` et `www.ducatibruxelles.be`.
   Toute autre adresse est bloquée (réseaux sociaux, liens publicitaires, etc.). Si un réglage de
   Paramètres → Borne d'inscription change une adresse, ajouter son domaine ici : il est affiché
   sous les champs.
3. **Bouton « Accueil » toujours visible** : Toolbars & Appearance → afficher la barre d'actions
   (Action Bar) avec le bouton **Home** (retour à la Start URL) — ou, selon la version, activer le
   bouton flottant / la barre de navigation. Le client touche « Accueil » et revient à la borne.
4. **Retour automatique à la borne** : Web Auto Reload → **Auto Reload on Idle** = `120` secondes
   (recharge la Start URL après 2 minutes sans toucher l'écran). Sur la borne elle-même, rien ne
   change : elle se vide déjà seule après 90 secondes.
5. **Rien du client précédent** : Advanced Web Settings → effacer le cache, les **cookies** et les
   données de formulaires au rechargement (le configurateur garde sinon la dernière moto composée).
6. Désactiver les **pop-ups** et l'ouverture de **nouvelles fenêtres** (les liens qui voudraient
   s'ouvrir ailleurs restent dans la même fenêtre ou sont bloqués).
7. Vérifier : toucher « Configurer ma Ducati », puis « Accueil » : la borne revient. Toucher
   « Nos occasions », ne plus toucher l'écran 2 minutes : la borne revient seule.

### iPad — Accès guidé

L'Accès guidé verrouille l'iPad sur une application, mais **ne sait pas revenir seul à une adresse**
après inactivité, et Safari n'a pas de liste blanche simple. Deux possibilités :

- **Borne lancée depuis l'icône de l'écran d'accueil** (§2) : quand le client ouvre le configurateur
  ou les occasions, iOS les affiche dans une fenêtre par-dessus la borne, avec un bouton **« OK »** /
  **« Terminé »** en haut qui ramène à la borne. Si le client part sans le toucher, le site reste
  affiché jusqu'au passage du personnel : le vendeur touche « OK ».
- Pour un retour automatique sur iPad, il faut une application kiosque de l'App Store (par exemple
  Kiosk Pro) réglée comme Fully ci-dessus (adresse de départ, liste blanche, retour après
  inactivité, bouton accueil), lancée sous Accès guidé.

Si ni l'une ni l'autre ne convient, **masquer les deux cases** dans Paramètres → Borne d'inscription
(vider les deux adresses) : la borne redevient un simple formulaire sans aucune sortie.

## 4. Veille, écran et clavier

- **Veille** : l'écran ne doit jamais s'éteindre pendant les heures d'ouverture.
  iPad : Réglages → Luminosité et affichage → Verrouillage automatique → Jamais (et Accès guidé ci-dessus).
  Android : Paramètres → Affichage → Mise en veille de l'écran → la durée maximale, ou Fully « Keep Screen On ».
- **Charge** : laisser la tablette branchée ; sur Android, activer si possible la protection de batterie
  (charge limitée à 85 %).
- **Luminosité** : fixe, assez haute pour le comptoir (désactiver la luminosité automatique si l'écran
  paraît sombre).
- **Remplissage automatique** : désactiver l'enregistrement des adresses et des formulaires du
  navigateur (Safari → Réglages → Remplissage automatique : tout désactivé ; Chrome → Paramètres →
  Adresses et plus / Modes de paiement / Gestionnaire de mots de passe : désactivés). La page demande
  déjà au navigateur de ne rien retenir, cette étape est une sécurité de plus.
- **Clavier** : désactiver les suggestions apprises (iPad : Réglages → Général → Clavier →
  « Prédiction » désactivée ; Android / Gboard : Correction du texte → « Suggestions personnalisées »
  désactivées), pour que le nom d'un client ne soit pas proposé au suivant.
- **Mises à jour** : laisser les mises à jour du système se faire la nuit.

## 5. Vérifier après l'installation

0. L'écran d'accueil montre les trois cases. « Créer mon compte » ouvre le formulaire ; le bouton
   « Accueil » y ramène, formulaire vidé. « Configurer ma Ducati » et « Nos occasions » ouvrent les
   sites ; le bouton Accueil de l'application kiosque (ou « OK » sur iPad) ramène à la borne.
1. Remplir le formulaire avec une adresse de test **nouvelle** et un mot de passe, cocher « être
   recontacté » : le message de bienvenue s'affiche, l'e-mail « Bienvenue chez Ducati Bruxelles »
   arrive, une carte apparaît dans le CRM commercial avec la tâche « Recontacter le client » à J+2.
   Avec l'adresse d'un client déjà connu, c'est l'e-mail « Choisir mon mot de passe » qui arrive.
2. Attendre 15 s : la borne revient à l'écran d'accueil ; « Créer mon compte » montre un formulaire vide.
3. Commencer une saisie puis ne plus toucher l'écran 90 s : la borne revient à l'écran d'accueil, formulaire vide.
4. Ouvrir le configurateur, ne plus toucher l'écran 2 minutes : la tablette revient à la borne
   (Fully) ; sur iPad, toucher « OK ».
5. Couper le Wi-Fi : le bandeau « Pas de connexion internet » s'affiche ; le remettre : il disparaît.
6. Essayer de quitter l'application : impossible sans le code du personnel.

Pour retirer la fiche de test : la faire supprimer par un administrateur (Contacts), et le compte
correspondant dans Paramètres → Utilisateurs.

## Historique

| Date | Changement |
|---|---|
| 2026-09-18 | Création du guide (décisions K-1 à K-4). |
| 2026-09-18 | Retours de test : mot de passe choisi à la borne (K-5), e-mail de bienvenue (U-5), lancement depuis Paramètres → Borne d'inscription avec adresse et QR code (K-6). |
| 2026-09-21 | Écran d'accueil à 3 cases : configurateur Ducati, créer mon compte, nos occasions (K-7) ; pas de cadre possible (en-têtes des sites) ; §3 bis retour à la borne via l'application kiosque (liste blanche, bouton accueil, retour après inactivité). |
