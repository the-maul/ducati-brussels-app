# Questions en attente du client

Chaque question a une **recommandation** : répondre « OK » suffit pour la retenir.
Une fois tranchée, la réponse part dans le [journal des décisions](decisions.md) et la question
disparaît d'ici.

---

## Mission 01 — Nouveau client

### Lot 3 — Portail client

- **Q1 — Adresse du portail.** Même application, à l'adresse `/mon-espace`, ou un sous-domaine
  comme `client.ducatibxl.be` ?
  *Reco : même application tout de suite ; le sous-domaine se branche plus tard sans rien refaire.*
- **Q2 — Contenu de la première version.** Ses véhicules, ses entretiens et réparations, ses
  factures en PDF, ses coordonnées. Faut-il autre chose, comme la prise de rendez-vous atelier ?
  *Reco : les quatre en lecture, plus la modification de ses coordonnées. Rendez-vous plus tard.*
- **Q3 — Deux sociétés.** Un client qui a acheté chez ITALBIKE STORE et chez NL INVEST voit-il tout
  dans un seul espace ?
  *Reco : oui, un seul espace, la société est indiquée sur chaque document.*
- **Q4 — Photos.** Photo de profil et photo de sa moto dès la première version ?
  *Reco : oui, c'est déjà prévu et l'outil de photo existe.*
- **Q5 — Profil à compléter.** Quelles informations demander au client : adresse, date de
  naissance, permis, moto actuelle, préférences de contact ?
  *Reco : adresse, téléphone, moto actuelle, consentement marketing. Le reste facultatif.*
- **Q6 — Invitation des prospects.** Quand une demande arrive par mail, l'invitation à créer un
  compte part automatiquement, ou le vendeur l'envoie d'un bouton sur la carte ?
  *Reco : un bouton sur la carte. Envoyer d'office à chaque inconnu risque de passer pour du spam.*

### Lot 4 — Borne comptoir et site

- **Q7 — Le site public est-il Shopify ?** Si oui, la page d'inscription s'intègre dans Shopify
  par un lien ou un cadre, et la boutique intégrée au DMS n'est pas utilisée.
- **Q8 — Champs de la borne.** Prénom, nom, e-mail, téléphone, moto actuelle, ce qui l'intéresse,
  consentement marketing. Autre chose ?
  *Reco : ces sept champs, rien de plus, pour que ça prenne une minute.*
- **Q9 — Après l'inscription à la borne.** On crée aussi une carte CRM avec une tâche pour le
  commercial ?
  *Reco : oui, avec la tâche « Accueillir / recontacter » confiée au responsable par défaut.*
- **Q10 — La tablette.** Quelle tablette, et doit-elle être verrouillée sur la page d'inscription
  (mode kiosque) ?
  *Reco : navigateur en plein écran sur la page borne ; retour automatique à l'accueil après
  chaque client.*
- **Q11 — Adresse affichée dans le message de bienvenue** : `ducatilive.netlify.app` ou un domaine
  de la concession ?

### Lot 1c — Fusion des doublons

- **Q12 — Qui valide les fusions ?**
  *Reco : les administrateurs seulement.*
- **Q13 — Quelle fiche garder ?**
  *Reco : celle qui a des factures, sinon la plus ancienne ; ses champs vides sont complétés par
  l'autre fiche ; l'historique des deux est conservé.*
- **Q14 — Adresses partagées** par plusieurs personnes (84 cas : couple, famille, société). Quand un
  mail arrive d'une telle adresse, on demande sur la carte à quelle fiche le rattacher ?
  *Reco : oui, un avertissement sur la carte avec le choix de la fiche.*
