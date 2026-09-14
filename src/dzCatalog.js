/**
 * Catalogue orienté marché algérien.
 * Prix indicatifs en DA (rayons LICB+, Campus, Digitec, Hardsoft, Ouedkniss 2024–2026).
 * Marques locales / import courant : Spirit of Gamer, Havit, Gamemax, Raidmax,
 * Twinmos, Magma, Xigmatek, Tenda, 1st Player, Ares, Hybrok…
 */

function p(id, sku, name, brand, kind, category, price, stock, short, extra = {}) {
  return {
    id,
    sku,
    name,
    brand,
    kind,
    category,
    price,
    stock,
    rating: extra.rating ?? 4.3,
    reviews: extra.reviews ?? 24,
    related: extra.related || [],
    photos: extra.photos || [],
    short,
    needsKey: extra.needsKey || 'needsDz',
    compat: extra.compat || {},
    origin: 'dz',
    tags: extra.tags || []
  }
}

export const DZ_BRANDS = [
  'Spirit of Gamer',
  'Havit',
  'Gamemax',
  'Raidmax',
  'Twinmos',
  'Magma',
  'Xigmatek',
  'Tenda',
  '1st Player',
  'Ares',
  'Hybrok',
  'Antec',
  'GameNote',
  'Ugreen',
  'TP-Link',
  'DeepCool',
  'Cooler Master'
]

// P21 : les 27 références marquées « dz-hit » ont été retirées à la demande du
// comptoir (suppression de la section « الأكثر مبيعاً في الجزائر » ET de ses
// produits). Les références `related` qui pointaient vers elles ont été
// nettoyées pour ne pas laisser de liens morts sur les fiches produit.
export const DZ_EXTRA = [
  p('sog-rogue6', 'SOG-ROGUE6', 'Spirit of Gamer Rogue VI', 'Spirit of Gamer', 'part', 'case', 16500, 5,
    'Boîtier gamer · mesh', { compat: { form: 'ATX' } }),
  p('sog-deathmatch6', 'SOG-DM6', 'Spirit of Gamer Deathmatch 6', 'Spirit of Gamer', 'part', 'case', 8000, 10,
    'Boîtier entrée · ATX', { compat: { form: 'ATX' }, tags: ['budget'] }),
  p('sog-rogue-one', 'SOG-ROGUE1', 'Spirit of Gamer Rogue One', 'Spirit of Gamer', 'part', 'case', 6900, 9,
    'Boîtier compact budget', { compat: { form: 'ATX' }, tags: ['budget'] }),
  p('sog-demon-seat', 'SOG-DEMON', 'Siège Spirit of Gamer Demon rouge', 'Spirit of Gamer', 'accessory', 'accessories', 38700, 2,
    'Fauteuil gamer · rouge', { tags: ['desk'] }),
  p('sog-proh8', 'SOG-PROH8', 'Casque Spirit of Gamer PRO-H8 RGB', 'Spirit of Gamer', 'accessory', 'accessories', 4500, 10,
    'RGB rainbow · filaire', {}),
  p('sog-m600', 'SOG-M600', 'Souris SoG Xpert M600 sans fil RGB', 'Spirit of Gamer', 'accessory', 'accessories', 6900, 7,
    'Wireless · RGB', {}),
  p('sog-mkh3', 'SOG-MKH3', 'Pack SoG PRO-MKH3 4en1', 'Spirit of Gamer', 'accessory', 'accessories', 9800, 9,
    'Pack entrée gamer', { tags: ['budget', 'combo'] }),
  p('sog-mkh500', 'SOG-MKH500', 'Pack SoG CLS-MKH500 4en1', 'Spirit of Gamer', 'accessory', 'accessories', 13500, 5,
    'Clavier + souris + tapis + casque', { tags: ['combo'] }),
  p('sog-mk3', 'SOG-MK3', 'Combo SoG PRO-MK3 clavier + souris', 'Spirit of Gamer', 'accessory', 'accessories', 6500, 11,
    'Duo budget RGB', { tags: ['budget', 'combo'] }),

  // ——— Havit (très courant, bon rapport Q/P) ———
  p('hav-kb874', 'HAV-KB874L', 'Clavier méca Havit KB874L red switch', 'Havit', 'accessory', 'accessories', 5500, 12,
    'Red switch · noir/blanc', { related: ['hav-ms1003'] }),
  p('hav-kb881', 'HAV-KB881L', 'Clavier méca Havit KB881L 65% red', 'Havit', 'accessory', 'accessories', 5800, 8,
    '65% compact · red switch', {}),
  p('hav-kb275', 'HAV-KB275L', 'Clavier Havit KB275L RGB', 'Havit', 'accessory', 'accessories', 1700, 20,
    'Membrane RGB · entrée', { tags: ['budget'] }),
  p('hav-ms1003', 'HAV-MS1003', 'Souris Havit MS1003 RGB 1200 DPI', 'Havit', 'accessory', 'accessories', 1200, 22,
    'Entrée de gamme RGB', { tags: ['budget'] }),
  p('hav-ms68', 'HAV-MS68', 'Souris Havit MS68 RGB 2400 DPI', 'Havit', 'accessory', 'accessories', 790, 25,
    'Rose / bleu · ultra budget', { tags: ['budget'] }),
  p('hav-kraken', 'HAV-KRAKEN2', 'Souris Havit Kraken Starblaze-2 wireless', 'Havit', 'accessory', 'accessories', 9900, 6,
    'Tri-mode · 26000 DPI · RGB', {}),
  p('hav-combo4m', 'HAV-C4MULTI', 'Combo Havit 4en1 multi color', 'Havit', 'accessory', 'accessories', 14500, 5,
    'Pack premium multi', { tags: ['combo'] }),
  p('hav-combo4w', 'HAV-C4WHITE', 'Combo Havit 4en1 blanc', 'Havit', 'accessory', 'accessories', 12900, 4,
    'Pack blanc', { tags: ['combo'] }),
  p('hav-combo4b', 'HAV-C4BLACK', 'Combo Havit 4en1 noir', 'Havit', 'accessory', 'accessories', 7990, 7,
    'Pack noir', { tags: ['combo'] }),
  p('hav-pb94', 'HAV-PB94', 'Power bank Havit PB94 10000 mAh', 'Havit', 'accessory', 'usb', 2990, 15,
    '10 000 mAh', { tags: ['budget'] }),
  p('hav-pj221', 'HAV-PJ221', 'Vidéoprojecteur Havit PJ221 Smart 1080p', 'Havit', 'accessory', 'accessories', 14900, 3,
    'Smart 1080p', {}),

  // ——— Gamemax / Raidmax / Xigmatek / 1st Player ———
  p('gmx-vp600', 'GMX-VP600', 'Alim Gamemax VP-600W RGB', 'Gamemax', 'part', 'case', 9900, 10,
    '600W · RGB · semi-mod', { compat: { psuWatts: 600 }, tags: ['budget'] }),
  p('gmx-vp700', 'GMX-VP700', 'Alim Gamemax 700W 80+ Bronze', 'Gamemax', 'part', 'case', 12500, 7,
    '700W · Bronze', { compat: { psuWatts: 700 } }),
  p('gmx-inf', 'GMX-INFINITY', 'Boîtier Gamemax Infinity blanc', 'Gamemax', 'part', 'case', 12900, 6,
    'ATX · verre · blanc', { compat: { form: 'ATX' } }),
  p('gmx-vista', 'GMX-VISTA', 'Boîtier Gamemax Vista + alim GE-eco', 'Gamemax', 'part', 'case', 15900, 4,
    'Boîtier + PSU bundle', { compat: { form: 'ATX', psuWatts: 600 }, tags: ['combo'] }),
  p('rdm-v219', 'RDM-V219', 'Boîtier Raidmax Vector V219 ARGB', 'Raidmax', 'part', 'case', 14500, 5,
    'ARGB · noir/blanc', { compat: { form: 'ATX' } }),
  p('1st-blacksir', '1ST-BS', 'Boîtier 1st Player Black Siren', '1st Player', 'part', 'case', 11800, 5,
    'ATX · RGB', { compat: { form: 'ATX' } }),
  p('ares-case', 'ARES-G1', 'Boîtier Ares G1 mesh', 'Ares', 'part', 'case', 9800, 6,
    'Mesh airflow', { compat: { form: 'ATX' }, tags: ['budget'] }),
  p('hyb-case', 'HYB-AIR', 'Boîtier Hybrok Airflow', 'Hybrok', 'part', 'case', 8900, 5,
    'Budget mesh', { compat: { form: 'ATX' }, tags: ['budget'] }),
  p('antec-ax20', 'ANTEC-AX20', 'Boîtier Antec AX20 Elite 4 fans RGB', 'Antec', 'part', 'case', 8900, 6,
    '4 ventilateurs RGB', { compat: { form: 'ATX' } }),

  // ——— RAM / SSD marché DZ (Twinmos, Magma, Team…) ———
  p('mag-ddr5-8', 'MAG-D5-8-48', 'RAM Magma DDR5 8 Go 4800', 'Magma', 'part', 'memory', 11900, 10,
    '8 Go · DDR5 4800', { compat: { memory: 'DDR5' } }),
  p('mag-ddr5-16', 'MAG-D5-16-48', 'RAM Magma DDR5 16 Go 4800', 'Magma', 'part', 'memory', 22500, 8,
    '16 Go · DDR5', { compat: { memory: 'DDR5' } }),
  p('tw-ssd-128', 'TW-128', 'SSD Twinmos 128 Go SATA', 'Twinmos', 'part', 'memory', 3900, 20,
    'SATA 2.5" · entrée', { tags: ['budget'] }),
  p('tw-nvme-512', 'TW-NV512', 'SSD Twinmos NVMe 512 Go', 'Twinmos', 'part', 'memory', 10500, 10,
    'M.2 NVMe', {}),
  p('team-ddr4-16', 'TG-D4-16', 'TeamGroup T-Force DDR4 16 Go 3200', 'TeamGroup', 'part', 'memory', 15500, 9,
    'Kit gamer 16 Go', { compat: { memory: 'DDR4' } }),
  p('team-ddr5-32', 'TG-D5-32', 'TeamGroup Delta RGB DDR5 32 Go', 'TeamGroup', 'part', 'memory', 28500, 6,
    '32 Go RGB DDR5', { compat: { memory: 'DDR5' } }),

  // ——— Réseau DZ (Tenda très vendu) ———
  p('tenda-ac8', 'TENDA-AC8', 'Routeur Tenda AC8 AC1200', 'Tenda', 'accessory', 'accessories', 4500, 12,
    'AC1200 budget', { tags: ['budget'] }),
  p('tenda-u12', 'TENDA-U12', 'Clé Wi-Fi Tenda U12 AC1300', 'Tenda', 'accessory', 'usb', 2800, 14,
    'USB Wi-Fi AC', { tags: ['budget'] }),
  p('tpl-archer', 'TPL-AX23', 'TP-Link Archer AX23 Wi-Fi 6', 'TP-Link', 'accessory', 'accessories', 9800, 6,
    'AX1800', {}),

  // ——— Coolers DeepCool / CM (prix DZ) ———
  p('dc-ag400', 'DC-AG400', 'DeepCool AG400', 'DeepCool', 'part', 'cooling', 5500, 11,
    'Air budget', { compat: { socket: ['AM5', 'LGA1700'] }, tags: ['budget'] }),
  p('dc-ls520', 'DC-LS520', 'DeepCool LS520 240 AIO', 'DeepCool', 'part', 'cooling', 18500, 4,
    'AIO 240 · RGB', { compat: { socket: ['AM5', 'LGA1700'] } }),
  p('cm-212', 'CM-212S', 'Cooler Master Hyper 212 Spectrum', 'Cooler Master', 'part', 'cooling', 6500, 10,
    'Classique air', { compat: { socket: ['AM5', 'LGA1700'] }, tags: ['budget'] }),

  // ——— Manettes / console DZ ———
  p('pad-generic', 'PAD-USB-PC', 'Manette USB PC filaire', 'Generic', 'accessory', 'accessories', 2500, 15,
    'Plug & play Windows', { tags: ['budget'] }),

  // ——— Câbles / Ugreen / desk ———
  p('ug-hdmi', 'UG-HDMI2', 'Câble Ugreen HDMI 2.0 2 m', 'Ugreen', 'accessory', 'usb', 1800, 25,
    '4K60 · tressé', { tags: ['budget'] }),
  p('ug-usbc', 'UG-USBC', 'Câble Ugreen USB-C 1 m', 'Ugreen', 'accessory', 'usb', 900, 30,
    'Charge + data', { tags: ['budget'] }),
  p('flash-64', 'SD-64G', 'Clé USB SanDisk 64 Go', 'SanDisk', 'accessory', 'usb', 1800, 35,
    'USB 3.0', { tags: ['budget'] }),
  p('flash-128', 'SD-128G', 'Clé USB SanDisk 128 Go', 'SanDisk', 'accessory', 'usb', 2900, 20,
    'USB 3.0', {}),
  p('hdd-1t', 'WD-1T-BLUE', 'HDD WD Blue 1 To 3.5"', 'WD', 'part', 'memory', 9500, 10,
    'Stockage massif', { tags: ['budget'] }),
  p('hdd-2t-wd', 'WD-2T-BLUE', 'HDD WD Blue 2 To 3.5"', 'WD', 'part', 'memory', 14500, 6,
    '2 To · 3.5"', { tags: ['budget'] }),

  // ——— Laptops / PC prêts style magasin Oran ———
  p('lap-len-i3', 'LEN-I3-8-256', 'Laptop Lenovo i3 8 Go 256 SSD', 'Lenovo', 'machine', 'laptop', 52000, 5,
    'Entrée études', { tags: ['budget'] }),
  p('lap-dell-i7', 'DELL-I7-16-512', 'Laptop Dell i7 16 Go 512 SSD', 'Dell', 'machine', 'laptop', 98000, 2,
    'Pro / gamer léger', {}),
  p('lap-acer-ry5', 'ACER-R5-16', 'Laptop Acer Ryzen 5 16 Go 512', 'Acer', 'machine', 'laptop', 72000, 3,
    'Polyvalent', {}),
  p('ready-gamer-mid', 'PS-G2', 'PC prêt gamer milieu PC Star', 'PC Star', 'machine', 'ready', 145000, 2,
    'Ryzen 7 · RTX 4070 · 32 Go', {}),
  p('ready-sog', 'PS-SOG', 'PC prêt boîtier Spirit of Gamer', 'PC Star', 'machine', 'ready', 110000, 2,
    'Config magasin · Ghost 5', { tags: ['combo'] }),

  // ——— Cartes mères / CPU entrée marché DZ ———
  p('mb-b450m', 'MSI-B450M', 'MSI B450M Pro-VDH Max', 'MSI', 'part', 'motherboard', 18500, 7,
    'AM4 · mATX · DDR4', { compat: { socket: 'AM4', memory: 'DDR4', form: 'mATX' }, tags: ['budget'] }),
  p('mb-a520m', 'GB-A520M', 'Gigabyte A520M DS3H', 'Gigabyte', 'part', 'motherboard', 16500, 8,
    'AM4 · entrée', { compat: { socket: 'AM4', memory: 'DDR4', form: 'mATX' }, tags: ['budget'] }),
  p('mb-b760m', 'MSI-B760M', 'MSI B760M Mortar WiFi', 'MSI', 'part', 'motherboard', 38500, 5,
    'LGA1700 · DDR5 · mATX', { compat: { socket: 'LGA1700', memory: 'DDR5', form: 'mATX' } }),
  p('cpu-5500', 'AMD-5500', 'AMD Ryzen 5 5500', 'AMD', 'part', 'cpu', 19500, 10,
    '6 cœurs · AM4 budget', { compat: { socket: 'AM4', memory: 'DDR4' }, tags: ['budget'] }),
  p('cpu-12100f', 'I5-12100F', 'Intel Core i5-12100F', 'Intel', 'part', 'cpu', 22000, 8,
    '4c/8t · LGA1700 · DDR4', { compat: { socket: 'LGA1700', memory: 'DDR4' }, tags: ['budget'] }),
  p('gpu-1650', 'GTX1650-4', 'NVIDIA GTX 1650 4 Go', 'NVIDIA', 'part', 'gpu', 32000, 6,
    'Entrée 1080p', { compat: { psuMin: 350, form: 'ATX' }, tags: ['budget'] }),

  // ——— Services / desk déjà couverts — packs locaux ———
  p('pack-etudiant', 'PACK-STUD', 'Pack étudiant : SSD 256 + pose + Windows', 'PC Star', 'service', 'repair', 8500, 30,
    'Migration + Win11 + drivers', { tags: ['combo', 'budget'] }),
  p('pack-gamer-desk', 'PACK-GDESK', 'Pack desk gamer Havit 4en1 + pose', 'PC Star', 'service', 'repair', 5500, 20,
    'Combo + config au comptoir', { tags: ['combo'] }),
  p('desk-info', 'SRV-INFO', 'Info comptoir · retrait & paiement espèces', 'PC Star', 'service', 'repair', 0, 99,
    'Gratuit · on explique le retrait au comptoir', { tags: ['desk'] })
]

export const DZ_GUIDES = [
  {
    id: 'dz-budget',
    titleKey: 'guideBudgetTitle',
    bodyKey: 'guideBudgetBody'
  },
  {
    id: 'dz-sog',
    titleKey: 'guideSogTitle',
    bodyKey: 'guideSogBody'
  },
  {
    id: 'dz-pickup',
    titleKey: 'guidePickupTitle',
    bodyKey: 'guidePickupBody'
  }
]


export const WILAYAS_NEAR = [
  'Oran',
  'Mostaganem',
  'Mascara',
  'Sidi Bel Abbès',
  'Tlemcen',
  'Relizane',
  'Aïn Témouchent',
  'Chlef',
  'Autre wilaya'
]
