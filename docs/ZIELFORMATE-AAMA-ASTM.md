# Zielformate: AAMA-DXF und ASTM-DXF

Dieses Dokument beschreibt die **Zielformate** des TrimTex-Projekts: **AAMA-DXF** und **ASTM-DXF**. Es geht um **Textil-/Schnittmuster-Daten** (2D Pattern), nicht um allgemeines CAD-DXF.

---

## 1. Warum AAMA und ASTM?

- **Austausch:** Standards für den Austausch von Schnittmustern zwischen CAD-Systemen und Zuschnittanlagen (Nesting, Cutting).
- **Branche:** Bekleidung, Automotive-Textil (z. B. Sitzbezüge), technische Textilien.
- **Inhalt:** Neben Konturen (Cut/Seam) auch **Notches** (Kerben zur Ausrichtung), **Drills**, **Fadenlauf**, Metadaten pro Teil.

---

## 2. AAMA-DXF (kurz)

- **Herkunft:** American Apparel Manufacturers Association.
- **Idee:** Normales DXF reicht für Pattern-Austausch nicht aus. AAMA legt fest:
  - **Blöcke** für einzelne Schnittteile (Pattern Pieces).
  - **Layer** für Werkzeugpfade / Funktionen (Schneiden, Markieren, …).
  - Mehrere Teile in einer Datei für automatisches Nesting und Zuschnitt.
- **Für uns:** DXF-Export so aufbauen, dass wir später AAMA-konforme Blöcke und Layer ausgeben können.

---

## 3. ASTM-DXF (z. B. ASTM D6673-10)

- **Herkunft:** ASTM International (Standard D6673-10 u. ä.).
- **Struktur:** Definiert **feste Layer-Nummern** für bestimmte Informationen (nicht nur Namen wie CUT/SEAM).
- **Wichtige Layer (Auszug):**
  - **Layer 4:** Notches (Kerben).
  - **Layer 80:** T-Notch (T-förmiger Schlitz).
  - **Layer 81:** Castle-Notch (U-förmig, rechteckiges Ende).
  - **Layer 82:** Check-Notch (V-förmig, rechtwinklig zur Kante).
  - **Layer 83:** U-Notch (U-förmig, halbkreisförmiges Ende).
- **Weitere:** Blöcke pro Schnittteil, Grading, Nahtlinien, Fadenlauf, Beschriftungstext.
- **Für uns:** Notch-Typen und Layer-Nummern im Datenmodell und im Export berücksichtigen, sobald wir ASTM-konform exportieren wollen.

---

## 4. Was „DXF mit Infos wie Notches“ konkret heißt

- **DXF** = Drawing Exchange Format (AutoCAD-Format): Linien, Polylines, Kreise, Blöcke, Layer.
- **AAMA/ASTM:** Gleiche DXF-Basis, aber **feste Bedeutung** von Layern und ggf. Blöcken:
  - Welche Layer für Schnittlinie, Nahtlinie, Notches, Bohrlöcher, Fadenlauf, Text.
  - Welche Notch-Typen es gibt und wie sie geometrisch dargestellt werden (V, T, Castle, Check, U).
- **Rechtsicher/Standard:** AAMA und ASTM sind anerkannte Spezifikationen; „rechtsicher“ im Sinne von: industrieüblich und vertraglich referenzierbar (z. B. „Lieferung als AAMA-DXF“).

---

## 5. Beispieldateien (geplant)

In den nächsten Tagen werden **Beispieldateien** (AAMA- und/oder ASTM-DXF) ins Projekt gegeben. Daraus können wir ableiten:

- Exakte Layer-Namen/Nummern.
- Block-Struktur und Benennung.
- Darstellung der Notch-Typen (Entities, Layer).
- Darstellung von Drills, Grain, Text.

Bis dahin orientieren wir uns an der Spezifikation (z. B. ASTM D6673-10) und an der Cursor-Regel `.cursor/rules/zielformat-aama-astm.mdc`.

---

## 6. DXF-Export-Ziel: Außenkontur für den Cutter

**Am Ende des Tages** soll im DXF-Export **genau das** ausgegeben werden, was der **Cutter** (Zuschnittanlage) braucht:

- **Primär: die Außenkontur** (Cut Line / Natline) – die Linie, an der geschnitten wird.
- Weitere Elemente (z. B. Notches, Drills) nur, wenn sie von der Anlage für Markierung/Bohrung genutzt werden.

Die Außenkontur ist die zentrale Information für den Zuschnitt; die restliche DXF-Struktur (AAMA/ASTM) dient dem sauberen Austausch genau dieser Daten.

---

## 7. Bezug zu TrimTex-Phasen

| Phase   | Export / Zielformat |
|--------|----------------------|
| Phase 1 | Einfacher DXF R12, eigene Layer-Namen (CUT, SEAM, NOTCH, DRILL, GRAIN, TEXT). |
| Phase 2+ | AAMA-konforme Layer und Block-Struktur; optional ASTM-konforme Layer und Notch-Typen. |

Das Datenmodell (Notches, Drills, Grain, Cut, Seam) wird von Anfang an so geführt, dass der spätere Schritt zu AAMA/ASTM-DXF ohne Bruch möglich ist. **Export-Fokus:** Was der Cutter braucht = Außenkontur (Cut/Natline).

---

*Stand: März 2025. Wird ergänzt, sobald Beispieldateien vorliegen.*
