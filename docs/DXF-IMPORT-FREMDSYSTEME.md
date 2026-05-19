# DXF-Import aus Fremdsystemen (TrimTex)

## Unterstütztes Format

- **AutoCAD R12 ASCII** (`AC1009`) mit Klartext-Zeilen. Das ist der übliche Branchenstandard für Textil-/Cutter-DXF.
- **Binär-DXF** und **neuere DXF-Versionen** (z. B. `AC1015+`) werden nicht vollständig gelesen; die App weist darauf hin.
- **Einheiten:** `$INSUNITS`: `5` = mm (empfohlen), `4` = cm (Koordinaten werden mit 10 multipliziert).

## Erkannte Layer (Auszug)

Die Importlogik nutzt feste Layer-Sets (siehe `src/dxf/dxfImportLayers.ts`) und optional **zusätzliche Schnitt-Layer** aus den Einstellungen (kommagetrennt).

| Rolle | Typische Namen / Nummern |
|-------|---------------------------|
| Schnittkontur (Außenlinie) | `CUT`, `1`, `BOUNDARY`, `NATLINE`, `OUTLINE`, `CONTOUR`, `PIECE`, `PATTERN`, … (Standard **ohne** AutoCAD-Layer `0` — bei Bedarf unter „Zusätzliche DXF-Schnitt-Layer“ eintragen) |
| Nahtlinie | `SEAM`, `14`, `SEW`, `NAHT` |
| Kerben (LINE/POINT) | `4`, `5`, `80`–`83`, `NOTCH` (POINT mit Gruppen 30/39/50) |
| Interne Linien | `8`, `INTERNAL`, offene Polylines/Lines innerhalb der Kontur |
| Bohrungen | `DRILL`, `13`, `HOLE` |
| Fadenlauf | `GRAIN`, `7` |
| Hilfspunkte (ignoriert) | `2` (ASTM Vertex-Hilfen) |

Hersteller verwenden abweichende Namen: dann **Einstellungen → Zusätzliche DXF-Schnitt-Layer** eintragen oder die Datei in der Quelle als R12 mit den obigen Layern exportieren.

## Kerben (Notches)

1. **Geometrisch** in der Schnitt-Polylinie (kurze V-Einbuchtung), siehe `docs/DXF-MASTER-SPEZIFIKATION.txt`.
2. **Als LINE** auf den Kerben-Layern (u. a. ASTM).
3. **LWPOLYLINE mit Bulge** (Bögen zwischen Stützpunkten) wird in eine feinere Polylinie aufgelöst.

## Deduplizierung und innere Konturen

1. **Exakt (Hash):** Geschlossene Schnittkonturen mit gleichem kanonischem Hash (Rundung, Startpunkt/Umlauf egal) werden zu einem Entwurf zusammengeführt; es bleibt der **zuerst** in der Pipeline stehende Entwurf (üblicherweise **Block/INSERT** vor Modellraum).
2. **Nahezu gleich (Near-Match):** Zusätzlich werden Paare erkannt, bei denen Breite/Höhe der Bounding-Box, Polygonfläche und Schwerpunkt **eng** beieinander liegen (je ±2 %) und die Bounding-Boxes **stark überlappen** — typisch für minimal verschobene oder gerundete Kopien. Auch hier gewinnt der früher in der Liste stehende Entwurf.
3. **Verschachtelt (innen):** Geschlossene Konturen **vollständig innerhalb** einer größeren Außenkontur werden **kein zweites Teil**, sondern als **interne Linien** dem äußeren Teil zugeordnet (Punkt-in-Polygon + Flächenverhältnis).

Zuordnung von Kerben, Bohrungen, internen Linien/Kreisen und Grain erfolgt per **Schnitt-Polygon** (nicht nur Bounding-Box).

In allen Fällen erscheinen Hinweise in `result.warnings`. Der Fallback-Import (wenn kein bekannter Schnitt-Layer) berücksichtigt Layer `0` ebenfalls nicht.

## Bekannte Grenzen

- **SPLINE**, **ELLIPSE** und andere erweiterte Entities: nicht importiert; bei Vorhandensein erscheint eine Hinweiszeile nach dem Import.
- **Kontur nur aus lose verketteten LINE/ARC** ohne Polylinie: ggf. nicht als geschlossenes Teil erkannt — in der Quelle als Polylinie exportieren.

## Tests

Automatisierte Mindestbeispiele liegen als Strings in `src/dxf/dxfImport.test.ts` (Vitest).
