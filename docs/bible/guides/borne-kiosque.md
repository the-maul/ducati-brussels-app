# Guide — Installer la borne d'inscription du comptoir

> Pour : la personne qui installe la tablette au comptoir (décisions K-1 à K-4 du 18/09).
> La tablette n'est pas encore achetée : ce guide vaut pour un iPad comme pour une tablette Android.

## 1. Lancer la borne depuis Paramètres (le plus simple)

Dans le DMS, un administrateur ouvre **Paramètres → Borne d'inscription** (décision K-6). On y trouve :

- le bouton **« Lancer le mode borne sur cet appareil »** : la borne s'ouvre en plein écran sur
  l'appareil utilisé. La case « Me déconnecter avant de lancer la borne » est cochée par défaut :
  à laisser cochée sur la tablette du comptoir, pour que personne ne puisse revenir dans le DMS ;
- l'**adresse** de la borne, à copier ;
- un **QR code** de cette adresse : on le scanne avec l'appareil photo de la tablette pour ouvrir
  la borne sans rien taper, puis on l'ajoute à l'écran d'accueil (étapes ci-dessous) ;
- ce guide, lisible directement dans l'application.

## 1 bis. L'adresse à ouvrir

```
<adresse de l'application>/borne
```

- Aujourd'hui : l'adresse Netlify de l'application suivie de `/borne`
  (ex. `https://ducatilive.netlify.app/borne`).
- Plus tard : `https://app.ducatibruxelles.be/borne` (adresse client, pas encore en ligne).

La page `/borne` est faite pour une tablette partagée :

- aucun lien ne sort de la page (les informations sur les données personnelles s'ouvrent par-dessus) ;
- le bouton « retour » ne quitte pas la borne, il remet le formulaire à zéro ;
- le formulaire se vide 15 secondes après le message de bienvenue, et après 90 secondes sans que
  personne ne touche l'écran, même au milieu d'une saisie ;
- le client **choisit son mot de passe à la borne**, comme en ligne (décision K-5) : au moins 8 caractères,
  une majuscule, une minuscule, un chiffre et un caractère spécial, avec un bouton « Afficher » ; rien
  n'est mémorisé (le navigateur ne propose ni n'enregistre de mot de passe, et le formulaire est
  détruit à chaque retour à l'accueil) ;
- si l'adresse e-mail correspond à un client **déjà connu**, le mot de passe tapé n'ouvre pas le compte
  (sécurité) : le client reçoit un e-mail pour choisir son mot de passe, et l'écran le lui dit ;
- après chaque inscription, un e-mail « Bienvenue chez Ducati Bruxelles » part par Outlook ;
- la page se recharge seule, discrètement, vers 3 h du matin (pour prendre les nouvelles versions) ;
- si internet tombe, un bandeau le dit et l'envoi est retenté automatiquement.

Il reste à **verrouiller la tablette** pour qu'on ne puisse pas quitter le navigateur.

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

1. Remplir le formulaire avec une adresse de test **nouvelle** et un mot de passe, cocher « être
   recontacté » : le message de bienvenue s'affiche, l'e-mail « Bienvenue chez Ducati Bruxelles »
   arrive, une carte apparaît dans le CRM commercial avec la tâche « Recontacter le client » à J+2.
   Avec l'adresse d'un client déjà connu, c'est l'e-mail « Choisir mon mot de passe » qui arrive.
2. Attendre 15 s : le formulaire revient vide.
3. Commencer une saisie puis ne plus toucher l'écran 90 s : le formulaire revient vide.
4. Couper le Wi-Fi : le bandeau « Pas de connexion internet » s'affiche ; le remettre : il disparaît.
5. Essayer de quitter l'application : impossible sans le code du personnel.

Pour retirer la fiche de test : la faire supprimer par un administrateur (Contacts), et le compte
correspondant dans Paramètres → Utilisateurs.

## Historique

| Date | Changement |
|---|---|
| 2026-09-18 | Création du guide (décisions K-1 à K-4). |
| 2026-09-18 | Retours de test : mot de passe choisi à la borne (K-5), e-mail de bienvenue (U-5), lancement depuis Paramètres → Borne d'inscription avec adresse et QR code (K-6). |
