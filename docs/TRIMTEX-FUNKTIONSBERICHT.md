# TrimTex — Funktionsbericht (Gesamtüberblick)

**Zweck:** Überblick über **alle sichtbaren und zentralen technischen Funktionen** der Anwendung (Stand laut Codebasis `src/`, Version siehe `package.json`).  
**Abgrenzung:** Kein DXF-Parser-Detailbericht — dazu `docs/DXF-IMPORT-BERICHT-EXTERN.md` und `docs/DXF-IMPORT-FREMDSYSTEME.md`.

---

## 1. Aufbau der Oberfläche

| Bereich | Komponente | Funktion |
| --- | --- | --- |
| Oben | `Toolbar.tsx` | Hauptmenü (Datei, Erzeugen, …), DXF-/JSON-Import-Trigger, Export-Untermenü, Werkzeug-Anzeige, Kerben-Preset-Auswahl |
| Links | `Sidebar.tsx` | Teileliste: Auswahl, Doppelklick Name → Eigenschaften, Teil löschen, „+ Teil hinzufügen“, Ein-/Ausklappen |
| Mitte | `WorkspaceCanvas.tsx` | Zeichnen, Bearbeiten, Zoom/Pan, Naht-/Profil-Interaktion, Fensterauswahl u. a. |
| Rechts (optional) | `WorkspaceAiChatPanel.tsx` | KI-Chat zum Workspace (Vorschläge anwenden, Hilfe), eigener API-Key |
| Unten | `DesignBar.tsx` | Schalter: Kontur bearbeiten, Raster, Punkte, Laufrichtung, Kerben, Bohrungen, interne Linien, Teilnamen, Profile, Konturmaße, Notizen, Kontur-Vorher-Ansicht |
| Schwebend am Canvas | `CanvasToolbar.tsx` | Rückgängig/Wiederholen, Werkzeuge, Nahtzugabe-Klickmodus, Kante-NZ, Lineal, Waagerecht, Symmetrie, Layout-Hinweise |

Globale Modals/Dialoge werden teils in `App.tsx`, teils in `Toolbar.tsx` eingebunden (siehe Abschnitt 6).

---

## 2. Menü **Datei**

| Funktion | Kurzbeschreibung |
| --- | --- |
| Projekt speichern (JSON) | Arbeitsfläche, Einstellungen, Kerb-Voreinstellungen, ggf. Hintergrundbild als TrimTex-Projektdatei |
| Projekt öffnen (JSON) | Lädt gespeichertes Projekt (`loadProjectFromFile`) |
| DXF importieren | R12-ASCII-DXF; mehrere Teile möglich; Warnungen als Toast |
| **Exportieren** → DXF (einfach) | Einfacher DXF-Export |
| → AAMA-DXF (.aam) | Branchenformat |
| → ASTM-DXF (Gerber) | Branchenformat |
| Einstellungen | Öffnet `SettingsModal` |

---

## 3. Menü **Erzeugen**

| Funktion | Kurzbeschreibung |
| --- | --- |
| Digitalisieren (`D`) | Kontur per Klicks/Kurvenhandles; Abschluss über Store (`finishDigitize` / Abbruch) |
| Bild einfügen | Raster-Hintergrund skalieren/positionieren (Session), Digitalisieren auf Bild möglich |
| Rechteck | Neues Teil als Rechteck |
| Punkt (`P`) | Punkt auf Kontur |
| Kurvenpunkt (`C`) | Punkt einfügen / Linie ↔ Bézier |
| Notch (`N`) | Kerbe setzen (Preset aus Toolbar) |
| Kante (`K`) | Kantenbezogene Aktionen (Werkzeug) |
| **Interne Elemente** | Linie, Kreis, Bohrloch, Steppung (intern) |
| **Konfigurator** | T-Shirt-Instanz, Rock-Generator-Modal, „Konfigurator bearbeiten“ |

---

## 4. Menü **Bearbeiten**

| Funktion | Kurzbeschreibung |
| --- | --- |
| Auswahl / Verschieben (Pan) | Navigation und Auswahl |
| Linie, Notch, Bohrung, Notiz | Werkzeuge analog Erzeugen |
| Kante, Maßstab (`M`) | Kantenwerkzeug; Maßstab-Dialog (`MassstabModal`) |
| Teil-Symmetrie (Spiegelachse) | Zwei-Punkt-Achse, Seitenwahl (`pieceSymmetryState`); erfordert Kontur-Modus |
| Komplette Teile löschen (Fensterauswahl) | Batch: nur vollständig im Rahmen erfasste Teile |
| Nahtzugabe 5 mm | Schnelloffset auf Auswahl (`applyOffset`) |
| 90° drehen (`R`) | Pro ausgewähltem Teil |
| An Laufrichtung ausrichten (`A`) | `alignPieceToGrain` |

---

## 5. Menü **Naht**

| Funktion | Kurzbeschreibung |
| --- | --- |
| Nahtzugabe … (`S`) | Klick auf Kontur setzt NZ (Dialog `nahtzugabeDialogPieceId`) |
| Nahtzugabe pro Kante … (`L`) | `edgeSeamPickingActive` — unterschiedliche NZ pro Kante |
| Nahtzugabe entfernen | Für ausgewählte Teile mit vorhandener NZ |
| Nahtzuordnung | Zwei-Klick-Modus: Kante Teil A → Kante Teil B (`nahtzuordnungMode`) |

Zugehörige Modals: `SeamAdjustmentModal` (Kerben an Naht anpassen), `SeamAssignmentMetaModal` (Reihenfolge, Nahtart, …).

---

## 6. Weitere Menüs und globale UI

| Menü | Inhalt |
| --- | --- |
| **Profil** | Profil zuordnen (Werkzeug `profil` → `ProfileAssignmentDialog`) |
| **Material** | Platzhalter „In Entwicklung“ |
| **Stückliste** | Stückliste anzeigen → `StuecklisteModal` (Materialübersicht, Nähplan, PDF-Export) |
| **Prüfen** | Geschlossene Kontur prüfen; alle Teile prüfen |
| **Hilfe** | Anleitung (`HelpModal`, F1), Tastenkürzel (`ShortcutListModal`) |

**Weitere Dialoge:** `SettingsModal`, `ConfiguratorModal`, `RockGeneratorModal`, `PiecePropertiesModal` (Name, Nummer, Füllung, …), `ErrorBoundary` für Fehlerfänger.

---

## 7. Store-Zustand und zentrale Fähigkeiten (`useStore.ts`)

Gruppiert (nicht jede Zeile einzeln — vollständige API im Type `Store`):

- **Workspace:** Teile (`PatternPiece`), Ansicht (`view`), Nahtzuordnungen, Notizen am Teil, Profil-Zuordnungen.
- **Auswahl & Werkzeug:** `selectedPieceIds`, `selectedPoint`, `tool`, Modus-Flags (Lineal, NZ-Picking, Symmetrie, Nahtzuordnung, …).
- **Teile:** anlegen, aktualisieren, löschen, verschieben, drehen, Pivot, spiegeln entlang Fadenlauf, Symmetrie entlang Achse, `rotatePiece90`, `alignPieceToGrain`, `alignPieceEdgeHorizontal`.
- **Kontur:** Punkte einfügen/verschieben/löschen, Segmente offsetten, Bézier ↔ Linie, weiche Ecken, `recomputeSeamLine`, Innenlinien, Kreise, Rechtecke.
- **Kerben & Bohrungen:** hinzufügen, ändern, Anker, Presets (`notchSettings`, `activeNotchPresetIndex`).
- **Nahtzugabe:** globaler Offset, entfernen, pro Kante, Validierung.
- **Digitalisieren & Bild:** `digitizeState`, `imageDigitizeSession`, Position, Maßstab mm/Pixel, Sperre.
- **Nahtzuordnung & Profil:** Zuordnungen anlegen/entfernen, Metadaten, Profil-Zuweisungen CRUD, Dialog-IDs.
- **DXF-Einstellungen (Import):** Extra-Layer, Skala, V-Kerben, Naht erzeugen, NZ-mm.
- **DXF-Export-Skala:** `dxfExportScale`.
- **Projekt:** `loadProjectFromFile`, `updateWorkspace` (Name, …).
- **Notizen:** `addWorkspaceNote`, `updateWorkspaceNote`, `removeWorkspaceNote`.
- **Fensterauswahl (Batch):** Filter, Ziele, Highlights, weiche Ecken setzen, gefiltertes Löschen, komplette Teile im Rahmen löschen.
- **Konfigurator:** Instanzen, Parameter, Regenerierung einzelner Teile.
- **UI:** Modals ein/aus, Toast, Canvas-Theme hell/dunkel, Sidebar collapsed.
- **Rückgängig:** `zundo` / `temporal` — `undoAction` / `redoAction` (in `CanvasToolbar`).

Hilfsfunktion exportiert: `digitizeNodesToCurves`, `exitAllModes` (alle Werkzeug-/Picking-Modi beenden).

---

## 8. Import, Export, Persistenz

| Art | Technik / Datei |
| --- | --- |
| Projekt JSON | `persistence/trimtexProjectJson.ts` — Serialisierung/Parsing, Dateiname-Vorschlag |
| DXF Import | `dxf/dxfImporter.ts` u. a. |
| DXF Export | `dxf/dxfWriter.ts`, `dxf/aamaWriter.ts`, `dxf/astmWriter.ts` |
| Stückliste PDF | `bom/stuecklistePdf.ts`, Nähplan `bom/naehplan.ts` |

---

## 9. KI-Funktionen

| Bereich | Beschreibung |
| --- | --- |
| Workspace-Chat | `WorkspaceAiChatPanel` + `services/workspaceChatAi.ts` + `workspace/applyWorkspaceChatProposal.ts` — strukturierte Aktionen (z. B. Rechteck, Kreis, Kerbe, Bohrung, Nahtzuordnungen löschen, …) |
| Konfigurator-Chat | `ConfiguratorAiChatPanel.tsx` — Chat im Konfigurator-Kontext |

Es wird ein OpenAI-kompatibler API-Key in der UI eingetragen (lokal im Panel-State; keine Cloud-Pflicht durch die App selbst).

---

## 10. Geometrie- und Hilfsmodule (ohne vollständige Liste)

Wesentliche Ordner: `src/geometry/` (Offsets, Kurven, Symmetrie, Schnitt/Naht-Ableitung), `src/dxf/` (Parser, Import, Export), `src/symmetry/` (Symmetrie-Anwendung auf Teile), `src/workspace/` (Chat-Anwendung).

---

## 11. Tests und Qualitätssicherung

- Unit-Tests u. a. unter `src/**/*.test.ts` (Vitest), z. B. DXF-Import, Symmetrie, Store-Hilfen.
- Skripte: `npm test`, `npm run lint`, `npm run build`.

---

## 12. Pflegehinweis

Dieses Dokument ist eine **Funktionslandkarte**. Bei neuen Menüpunkten, Werkzeugen oder Store-Methoden sollten die Abschnitte **2–7** und die Tabelle in **1** mitaktualisiert werden, damit der Bericht wieder mit dem Produkt übereinstimmt.

**UX-Richtung (Vision, kein Ist-Zustand):** Strategische Hinweise zu weniger permanenter Toolbar, mehr Kontext am Objekt und optional KI als Aktionsvorschläge sind in `docs/ENTWICKLER-CODE-REVIEW-UNKLARHEITEN.txt` als **LOP-070** festgehalten (für Roadmap und Code-Reviews).
