# Guide — Ajouter le lien « Espace client » sur le site Shopify

> Pour : Simon (ou toute personne qui gère la boutique Shopify ducatibruxelles.be).
> Décision W-5 du 19/09 : le site pointe vers `/app-client` ; page « bientôt disponible » tant que
> l'application client n'est pas ouverte ; bascule vers l'inscription par un réglage du DMS.

## 1. L'adresse à mettre sur le site

```
https://ducatilive.netlify.app/app-client
```

- Plus tard, quand le domaine client sera en ligne : `https://app.ducatibruxelles.be/app-client`
  (il suffira alors de modifier le lien dans Shopify, une seule fois).
- L'adresse exacte est aussi affichée dans le DMS : **Paramètres → Application client**, bouton
  « Copier l'adresse ».
- Cette adresse **ne change pas** quand l'application ouvre. Pas besoin de retoucher Shopify le jour J :
  on actionne l'interrupteur dans le DMS (voir §4).

## 2. Ajouter le lien dans les menus (méthode conseillée)

1. Se connecter à l'administration Shopify (ducati-bruxelles.myshopify.com/admin).
2. Menu de gauche : **Contenu → Menus** (sur certaines versions : **Boutique en ligne → Navigation**).
3. Ouvrir le **menu principal** (« Main menu »).
4. **Ajouter un élément de menu** :
   - Libellé : `Espace client`
   - Lien : coller `https://ducatilive.netlify.app/app-client`
5. **Enregistrer le menu**.
6. Recommencer avec le menu du **pied de page** (« Footer menu ») : même libellé, même lien.

## 3. Variante : un bouton dans le thème

Pour un bouton ou une bannière sur la page d'accueil :

1. **Boutique en ligne → Thèmes → Personnaliser** (sur le thème publié).
2. Choisir la section voulue (bannière, bloc « Texte avec image »…), puis le champ **Lien du bouton**.
3. Coller la même adresse, libellé du bouton : `Espace client`.
4. **Enregistrer**.

## 4. Ce que voit le visiteur, et comment basculer

| Réglage dans le DMS (Paramètres → Application client) | Le visiteur qui clique sur « Espace client » voit |
|---|---|
| **Bientôt disponible** (réglage actuel) | La page « Notre application client sera bientôt disponible » : ce qu'elle apportera, et un formulaire facultatif « Prévenez-moi à l'ouverture » |
| **Ouverte** | Directement le formulaire d'inscription « Créer mon compte » (`/inscription`) |

Les adresses laissées sur « Prévenez-moi » sont listées dans le même écran, avec un export CSV.

## 5. À ne pas confondre : les « Comptes clients » de Shopify

Shopify a son propre réglage **Paramètres → Comptes clients** (connexion des acheteurs de la boutique,
icône « compte » en haut du site). **Il n'a rien à voir** avec l'application client du DMS :

- ne pas le modifier pour ce lien ;
- ne pas renommer l'icône « compte » de Shopify en « Espace client » : ce sont deux espaces différents
  (achats en ligne sur Shopify d'un côté ; motos, entretiens, factures de la concession de l'autre) ;
- notre lien est un **simple élément de menu** qui sort du site Shopify vers le DMS.

## 6. Vérifier

1. Ouvrir ducatibruxelles.be sur un téléphone, en navigation privée.
2. Menu → **Espace client** : la page « bientôt disponible » s'affiche.
3. Le lien **« Retour au site »** ramène sur ducatibruxelles.be.
