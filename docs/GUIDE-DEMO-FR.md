# Guide rapide PC Star (FR)

## Entrer avec un compte démo

1. Bouton **Connexion**
2. Clique sur une ligne :

| Qui | E-mail | Mot de passe |
|-----|--------|--------------|
| Magasin (master) | _variable `MASTER_EMAIL`_ | _variable `MASTER_PASSWORD`_ |
| Client | karim.oran@demo.dz | karim31 |
| Client | amina.castors@demo.dz | amina31 |
| Client | yacine.pc@demo.dz | yacine31 |

> **Compte maître (magasin) :** il n'est plus publié ici. Il est défini par les
> variables d'environnement `MASTER_EMAIL` et `MASTER_PASSWORD` (voir
> `.env.example` et `docs/DEPLOY-VERCEL.md`). Les identifiants qui figuraient
> dans cette page et dans le code sont considérés comme **compromis** et
> doivent être changés — les retirer du dépôt ne suffit pas.

## Master

- **Admin** : ajouter / masquer produits  
- **Liste comptoir** : préparer les sacs (`PS-…`)  
- API allumée = multi-PC (client + desk)

## Client

- Ajouter au panier ou **Config PC** (compatibilité / surchauffe)  
- Réserver avec un mobile **05 / 06 / 07**  
- Payer au comptoir Oran  

## OAuth (livré, mode démo)

- Boutons **Google / Meta** dans le login — consent simulé par défaut (`OAUTH_DEMO=1`), réel avec clés.

## Lancer

```bash
npm run start:api
npm run dev
```

Page **Guide** dans le menu du site = même contenu.
