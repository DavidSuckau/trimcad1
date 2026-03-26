# DXF-Import aus Fremdsystemen (TrimTex)

## Unterstütztes Format

- **AutoCAD R12 ASCII** (`AC1009`) mit Klartext-Zeilen. Das ist der übliche Branchenstandard für Textil-/Cutter-DXF.
- **Binär-DXF** und **neuere DXF-Versionen** (z. B. `AC1015+`) werden nicht vollständig gelesen; die App weist darauf hin.
- **Einheiten:** `$INSUNITS`: `5` = mm (empfohlen), `4` = cm (Koordinaten werden mit 10 multipliziert).

## Erkannte Layer (Auszug)

Die Importlogik nutzt feste Layer-Sets (siehe `src/dxf/dxfImportLayers.ts`) und optional **zusätzliche Schnitt-Layer** aus den Einstellungen (kommagetrennt).

| Rolle | Typische Namen / Nummern |
|-------|---------------------------|
| Schnittkontur (Außenlinie) | `CUT`, `1`, `BOUNDARY`, `NATLINE`, `OUTLINE`, `CONTOUR`, `PIECE`, `PATTERN`, … |
| Nahtlinie | `SEAM`, `14`, `SEW`, `NAHT` |
| Kerben (LINE) | `4`, `80`–`83`, `NOTCH` |
| Bohrungen | `DRILL`, `13`, `HOLE` |
| Fadenlauf | `GRAIN`, `7` |

Hersteller verwenden abweichende Namen: dann **Einstellungen → Zusätzliche DXF-Schnitt-Layer** eintragen oder die Datei in der Quelle als R12 mit den obigen Layern exportieren.

## Kerben (Notches)

1. **Geometrisch** in der Schnitt-Polylinie (kurze V-Einbuchtung), siehe `docs/DXF-MASTER-SPEZIFIKATION.txt`.
2. **Als LINE** auf den Kerben-Layern (u. a. ASTM).
3. **LWPOLYLINE mit Bulge** (Bögen zwischen Stützpunkten) wird in eine feinere Polylinie aufgelöst.

## Bekannte Grenzen

- **SPLINE**, **ELLIPSE** und andere erweiterte Entities: nicht importiert; bei Vorhandensein erscheint eine Hinweiszeile nach dem Import.
- **Kontur nur aus lose verketteten LINE/ARC** ohne Polylinie: ggf. nicht als geschlossenes Teil erkannt — in der Quelle als Polylinie exportieren.

## Tests

Automatisierte Mindestbeispiele liegen als Strings in `src/dxf/dxfImport.test.ts` (Vitest).
