# Recette médias Master — galerie catalogue et photos du magasin

Cette recette décrit le comportement actuel des galeries. La validation du
stockage durable se rejoue sur Vercel, avec le stockage Blob configuré.

## 1. Prérequis

- `BLOB_READ_WRITE_TOKEN` configuré dans les variables Vercel (Production).
  Sans ce token, un upload Master répond `upload_storage` : aucune URL
  éphémère de `/tmp` n'est enregistrée en production.
- CSP alignée : `img-src` autorise `'self' data: blob:` et
  `https://*.public.blob.vercel-storage.com`, dans l'API comme dans
  `vercel.json`. Ne pas élargir à d'autres hôtes.

## 2. Les deux sources du catalogue

Décision du client : **conserver les packshots et les photos réelles**.

- Le packshot généré `/photos/pack/<id>.jpg` reste la première image des
  références du catalogue élargi.
- Les vues réelles `/photos/sku/<id>-1.jpg`, `-2.jpg`, `-3.jpg` suivent,
  uniquement lorsqu'elles sont livrées avec leur WebP. Leur disponibilité est
  inventoriée dans `src/catalogSkuViews.js` ; aucun chemin n'est inventé pour
  les écrans qui n'ont pas encore de trio.
- Les anciens visuels `/catalog/*-studio.jpg` restent sur disque pour le
  repli des nouvelles références, mais ne sont pas ajoutés à ces galeries.
- Aucune image n'est supprimée par `photos:wire`. La génération et les
  photographies d'origine restent des sources distinctes.

La fiche produit indique **« Illustration générée »** ou **« Photo catalogue »**
selon l'image sélectionnée, en français ou en anglais. Cette indication suit
le fichier : une galerie éditée par le maître peut conserver les deux sources.
Un upload du magasin n'est jamais étiqueté comme généré.

Les illustrations ne prouvent pas la connectique ou la configuration vendue.
L'audit a notamment relevé des prises US, un socket et des ports inexacts dans
certains packshots, ainsi qu'une photo de portable affichant une autre variante
RAM/SSD. Les fichiers sont conservés conformément au choix du client ; la fiche
rappelle de consulter les caractéristiques et de confirmer la variante au
comptoir. Ajouter des photographies réelles ne corrige pas ces dessins.

## 3. Ajouter des vues au dépôt

Utiliser **l'id de la fiche**, pas son SKU commercial :

1. Livrer `public/photos/sku/<id>-1.jpg` à `-3.jpg`, et les `.webp`
   correspondants. Vérifier visuellement le modèle et la variante avant publication.
2. `npm run photos:check` vérifie les fichiers existants. `npm run photos:fix`
   peut les normaliser ; `node scripts/ingestSkuPhotos.mjs --webp` produit les
   variantes WebP. Ces commandes n'associent pas à elles seules les images à une fiche.
3. `npm run photos:wire` câble les packshots livrés et actualise le manifeste
   des vues du catalogue élargi. Une paire JPG/WebP incomplète n'y entre pas.
4. `npm run photos:wire -- --check` vérifie la synchronisation sans écrire.
   Versionner les images, le câblage et le manifeste ensemble.
5. `npm run photos:audit` distingue les deux sources, liste les références
   sans vue réelle et échoue si un fichier référencé manque.

Une fiche ajoutée par le maître n'a pas de fichiers statiques déduits de son id :
pour elle, utiliser le panneau d'administration.

## 4. Scénario de recette Master

1. **Charger** — ouvrir la fiche, garder ou retirer les images existantes,
   ajouter les photos du magasin. La galerie finale est bornée à six images.
2. **Vérifier** — la fiche publique montre exactement la sélection enregistrée,
   dans son ordre. Aucun trio ni packshot n'est ajouté derrière un upload.
   Les nouvelles photos passent par `/api/upload-file/<chemin>`.
3. **Redémarrer** — redéployer ou attendre un cold start, puis recharger :
   la résolution Blob retrouve le `pathname` exact avant la redirection CDN.
4. **Remplacer** — retirer un upload et en ajouter un autre : l'ancien disparaît
   de la galerie et du stockage Blob s'il n'est plus référencé. Ne jamais
   supprimer un fichier statique `/photos/sku/`, `/photos/pack/` ou `/catalog/`.
5. **Réinitialiser une fiche catalogue** — enregistrer une liste vide restaure
   sa galerie d'origine : packshot et vues réelles disponibles. Une fiche créée
   par le maître n'a pas cette galerie statique à restaurer.
6. **Éprouver les limites** — vérifier la limite de sélection et le budget
   d'upload, puis le refus des prix non finis et des SKU invalides ou en doublon.
7. **Pendant la visite** — sélectionner la dernière vue, puis raccourcir la
   galerie depuis le maître : une vue valide reste affichée. Simuler un échec
   d'image : la galerie passe à la suivante, ou au repère si toutes échouent.

## 5. Contrôles à rejouer

```bash
npm run photos:wire -- --check
npm run photos:audit
npm run build
npm test
```

Les compteurs mesurés restent dans [../README.md](../README.md). Les motifs des
corrections et les limites connues sont dans [BUGS-AND-FIXES.md](BUGS-AND-FIXES.md),
sections LOT P28 et LOT P29.
