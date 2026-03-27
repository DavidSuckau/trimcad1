# TrimTex – KI-Nutzerhilfe-Quelle

**Zweck:** Zentrale, **benutzerorientierte** Referenz für TrimTex. Gedacht für:

- Einbindung in **KI-gestützte Hilfe** (Chat, Assistent, RAG, Systemkontext)
- Schnelle Antworten auf „Wie geht …?“, „Welche Taste …?“, „Typischer Ablauf …?“

**Nicht** Ersatz für die technische Entwicklerdoku; für Architektur, Datenmodell und DXF-Interna siehe `TRIMTEX-SOFTWARE-DOKUMENTATION.md` und die Projektregeln.

**Canonical Kurztexte in der App:** `src/data/helpEntries.ts` (`HELP_ENTRIES`) – bei UI-Änderungen dort und hier nachziehen.

**Version:** an `package.json` (`version`) anbinden; Inhalt bei größeren Feature-Änderungen aktualisieren.

---

## 1. Produkt in einem Satz

TrimTex ist eine **webbasierte 2D-Schnittmuster-Software**: Teile auf einer Arbeitsfläche in **Millimetern**, Konturen (**Schnitt** / optional **Naht**), Kerben, Bohrungen, Laufrichtung, Export u. a. als **DXF** (einfach, AAMA, ASTM).

---

## 2. Grundbegriffe (für Hilfe-Antworten)

| Begriff | Kurz |
|--------|------|
| **Teil / Schnittteil** | Ein Objekt auf der Arbeitsfläche mit geschlossener Kontur (und weiteren Daten). |
| **Schnittkontur (Cut)** | Außenkante, an der geschnitten wird. |
| **Nahtlinie (Seam)** | Innenkontur bei **Nahtzugabe**; Bearbeitung erfolgt dort nach dem „Seam-as-Master“-Prinzip (siehe technische Doku). |
| **Nahtzugabe** | Abstand zwischen Nahtlinie und Schnittkontur (mm). |
| **Kerbe (Notch)** | Markierung auf der Kontur fürs Zusammenlegen/Nähen; Mindestabstand entlang der Kontur beachten. |
| **Laufrichtung (Grain)** | Richtung des Fadenlaufs am Teil. |
| **Drehpunkt (Pivot)** | Punkt, um den ein Teil gedreht wird; optional Ecke, Kerbe oder Bézier-Mitte. |
| **Arbeitsfläche / Workspace** | Gesamte Zeichenfläche mit Zoom und Verschieben (Pan). |

---

## 3. Oberfläche (Orientierung)

- **Toolbar oben:** Datei, Erzeugen, Bearbeiten, Naht, Export, Hilfe, …
- **Sidebar links:** Teileliste, Teil hinzufügen, Nummer/Name, Nahtzugabe-Hinweise.
- **Hauptbereich:** Zeichenfläche (SVG), Teile interaktiv.
- **DesignBar unten:** Raster, Punkte, Laufrichtung, Kerben, Bohrungen, interne Linien, Teilnamen, Konturmaße, …
- **Hilfe in der App:** Menü Hilfe → Einträge und **Tastenkürzel**; ergänzend F1 / **?**

---

## 4. Tastenkürzel (Übersicht)

Globale und häufige Kürzel (ohne Eingabefokus in Textfeldern). Details und Ausnahmen in `HELP_ENTRIES`.

| Taste | Funktion (Kurz) |
|-------|------------------|
| **F1** / **?** | Hilfe / Anleitung |
| **P** | Werkzeug **Punkt** (Vertex auf Kontur) |
| **C** | Werkzeug **Kurvenpunkt** |
| **N** | Werkzeug **Notch** (Kerbe) |
| **K** | Werkzeug **Kante** (Segment-Menü, Offset, Parallellinie) |
| **M** | Werkzeug **Maßstab / Linial** (je nach Kontext) |
| **D** | **Digitalisieren** starten (ohne Alt) |
| **S** | **Nahtzugabe**-Kontext (Kurz) |
| **5** | **Cut-/Seam-Ansicht** umschalten (Teil unter Maus oder einzeln ausgewählt) |
| **R** | Ausgewählte Teile **90°** drehen |
| **A** | Teil an **Laufrichtung** ausrichten |
| **F** | Notch **verankert / frei** (wenn Kerbe unter Maus) |
| **Entf / Rücktaste** | Ausgewähltes Hilfsobjekt löschen (u. a. Notch, Vertex, Nahtzuordnung je nach Hover) |
| **Escape** | Modi abbrechen, Auswahl aufheben (kontextabhängig) |
| **Mittelklick** | „Alles abbrechen“ (Modi beenden, Werkzeug → Auswahl) |
| **Alt+D** (Mac: **⌥D**) | **Drehpunkt** setzen (Auswahl, Maus auf Ecke/Kerbe/Bézier-Mitte) |
| **Leertaste** | Kontext (z. B. Laufrichtung, Segment-Menü pinnen) – kontextabhängig |

**Segment-Menü** (Kante anfahren): u. a. **O** = Offset, **P** = Parallellinie (intern) – **P** hier anders als globales Punkt-Werkzeug.

---

## 5. Typische Vorgehensweisen (Workflows)

### 5.1 Neues Teil und Kontur

1. **Erzeugen → Teil hinzufügen** oder Sidebar **+**.
2. Kontur aufbauen: **Rechteck**, **Linie**, **DXF importieren**, **Digitalisieren** oder **Punkt**/**Kurvenpunkt** zum Verfeinern.
3. Prüfen: **Prüfen → Geschlossene Kontur** (siehe Menü).

### 5.2 Nahtzugabe

1. Teil auswählen.
2. **Naht → Nahtzugabe …** oder **S** / Menü **Nahtzugabe 5 mm** (wenn angeboten).
3. **Nahtlinie** bearbeiten; **Schnittkontur** folgt (Konzept Seam-as-Master – technische Details in der Entwicklerdoku).

### 5.3 Kerbe setzen

1. Werkzeug **Notch** (**N**) oder Menü.
2. Auf der Kontur positionieren; Abstände zu anderen Kerben beachten (App warnt bei zu geringem Abstand).
3. Optional: **F** mit Hover auf Kerbe = **Verankerung** umschalten.

### 5.4 Teil drehen mit festem Drehpunkt

1. **Auswahl**-Werkzeug.
2. Teil auswählen.
3. Mauszeiger auf **Ecke**, **Kerbe** oder **Bézier-Mitte** (grüner Punkt, wenn Punkte sichtbar).
4. **Alt+D** (**⌥D** am Mac) – Drehpunkt (Kreuz) springt dorthin.
5. Drehen am **blauen Drehgriff** am Teil.

### 5.5 DXF exportieren

1. **Datei → Exportieren** → gewünschtes Format (**einfach**, **AAMA**, **ASTM**).
2. Vorher ggf. **Einstellungen** prüfen (Menü Datei).

### 5.6 Nahtzuordnung (zwei Kanten)

1. **Naht → Nahtzuordnung** aktivieren.
2. Erste Kante auf Teil A, zweite auf Teil B wählen (genaue Interaktion: in der App; Innenseite der Kante beachten).

### 5.7 Kante: Segment verschieben oder Parallellinie

1. Werkzeug **Kante** (**K**).
2. Segment anfahren → **Segment-Menü** (Leertaste zum Pinnen).
3. **O** = Offset in mm, **P** = Parallellinie als interne Linie (nur im Segment-Menü).

### 5.8 DXF importieren

1. **Datei → DXF importieren …**, Datei wählen.
2. Importierte Teile erscheinen auf der Arbeitsfläche; ggf. Teilnummern in der Sidebar prüfen.
3. Bei Problemen mit Fremdsystemen siehe `docs/DXF-IMPORT-FREMDSYSTEME.md` und `GERBER-DXF-IMPORT-HINWEISE.md` (eher technisch).

### 5.9 Digitalisieren

1. **D** (ohne Alt) oder **Erzeugen → Digitalisieren** – **Alt+D** startet **kein** Digitalisieren (das ist Drehpunkt).
2. Kontur durch Klicks setzen, Handles optional ziehen; **Escape** bricht ab.
3. Abschluss erzeugt eine geschlossene Kontur (Details in der App).

### 5.10 Hintergrundbild

1. **Erzeugen → Bild einfügen**; Bild positionieren und skalieren.
2. Auswahlwerkzeug: Bild anklicken zum Verschieben; **Entf** entfernt das Bild; **Escape** hebt nur die Auswahl auf (Bild kann sichtbar bleiben).

### 5.11 Bohrung / interne Elemente

1. Über **Erzeugen → Interne Elemente** bzw. **Bearbeiten** (Bohrung, Kreis, Steppung, Linie als interne Linie).
2. Sichtbarkeit: DesignBar **Interne Linien** / **Bohrungen**.

### 5.12 Strecke messen (Linial)

1. Werkzeug **Maßstab** (**M**) bzw. Toolbar **Linial**.
2. Erster Klick = Start, zweiter Klick = Ende; Anzeige in **mm**.

### 5.13 Laufrichtung ändern oder ausrichten

1. Laufrichtungspfeil einblenden (DesignBar).
2. **Leertaste** mit Hover auf den Pfeil: Kontextmenü (u. a. Spiegeln).
3. Pfeil **am Schaft** ziehen: ganze Linie parallel verschieben; **Loslassen nahe einer Kante**: Ausrichtung parallel zu dieser Kante.
4. **A**: Teil so drehen, dass der Grain-Pfeil „nach oben“ zeigt (siehe Hilfe in der App).

### 5.14 Eckpunkt fein justieren (5-mm-Raster)

- Beim **Ziehen eines Eckpunkts** **Alt** halten: Bewegung in **5-mm-Schritten** relativ zur Startposition.

### 5.15 Nahtkante exakt angleichen (bei Nahtzuordnung)

- Wenn zwei Kanten als Naht zugeordnet sind und die Längen fast passen: beim Ziehen eines Eckpunkts auf der Nahtkante **Alt**, **⌘** (Mac) oder **Strg** (Windows) – exakte Längenangleich (nur bei geraden Nahtsegmenten; Details `HELP_ENTRIES`).

---

## 6. Funktionen nach Thema (Stichwortliste)

Die **vollständigen** Beschreibungen und Menüpfade stehen in `HELP_ENTRIES` (Kategorien: Werkzeuge, Datei, Erzeugen, Naht, Ansicht, Teile, Prüfen, Sonstiges). Hier nur Stichworte für KI-Suche:

- **Auswahl, Pan, Zoom, Raster** – Ansicht, Toolbar
- **Punkt, Kurvenpunkt, Notch, Kante, Digitalisieren, Rechteck, Linie, Bohrung, interne Kreise/Steppung** – Erzeugen / Bearbeiten
- **Bild einfügen** – Hintergrund, Verschieben, Entf
- **Cut/Seam-Ansicht** – Taste **5**
- **Laufrichtung** – Spiegeln, Ausrichten, Ziehen
- **90° drehen, an Grain ausrichten, Drehpunkt** – **R**, **A**, **Alt+D**
- **DXF Import/Export** – AAMA, ASTM, einfach
- **Einstellungen** – Farben, DXF, Notch-Voreinstellungen
- **Nahtzugabe, Nahtzuordnung, Nahtzugabe entfernen**
- **DesignBar** – Sichtbarkeit Punkte, Kerben, Bohrungen, interne Linien, Teilnamen, Konturmaße
- **Teile** – Auswahl, Nummer, Name, löschen
- **Prüfen** – geschlossene Kontur
- **Stückliste** – Menü (Ausbaustufe beachten)

---

## 7. Häufige Probleme (Troubleshooting)

| Symptom | Mögliche Ursache | Was tun |
|--------|-------------------|--------|
| Tastenkürzel „tun nichts“ | Fokus in einem **Eingabefeld** | Fokus raus (auf die Zeichenfläche klicken). |
| **Alt+D** setzt keinen Drehpunkt | Falsches Werkzeug / kein Teil gewählt / Maus zu weit weg | **Auswahl**, Teil markieren, Maus **nah** an Ecke, Kerbe oder Bézier-Mitte, dann **Alt+D**. |
| **P** macht etwas Unerwartetes | **Segment-Menü** offen | Im Kanten-Menü bedeutet **P** **Parallellinie**, nicht das globale Punkt-Werkzeug. |
| **D** startet nichts | **Alt** war gedrückt | **Digitalisieren** = **D** ohne Alt; **Alt+D** = Drehpunkt. |
| Alles „hängt“ in einem Modus | Viele Modi gleichzeitig | **Mittelklick** bricht Modi ab und setzt Werkzeug auf Auswahl (Hintergrundbild bleibt). |
| Kerbe lässt sich nicht setzen | Zu nah an anderer Kerbe | Mindestabstand entlang der Kontur einhalten (Hinweis in der App). |
| Naht vs. Schnitt verwirrend | Nahtzugabe aktiv | **Taste 5** schaltet die **Darstellung** Cut/Seam für das Teil; Bearbeitung folgt der **Nahtlinie** als Master, wenn Nahtzugabe gilt (Kurzfassung; Details technische Doku). |

---

## 8. Mac vs. Windows (Tasten)

| Gemeint | Windows / Linux | macOS |
|--------|------------------|--------|
| Alt | **Alt** | **Wahltaste** (**⌥**, „Option“) |
| Strg | **Strg** | **⌘** (bei einigen Naht-Funktionen zusätzlich; siehe Hilfe) |

Browser-Shortcuts (neuer Tab, Drucken) sind **nicht** TrimTex – in der App gilt die Tabelle in Abschnitt 4.

---

## 9. KI / Chat in der App (Technik-Hinweise)

**Eingebunden in der Arbeitsfläche (Build-Zeit):** Diese Datei wird per Vite als Rohtext importiert (`src/assistant/workspaceHelpContext.ts` → `docs/KI-NUTZERHILFE-QUELLE.md`). Der Workspace-KI-Button **„Antwort aus Doku“** sendet sie im **System-Prompt** an das Modell. **Änderungen an dieser Datei** wirken nach **neuem Build** in der Hilfe-Antwort; bitte mit ausliefern (z. B. Git push).

**UI-Komponenten (Stand Codebasis):**

- `src/components/WorkspaceAiChatPanel.tsx` – KI-Panel zur **Arbeitsfläche** (Bedienhilfe + Aktionsvorschläge)
- `src/components/ConfiguratorAiChatPanel.tsx` – Chat im **Konfigurator** (parametrische Teile)
- `src/services/workspaceChatAi.ts` (`requestWorkspaceHelpAnswer`, `requestWorkspaceChatProposal`), `src/services/configuratorChatAi.ts`

**Weitere Nutzung derselben Doku:**

1. **Ganz** im Prompt (wie in der App)
2. **Chunking** nach `##`-Abschnitten für Vektor-Suche
3. **Zusammen mit** `HELP_ENTRIES` (identische Fakten zu Shortcuts; hier mehr **Workflows** und **Troubleshooting**)

**Pflege:** Änderungen an Shortcuts oder Menüs **zuerst** in `helpEntries.ts`, dann hier spiegeln.

---

## 10. Leitlinien für KI-Antworten (Nutzerhilfe)

- Antworten in **einfacher Sprache**; Maßeinheit **mm** erwähnen, wo relevant.
- **Menüpfad** nennen (z. B. „Datei → …“), wenn keine Taste existiert.
- Bei **D** vs. **Alt+D** und bei **P** global vs. **P** im Segment-Menü **explizit unterscheiden**.
- **Keine** garantierten DXF-Details zu Fremdsoftware versprechen – auf `DXF-IMPORT-FREMDSYSTEME.md` verweisen, wenn der Nutzer Importprobleme hat.
- Technische Begriffe wie `cutLine`/`seamLine` nur nutzen, wenn der Nutzer Entwickler ist oder danach fragt; sonst **Schnittkontur** / **Nahtlinie** verwenden.

---

## 11. Verweise (Lesereihenfolge)

| Dokument | Inhalt |
|----------|--------|
| `src/data/helpEntries.ts` | In-App-Hilfe, Kurzbeschreibungen, Tastenkürzel |
| `docs/KI-NUTZERHILFE-QUELLE.md` | **Diese Datei** – Bedienung, Workflows, KI-Kontext |
| `docs/TRIMTEX-SOFTWARE-DOKUMENTATION.md` | Technik, Architektur, Datenmodell, Seam-as-Master, Notches |
| `docs/ZIELFORMATE-AAMA-ASTM.md` | AAMA/ASTM-Exportziele |
| `docs/DXF-IMPORT-FREMDSYSTEME.md` | DXF-Import von Fremdsystemen |
| `docs/GERBER-DXF-IMPORT-HINWEISE.md` | Gerber/ASTM-Import-Hinweise |
| `.cursor/rules/*.mdc` | Projektregeln (Cut/Seam, Export) |

---

*Letzte inhaltliche Erweiterung: Workflows 5.8–5.15, Troubleshooting, Mac/Windows, KI-Leitlinien und Code-Verweise.*
