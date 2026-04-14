# Gerber AccuMark: DXF-Import – Naht und Notches sichtbar machen

Der **ASTM-DXF-Export** aus TrimTex verwendet **Millimeter** (`$INSUNITS` = 4), dieselbe Skalierung wie **AAMA** (`dxfExportScale` × Modell-mm). **Kontur, Naht, Bohrung** liegen in **BLOCKs** mit **INSERT** (AccuMark-kompatibel). **Kerben** kommen zusätzlich als **LINE** auf **Layer 5 und 7** in **ENTITIES** im **Weltkoordinatensystem** (damit sie nicht nur im Block stehen). Die Nahtlinie (Layer 14) hat die **gleiche Stützpunktanzahl** wie die Schnittkontur. Der **Fadenlauf** wird nicht exportiert.

Wenn nach dem ASTM-DXF-Import in Gerber AccuMark **die Nahtlinie und/oder Notches nicht angezeigt werden**, bitte Folgendes prüfen:

## 1. Gerber-Einstellungen (Display)

- **„Hide Seam“ / „Naht ausblenden“**  
  Wenn aktiviert, werden Nahtlinien nicht angezeigt.  
  → In den Anzeige-Einstellungen deaktivieren.

- **„Show Actual Notch Depth“ / „Notch-Tiefe anzeigen“**  
  Notches werden entsprechend ihrer Tiefe dargestellt.  
  → Sicherstellen, dass diese Option aktiviert ist.

## 2. Layer-Sichtbarkeit

Stellen Sie sicher, dass folgende Layer sichtbar bzw. aktiviert sind:

| Layer | Inhalt                         |
|-------|--------------------------------|
| 1     | Schnittlinie (Cut)             |
| 5, 7  | Kerben (Notches; in TrimTex identisch dupliziert) |
| 14    | Nahtlinie (Sew)                |

## 3. Nahtzugabe in TrimTex setzen

Ohne Nahtzugabe wird keine Nahtlinie (Layer 14) exportiert.

- Wählen Sie das Schnittteil aus.
- Klicken Sie auf „Nahtzugabe“ und tragen Sie den Wert (z. B. 8 mm) ein.
- Dann ASTM-DXF exportieren.

## 4. Notches anlegen

Notches müssen vor dem Export im TrimTex-Workspace angelegt sein:

- Werkzeug „Notch“ wählen.
- Auf die gewünschte Kante klicken, um einen Notch zu platzieren.

---

*Stand: April 2026*
