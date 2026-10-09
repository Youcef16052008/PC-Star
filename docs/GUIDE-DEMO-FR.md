# Guide rapide PC Star (FR)

## Entrer avec un compte démo

1. Bouton **Connexion**
2. Clique sur une ligne :

| Qui | E-mail | Mot de passe |
|-----|--------|--------------|
| Magasin (master) | _variable `MASTER_EMAIL`_ | _variable `MASTER_PASSWORD`_ |
| Client | karim.oran@demo.dz | _variable `DEMO_PASSWORD`_ |
| Client | amina.castors@demo.dz | _variable `DEMO_PASSWORD`_ |
| Client | yacine.pc@demo.dz | _variable `DEMO_PASSWORD`_ |

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

- Boutons **Google / Meta** dans le login — consent simulé par défaut (`OAUTH_DEMO=1`). Le flux réel est disponible avec `OAUTH_DEMO=0`, les clés serveur et les URI de callback enregistrées chez Google et Meta.

## Lancer

```bash
npm run start:api
npm run dev
```

Page **Guide** dans le menu du site (menu **Gestion → Guide**, master only) = même contenu.

> **Comptes de démonstration (clients) :** leur mot de passe n'est plus publié
> ici non plus (lot 1.19). Côté serveur il vient de la variable d'environnement
> `DEMO_PASSWORD` — une seule valeur pour les trois comptes, qui sont des
> fixtures et non des personnes. **Variable absente ⇒ comptes verrouillés** :
> ils restent visibles comme données de démonstration, mais `POST /api/auth/login`
> répond `401 demo_locked`. Les trois valeurs qui figuraient dans cette page,
> dans le README et dans le bundle client sont considérées comme **compromises**
> (elles ouvraient de vraies sessions sur l'API) : ne les réutilisez nulle part.
> En **mode local** (sans API), les comptes du navigateur s'ouvrent avec la
> valeur `DEMO_LOCAL_PASSWORD` de `src/shopStore.js` — elle ne donne accès qu'à
> ce bac à sable, jamais à une instance déployée.
