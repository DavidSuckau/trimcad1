# Gerber AccuMark: DXF-Import – Naht und Notches sichtbar machen

Der **ASTM-DXF-Export** nutzt dieselbe **Header-/Skalierungslogik** wie **AAMA-DXF**. Struktur nach typischem **AccuMark-DXF**: Kontur **Layer 1** + identische Kopie **84**, Naht **14** + Kopie **87**, **POINT** auf **Layer 2** an Kontur-/Naht-Vertices sowie an Kerben-Enden; **Kerben** als **LINE** zuerst **7**, dann **5** (Duplikat), alles im **BLOCK** mit Flag **70 = 64**. Der **Fadenlauf** wird nicht exportiert.

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
| 1, 84 | Schnittlinie (Cut + AccuMark-Kopie) |
| 2     | Hilfspunkte (Vertices / Kerben-Enden) |
| 5, 7  | Kerben (LINE: zuerst 7, dann 5) |
| 14, 87 | Nahtlinie (Sew + Kopie)     |

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
