# PC Star — Guide des comptes clients

Boutique pickup **PC Star Informatique**, El Makari Les Castors, Oran.

## Démarrer

```bash
npm install
npm run start:api    # backend :8787 (multi-device: commandes + admin)
npm run dev          # site :5173 (proxy /api → API)
```

Sans API, le site marche en mode local (`○ local`). Avec API (`● API`), l'admin voit les commandes depuis un autre PC/téléphone.

## Comptes de démarrage

| Rôle | E-mail | Mot de passe | Peut faire |
|------|--------|--------------|------------|
| **Admin (magasin)** | `pcstar.info31@gmail.com` | `Czyx8f9g2jK3mWZ5R2Tn` | Desk list, Admin (ajouter / masquer produits, clients) |
| Client Karim | `karim.oran@demo.dz` | `Qw3nt9zKp7mL2jX8vNb` | Panier, réserve, profil simple |
| Client Amina | `amina.castors@demo.dz` | `Yx4nBst8mP3kL7jR2vWz` | idem |
| Client Yacine | `yacine.pc@demo.dz` | `Wz6kLm9pN3tQ8jX2cYvB` | idem |

⚠️ **À changer avant la mise en production** — ces mots de passe sont temporaires.

Tu peux aussi taper e-mail + mot de passe à la main, ou **Créer un compte**.

## Admin (magasin)

1. Connexion admin.
2. Menu **Admin** → ajouter un produit, masquer un SKU, gérer clients.
3. Menu **Liste comptoir** → réservations (code `PS-xxxxxx`, tél, créneau).
4. Multi-device : lance l'API ; un client réserve sur son téléphone → le desk du magasin recharge la liste.

## Client

1. Connexion client (ou invité au panier).
2. Boutique / Recherche / **Config PC** (builder + alertes surchauffe / socket).
3. Panier → nom + mobile **05 Ooredoo / 06 Mobilis / 07 Djezzy** → réserver.
4. Montrer le code **PS-…** au comptoir, payer en DA (espèces au retrait).

## Guide (admin only)

La page **Guide / Help** n'apparaît et n'est accessible **que** pour le compte admin.

## Thème & langues

- **☀ / ☾ / ◐** : clair / sombre / système.
- **ع / FR / EN** : arabe (RTL), français, anglais.

## OAuth Google / Meta (livré — mode local par défaut)

- Boutons **« Continuer avec Google / Meta »** dans le login (`src/AuthPanel.jsx`).
- Par défaut `OAUTH_DEMO=1` : écran de consent **simulé** par l'API, qui crée un **vrai** lien de compte + vraie session (rien à configurer).
- En prod réel : `OAUTH_DEMO=0` + clés (`GOOGLE_CLIENT_ID/SECRET`, `META_APP_ID/SECRET`) + `OAUTH_REDIRECT_BASE` — l'UI ne change pas.
- Déconnexion du provider : **Profil → unlink** (`POST /api/oauth/unlink`).

## Ce qui a été retiré (volontairement)

- Avatars / couleurs d'accent profil  
- Comparateur de produits  
- Orbit 3D  
- SMS démo  

## Fichiers utiles

- `README.md` — vue d'ensemble  
- [docs/README.md](README.md) — index doc (portfolio, architecture, problèmes/solutions)  
- `docs/GUIDE-COMPTES.md` — ce guide  
- `docs/GUIDE-COMPTES-AR.md` — العربية  
- `docs/GUIDE-COMPTES-FR.md` — français court