# PC Star — Guide des comptes démo

Boutique pickup **PC Star Informatique**, El Makari Les Castors, Oran.

## Démarrer

```bash
npm install
npm run start:api    # backend :8787 (multi-device: commandes + admin)
npm run dev          # site :5173 (proxy /api → API)
```

Sans API, le site marche en mode local (`○ local`). Avec API (`● API`), le master voit les commandes depuis un autre PC/téléphone.

## Comptes démo — comment entrer

1. Ouvre le site.
2. Clique **Connexion** / **دخول** / **Log in** (ou page **Guide**).
3. **Clique une ligne** dans « Comptes démo » → connexion immédiate.

| Rôle | E-mail | Mot de passe | Peut faire |
|------|--------|--------------|------------|
| **Master** (magasin) | _`MASTER_EMAIL`_ | _`MASTER_PASSWORD`_ | Desk list, Admin (ajouter / masquer produits, clients) |
| Client Karim | `karim.oran@demo.dz` | _variable `DEMO_PASSWORD`_ | Panier, réserve, profil simple |
| Client Amina | `amina.castors@demo.dz` | _variable `DEMO_PASSWORD`_ | idem |
| Client Yacine | `yacine.pc@demo.dz` | _variable `DEMO_PASSWORD`_ | idem |

Tu peux aussi taper e-mail + mot de passe à la main, ou **Créer un compte**.

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

> **Compte maître (magasin) :** il n'est plus publié ici. Il est défini par les
> variables d'environnement `MASTER_EMAIL` et `MASTER_PASSWORD` (voir
> `.env.example` et `docs/DEPLOY-VERCEL.md`). Les identifiants qui figuraient
> dans cette page et dans le code sont considérés comme **compromis** et
> doivent être changés — les retirer du dépôt ne suffit pas.


## Master (magasin)

1. Connexion master.
2. Menu **Admin** → ajouter un produit, masquer un SKU, gérer clients.
3. Menu **Liste comptoir** → réservations (code `PS-xxxxxx`, tél, créneau).
4. Multi-device : lance l’API ; un client réserve sur son téléphone → le desk du magasin recharge la liste.

## Client

1. Connexion client (ou invité au panier).
2. Boutique / Recherche / **Config PC** (builder + alertes surchauffe / socket).
3. Panier → nom + mobile **05 Ooredoo / 06 Mobilis / 07 Djezzy** → réserver.
4. Montrer le code **PS-…** au comptoir, payer en DA (espèces au retrait).

## Guide (master only)

La page **Guide / Help** n’apparaît et n’est accessible **que** pour le compte master.

## Thème & langues

- **☀ / ☾ / ◐** : clair / sombre / système.
- **ع / FR / EN** : arabe (RTL), français, anglais.

## OAuth Google / Meta (livré — mode démo par défaut)

- Boutons **« Continuer avec Google / Meta »** dans le login (`src/AuthPanel.jsx`).
- Par défaut `OAUTH_DEMO=1` : écran de consent **simulé** par l’API, qui crée un **vrai** lien de compte + vraie session (rien à configurer).
- Le flux OAuth réel n’est pas encore activable : les callbacks Google/Meta seront livrés en phase 2 du [plan de remédiation](PLAN-REMEDIATION-AUDIT-2026-09-17.md). Garder `OAUTH_DEMO=1` jusque-là.
- Déconnexion du provider : **Profil → unlink** (`POST /api/oauth/unlink`).

## Ce qui a été retiré (volontairement)

- Avatars / couleurs d’accent profil  
- Comparateur de produits  
- Orbit 3D  
- SMS démo  

## Fichiers utiles

- `README.md` — vue d’ensemble  
- [docs/README.md](README.md) — index doc (portfolio, architecture, problèmes/solutions)  
- `docs/GUIDE-DEMO.md` — ce guide  
- `docs/GUIDE-DEMO-AR.md` — العربية  
- `docs/GUIDE-DEMO-FR.md` — français court  
