# Gerber AccuMark: DXF-Import – Naht und Notches sichtbar machen

Der **ASTM-DXF-Export** nutzt dieselbe **Header-/Skalierungslogik** wie **AAMA-DXF**. Struktur nach **ASTM D6673** / AccuMark: Kontur **Layer 1** + Kopie **84** (geschlossene POLYLINE mit **70=1**), Naht **14** + Kopie **87**, **Fadenlauf** als **LINE** auf **Layer 7**, **Kerben** als **LINE** auf **4** (+ Duplikat **5**) und attributierte **POINT**-Kerben (Strich auf **4**, V-Kerbe zusätzlich **82**), Hilfs-**POINT** auf **Layer 2**, alles im **BLOCK** mit Flag **70 = 64**.

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
| 4, 5  | Kerben (LINE + POINT; Duplikat auf 5) |
| 7     | Fadenlauf (Grain Line) |
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
