# Gerber AccuMark: DXF-Import – Naht und Notches sichtbar machen

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

| ASTM Layer | Inhalt                 |
|------------|------------------------|
| 1          | Schnittlinie (Cut)     |
| 4          | Slit-Notches           |
| 7          | Fadenlauf (Grain)      |
| 14         | Nahtlinie (Sew)        |
| 80–83      | Spezial-Notches (V, Castle, T, U) |

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

*Stand: März 2025*
