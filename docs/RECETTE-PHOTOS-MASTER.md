# Recette médias Master — déploiement photos (phase 4 du plan d'audit)

Cette recette accompagne la mise en production des médias Master. Elle est
l'« action de déploiement » de la phase 4 du
[plan de remédiation](./PLAN-REMEDIATION-AUDIT-2026-09-17.md) : le code est
livré et testé, la validation finale se fait sur Vercel avec le token Blob.

## 1. Prérequis

1. `BLOB_READ_WRITE_TOKEN` configuré dans les variables Vercel (Production).
   Sans ce token, un upload Master répond `upload_storage` : c'est le refus
   voulu — aucune URL éphémère de `/tmp` n'est enregistrée.
2. CSP déjà alignée : `img-src` autorise `'self' data: blob:` et
   `https://*.public.blob.vercel-storage.com`, dans l'API (`server/index.js`)
   comme dans `vercel.json`. Ne pas élargir à d'autres hôtes.

## 2. Scénario de recette (à rejouer à chaque montage de photos)

1. **Charger** — se connecter en maître, ouvrir une fiche, téléverser 2 à 3
   photos (data URLs compressées côté client). La galerie reçue est une liste
   finale : les photos conservées + les nouvelles, bornées à 6.
2. **Vérifier l'affichage** — la fiche publique montre les photos via le proxy
   `/api/upload-file/<chemin>` (la base ne stocke jamais d'URL CDN brute).
3. **Froidir** — redéployer ou attendre un cold start de la fonction, puis
   recharger la fiche : la résolution Blob repart de `blob.list()` sur le
   `pathname` exact, l'image doit s'afficher après la 302 vers le CDN.
4. **Remplacer** — retirer une photo de la galerie et en ajouter une autre :
   l'ancienne doit disparaître de la fiche ET du stockage Blob (cleanup des
   uploads non référencés), sans jamais toucher aux visuels statiques
   (`/catalog/*`, `/photos/*`).
5. **Bornes** — tenter plus de 6 photos, un prix non fini, un SKU vide ou déjà
   utilisé : chaque tentative doit être refusée avec une erreur nommée.

## 3. Visuels de rayon livrés (`public/catalog/*-studio.jpg`)

Les références du catalogue élargi n'ont pas encore de photo par SKU : elles
affichent une **illustration de rayon** (`photoMode: 'category'`, mention
i18n `categoryIllustration*`). Ces visuels sont générés pour PC Star — ils
assurent une vitrine crédible en attendant le shooting réel (ROADMAP phase 3.1)
et restent remplaçables par les vraies photos du magasin.

| Visuel | Rayon couvert |
|---|---|
| `components-studio` | Composants PC et écrans |
| `desktop-studio` | PC de marque, mini PC, all-in-one, serveurs |
| `laptop-studio` | Laptops étudiant / polyvalent |
| `laptop-business-studio` | Laptops pro et reconditionnés |
| `laptop-gaming-studio` | Laptops gaming |
| `laptop-accessories-studio` | Chargeurs, sacs, refroidissement, SODIMM |
| `printer-laser-studio` | Imprimantes laser |
| `printer-ink-studio` | Multifonctions à réservoir |
| `printer-ticket-studio` | Tickets thermiques et étiquettes |
| `printer-studio` | Imprimantes (générique, matricielle) |
| `scanner-studio` | Scanners à plat et à chargeur |
| `toner-ink-studio` | Toners et encres |
| `paper-label-studio` | Papier, rouleaux, étiquettes |
| `pos-studio` | Point de vente : terminal, douchette, tiroir |
| `router-studio` | Routeurs, points d'accès, répéteurs |
| `network-studio` | Switch, adaptateurs, câblage, CPL |
| `ups-studio` | Onduleurs, batteries, multiprises |
| `mobile-studio` | Tablettes, téléphonie, énergie mobile |
| `multimedia-studio` | Webcams, micros, enceintes, VR, création |
| `furniture-studio` | Chaises, bureaux, supports, coffres |

À générer au prochain lot : `tablet-studio`, `projector-studio` (les tablettes
et le vidéoprojecteur restent sur `mobile-studio` / `multimedia-studio`).

## 4. Remplacer une illustration par les vraies photos

1. **Par SKU** — déposer les photos nommées `<sku>.jpg` (≥ 800 px, idéalement
   3 angles) dans `public/photos/` puis `npm run photos:check` (ou `--fix`).
   `photosForProduct()` les expose automatiquement ; mettre à jour la fiche
   (`photoMode` suit : une vraie photo passe le produit en `custom`).
2. **Par rayon** — remplacer le fichier `public/catalog/<groupe>-studio.jpg`
   en conservant le même nom : aucune modification de code nécessaire.
3. **Depuis l'administration** — les uploads Master priment toujours sur les
   visuels statiques ; c'est le chemin recommandé en exploitation.

## 5. Ce que la recette doit prouver

- Aucune photo ne disparaît après un redémarrage/cold start (résolution Blob).
- Aucun objet Blob orphelin après remplacement (cleanup, coût stockage).
- Aucune fiche invalide ne peut être enregistrée (validations création/patch).
- Les illustrations de rayon sont honnêtes : badge « illustration » visible et
  mention PDP, jamais une fausse photo produit.
