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
| **Master** (magasin) | `pcstar.info31@gmail.com` | `star31` | Desk list, Admin (ajouter / masquer produits, clients) |
| Client Karim | `karim.oran@demo.dz` | `karim31` | Panier, réserve, profil simple |
| Client Amina | `amina.castors@demo.dz` | `amina31` | idem |
| Client Yacine | `yacine.pc@demo.dz` | `yacine31` | idem |

Tu peux aussi taper e-mail + mot de passe à la main, ou **Créer un compte**.

## Master (magasin)

1. Connexion master.
2. Menu **Admin** → ajouter un produit, masquer un SKU, gérer clients.
3. Menu **Liste comptoir** → réservations (code `PS-xxxxxx`, tél, créneau).
4. Multi-device : lance l’API ; un client réserve sur son téléphone → le desk du magasin recharge la liste.

## Client

1. Connexion client (ou invité au panier).
2. Boutique / Recherche / **Config PC** (builder + alertes surchauffe / socket).
3. Panier → nom + mobile **05 Ooredoo / 06 Mobilis / 07 Djezzy** → réserver.
4. Montrer le code **PS-…** au comptoir, payer en DA (cash / CCP / BaridiMob / 3x).

## Thème & langues

- **☀ / ☾ / ◐** : clair / sombre / système.
- **ع / FR / EN** : arabe (RTL), français, anglais.

## Ce qui a été retiré (volontairement)

- Avatars / couleurs d’accent profil  
- Comparateur de produits  
- Orbit 3D  
- OAuth Google / Meta (login e-mail simple seulement)  
- SMS démo  

## Fichiers utiles

- `README.md` — vue d’ensemble  
- `docs/GUIDE-DEMO.md` — ce guide  
- `docs/GUIDE-DEMO-AR.md` — العربية  
- `docs/GUIDE-DEMO-FR.md` — français court  
