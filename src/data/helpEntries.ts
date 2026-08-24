export type HelpEntry = {
  category: string
  name: string
  description: string
  access: string
  shortcut?: string
}

export const HELP_ENTRIES: HelpEntry[] = [
  // —— Werkzeuge & Shortcuts ——
  {
    category: 'Werkzeuge',
    name: 'Auswahl',
    description: 'Teile und Punkte auswählen, verschieben; Kontextmenüs nutzen.',
    access: 'Menü Bearbeiten → Auswahl',
    shortcut: undefined,
  },
  {
    category: 'Werkzeuge',
    name: 'Verschieben (Pan)',
    description: 'Die Arbeitsfläche in der Ansicht verschieben (nicht die Teile).',
    access: 'Menü Bearbeiten → Verschieben',
    shortcut: undefined,
  },
  {
    category: 'Werkzeuge',
    name: 'Punkt',
    description: 'Eckpunkt (blauer Punkt) auf der Kontur einfügen. Klick auf Linie oder Kurve setzt einen neuen Vertex.',
    access: 'Menü Erzeugen → Punkt, Menü Bearbeiten',
    shortcut: 'P',
  },
  {
    category: 'Werkzeuge',
    name: 'Kurvenpunkt',
    description:
      'Punkt auf der Kontur einfügen oder Linie in Bézier-Kurve umwandeln. Klick auf Linie = Kurve, Klick auf Kurve = Punkt. Mit „Punkte anzeigen“: Mittelpunkte von Bézier-Segmenten grün (zum Ziehen der Kurvenform).',
    access: 'Menü Erzeugen → Kurvenpunkt',
    shortcut: 'C',
  },
  {
    category: 'Werkzeuge',
    name: 'Spitze und rechte Winkel → fester Eckpunkt',
    description:
      'Weiche Punkte (blau) werden an der Hauptkontur automatisch zu festen Eckpunkten, sobald der Innenwinkel dort spitz oder rechtwinklig ist (≤ ca. 90°). Stumpfe Winkel bleiben weich, wenn der Punkt als weich markiert ist.',
    access: 'Automatisch nach jeder Konturänderung',
    shortcut: undefined,
  },
  {
    category: 'Werkzeuge',
    name: 'Notch',
    description:
      'Setzt eine Kerbe (Notch) auf der Kontur oder Nahtlinie zur Ausrichtung beim Nähen. Zwischen zwei Kerben muss entlang der Schnittkontur mindestens 4 mm Abstand sein (kein Übereinanderlegen).',
    access: 'Menü Erzeugen → Notch, Menü Bearbeiten → Notch',
    shortcut: 'N',
  },
  {
    category: 'Werkzeuge',
    name: 'Kante',
    description: 'Kanten-Segment anfahren: Kontextmenü für Offset (Segment verschieben) und Parallellinie (interne Linie).',
    access: 'Menü Erzeugen → Kante, Menü Bearbeiten → Kante → Kanten-Menü',
    shortcut: 'K',
  },
  {
    category: 'Werkzeuge',
    name: 'Digitalisieren',
    description: 'Kontur durch Klicken und Ziehen nachfahren; Punkte und optional Bézier-Handles setzen. Escape bricht ab.',
    access: 'Menü Erzeugen → Digitalisieren',
    shortcut: 'D',
  },
  {
    category: 'Werkzeuge',
    name: 'Bild einfügen',
    description:
      'Hintergrundbild auf die Arbeitsfläche legen (nur Anzeige). Auswahlwerkzeug: Bild anklicken zum Verschieben, Ecken ziehen für Größe. Entf/Backspace: Bild entfernen. Escape: Auswahl aufheben.',
    access: 'Menü Erzeugen → Bild einfügen',
    shortcut: undefined,
  },
  {
    category: 'Werkzeuge',
    name: 'Rechteck',
    description:
      'Neues Schnittteil als Rechteck auf der Arbeitsfläche zeichnen (Drag). Beim Ziehen: Leertaste, um Breite und Hoehe in mm per Tastatur einzugeben.',
    access: 'Menü Erzeugen → Rechteck',
    shortcut: undefined,
  },
  {
    category: 'Werkzeuge',
    name: 'Linie (Kontur)',
    description:
      'Liniensegment zur Kontur eines Teils hinzufügen oder als interne Linie zeichnen. Beim Ziehen: Leertaste, um die Laenge in mm per Tastatur zu setzen.',
    access: 'Menü Bearbeiten → Linie, Erzeugen → Interne Elemente → Linie',
    shortcut: undefined,
  },
  {
    category: 'Werkzeuge',
    name: 'Bohrung / Bohrloch',
    description: 'Bohrloch oder Markierung auf einem Teil setzen (Kreis).',
    access: 'Menü Erzeugen → Interne Elemente → Bohrloch, Menü Bearbeiten → Bohrung',
    shortcut: undefined,
  },
  {
    category: 'Werkzeuge',
    name: 'Kreis (intern)',
    description:
      'Kreisförmiges internes Element auf einem Teil zeichnen. Beim Ziehen: Leertaste, um den Radius in mm per Tastatur einzugeben.',
    access: 'Menü Erzeugen → Interne Elemente → Kreis',
    shortcut: undefined,
  },
  {
    category: 'Werkzeuge',
    name: 'Steppung',
    description: 'Stepplinie als interne Linie auf dem Teil anlegen.',
    access: 'Menü Erzeugen → Interne Elemente → Steppung',
    shortcut: undefined,
  },
  {
    category: 'Werkzeuge',
    name: 'Cut-/Seam-Ansicht umschalten',
    description: 'Schaltet für das aktuelle Teil zwischen Darstellung der Schnittlinie (Cut) und der Nahtlinie (Seam) um.',
    access: 'Taste 5 (wenn Teil unter Maus oder einzig ausgewählt)',
    shortcut: '5',
  },
  {
    category: 'Werkzeuge',
    name: 'Notch Anker ein/aus (verankert/frei)',
    description: 'Wechselt einen Notch zwischen verankert (am Konturpunkt) und frei (eigene Position).',
    access: 'Notch mit Maus anfahren, dann Taste drücken',
    shortcut: 'F',
  },
  {
    category: 'Werkzeuge',
    name: 'Segment verschieben (Offset)',
    description: 'Einzelnes Kontur-Segment um einen Wert in mm nach außen oder innen verschieben.',
    access: 'Kante anfahren → Segment-Menü → Offset (O) oder Wert eingeben',
    shortcut: 'O',
  },
  {
    category: 'Werkzeuge',
    name: 'Parallellinie (interne Linie)',
    description:
      'Parallele zum Segment als interne Linie erzeugen (gerade Kante → Linie, Kurvensegment → Bézier).',
    access: 'Kante anfahren → Segment-Menü → Parallel (P)',
    shortcut: 'P (im Segment-Menü)',
  },
  {
    category: 'Werkzeuge',
    name: 'Segment pinnen / schließen',
    description: 'Segment-Menü anpinnen (weiter nutzen) oder schließen.',
    access: 'Kante anfahren → Leertaste zum Pinnen, Escape zum Schließen',
    shortcut: 'Leertaste, Escape',
  },
  {
    category: 'Werkzeuge',
    name: 'Löschen (Nahtzuordnung / Notch / Vertex)',
    description: 'Unter Maus: Nahtzuordnung entfernen, Notch löschen, Vertex löschen oder Bézier-Segment in Linie umwandeln.',
    access: 'Element anfahren, dann Taste drücken',
    shortcut: 'Entf, Rücktaste',
  },
  {
    category: 'Werkzeuge',
    name: 'Konturpunkt: weich, fest, Kurve',
    description:
      'Mit „Punkte anzeigen“: genau ein Teil auswählen, Maus auf roten/blauen Eckpunkt oder grüne Bézier-Mitte. P = weicher Punkt (blau), E = fester Eckpunkt (rot), C = von dieser Ecke aus das nächste gerade Segment in eine Bézier-Kurve umwandeln (wie Kurvenpunkt-Werkzeug). An der grünen Kurvenmitte: E = Segment wieder zur Linie (wie Entf). Wenn ein Kanten-Segment-Menü offen ist, bleibt P dort die Parallellinie.',
    access: 'Punkte anzeigen · Auswahl / Punkt / Kurvenpunkt · Ecke oder grüner Punkt hovern',
    shortcut: 'P, E, C · E',
  },
  {
    category: 'Werkzeuge',
    name: 'Punkt in 5-mm-Schritten verschieben',
    description:
      'Beim Ziehen eines Eckpunkts die Alt-Taste gedrückt halten: Die Bewegung erfolgt nur in 5-mm-Schritten relativ zur Startposition (±5, ±10, ±15 …).',
    access: 'Punkt ziehen + Alt-Taste halten',
    shortcut: 'Alt',
  },
  {
    category: 'Werkzeuge',
    name: 'Nahtkante exakt auf Längengleichheit (0 mm Differenz)',
    description:
      'Bei zugeordneter Naht: Wenn die Kantenlänge zum Gegenstück schon unter 5 mm abweicht, während des Ziehens Alt, ⌘ (Mac) oder Strg (Windows) halten bzw. drücken — der Eckpunkt springt dann auf exakt dieselbe Gesamtlänge wie die andere Seite (nur bei geraden Nahtsegmenten). Funktioniert auch, wenn du die Taste drückst, ohne die Maus zu bewegen.',
    access: 'Eckpunkt auf Nahtkante ziehen + Alt / ⌘ / Strg',
    shortcut: 'Alt, ⌘, Strg',
  },
  {
    category: 'Werkzeuge',
    name: 'Laufrichtung (Grain) Kontextmenü',
    description:
      'Laufrichtungspfeil anfahren und Leertaste: Menü zum Spiegeln, Löschen, Kopieren, Kaschierung erzeugen und Teil-Eigenschaften. „Kaschierung erzeugen“ legt ein abhängiges Tochterteil neben der Mutter an (gefüllte Schraffur, Außenecken in der Nahtzugabe angephast); Kontur/Notches folgen der Mutter, Position der Kaschierung bleibt lokal. Nur im Layout-Modus (Kontur bearbeiten aus): Teil ausgewählt, am Schaft (nicht Pfeilkopf/Querstrich) ziehen, um die Linie parallel zu verschieben. Loslassen mit Linienmitte nahe einer Schnittkontur-Kante: parallel zur Kante ausrichten und auf die Kante legen. Umschalt beim Loslassen: kein Snappen. Im Kontur-Bearbeitungsmodus ist die Laufrichtung nicht verschiebbar.',
    access: 'Laufrichtungspfeil mit Maus anfahren → Leertaste bzw. Ziehen',
    shortcut: 'Leertaste',
  },
  {
    category: 'Werkzeuge',
    name: 'Kaschierung erzeugen',
    description:
      'Aus dem Laufrichtungs-Menü (Leertaste am Fadenlauf): erzeugt ein abhängiges Kaschierungsteil neben dem Mutterteil. Die Schnittkontur erhält an scharfen Ecken Chamfers maximal bis zum Naht-Eckpunkt; die Nahtlinie bleibt eckig. Die Kaschierung wird nur von der Mutter synchronisiert – Kontur, Kerben und Internals sind dort nicht manuell editierbar (Position/Drehung, Material und Laufrichtung schon; Laufrichtung im Layout-Modus verschieben). Aus einer Kaschierung kann keine weitere erzeugt werden; Löschen der Mutter entfernt auch die Kaschierung.',
    access: 'Laufrichtungspfeil anfahren → Leertaste → Kaschierung erzeugen',
    shortcut: 'Leertaste',
  },
  {
    category: 'Werkzeuge',
    name: '90° drehen',
    description: 'Ausgewählte Teile um 90° im Uhrzeigersinn drehen (um Teilmittelpunkt).',
    access: 'Menü Bearbeiten → 90° drehen',
    shortcut: 'R',
  },
  {
    category: 'Werkzeuge',
    name: 'An Laufrichtung ausrichten',
    description: 'Teil so drehen, dass der Laufrichtungspfeil senkrecht nach oben zeigt.',
    access: 'Menü Bearbeiten → An Laufrichtung ausrichten',
    shortcut: 'A',
  },
  {
    category: 'Werkzeuge',
    name: 'Alles abbrechen (Mittelklick)',
    description:
      'Mit einem Klick auf das Mausrad (mittlere Taste) beenden Sie alle aktiven Modi: Werkzeug wird Auswahl, offene Dialoge schließen, Digitalisieren/Lineal/Nahtzuordnung usw. enden. Teile bleiben ausgewählt, das Hintergrundbild bleibt erhalten (nur die Bild-Auswahl wird aufgehoben). In Eingabefeldern und auf Links (neuer Tab) passiert nichts.',
    access: 'Überall in der App · Mausrad-Klick (Mitte)',
    shortcut: 'Mittelklick',
  },
  {
    category: 'Werkzeuge',
    name: 'Drehpunkt auf Ecke, Kerbe oder Kurve setzen',
    description:
      'Ohne extra Menü: Teil auswählen, Maus auf Ecke, Kerbe oder Bézier-Mitte (grüner Kurvenpunkt) legen, dann Alt+D („D“ wie Drehpunkt; P bleibt für das Punkt-Werkzeug). Funktioniert auch ohne „Punkte anzeigen“. Der Drehpunkt (Kreuz) springt dorthin — drehen wie gewohnt am blauen Griff.',
    access: 'Auswahl-Werkzeug · Punkt/Kerbe hovern · Wahltaste/Alt + D',
    shortcut: 'Alt+D (Mac: ⌥D)',
  },

  // —— Datei ——
  {
    category: 'Datei',
    name: 'DXF importieren',
    description: 'Schnittteile aus einer DXF-Datei in die Arbeitsfläche laden.',
    access: 'Menü Datei → DXF importieren …',
    shortcut: undefined,
  },
  {
    category: 'Datei',
    name: 'DXF exportieren (einfach)',
    description: 'Arbeitsfläche als einfache DXF-Datei exportieren.',
    access: 'Menü Datei → Exportieren → DXF (einfach)',
    shortcut: undefined,
  },
  {
    category: 'Datei',
    name: 'AAMA-DXF exportieren',
    description: 'Export im AAMA-DXF-Format für Bekleidung/Schnittmuster.',
    access: 'Menü Datei → Exportieren → AAMA-DXF (.aam)',
    shortcut: undefined,
  },
  {
    category: 'Datei',
    name: 'ASTM-DXF exportieren',
    description:
      'ASTM-DXF (Gerber/AccuMark): Schnitt Layer 1/84 mit Kerb-Einbuchtungen, zusätzlich Kerben Layer 4/5/82, doppelt in ENTITIES.',
    access: 'Menü Datei → Exportieren → ASTM-DXF (Gerber)',
    shortcut: undefined,
  },
  {
    category: 'Datei',
    name: 'Raster ein-/ausblenden',
    description: 'Hintergrundraster auf der Arbeitsfläche ein- oder ausblenden.',
    access: 'Menü Datei → Raster einblenden / Raster ausblenden',
    shortcut: undefined,
  },
  {
    category: 'Datei',
    name: 'Einstellungen',
    description: 'Allgemeine Einstellungen, DXF-Skalierung, Farben, Notch-Voreinstellungen.',
    access: 'Menü Datei → Einstellungen',
    shortcut: undefined,
  },

  // —— Erzeugen (Zusatz) ——
  {
    category: 'Erzeugen',
    name: 'Teil hinzufügen',
    description: 'Neues leeres Schnittteil zur Arbeitsfläche hinzufügen.',
    access: 'Menü Erzeugen → Teil hinzufügen, oder Sidebar: + Teil hinzufügen',
    shortcut: undefined,
  },

  // —— Naht ——
  {
    category: 'Naht',
    name: 'Nahtzugabe …',
    description: 'Fügt einer Kontur eine Nahtzugabe (Abstand zur Nahtlinie) in mm hinzu oder ändert sie. Dialog mit Wertangabe.',
    access: 'Menü Naht → Nahtzugabe …',
    shortcut: 'S',
  },
  {
    category: 'Naht',
    name: 'Nahtzugabe entfernen',
    description: 'Nahtzugabe des ausgewählten Teils entfernen (Nahtlinie entfällt).',
    access: 'Menü Naht → Nahtzugabe entfernen, oder Sidebar bei Teil',
    shortcut: undefined,
  },
  {
    category: 'Naht',
    name: 'Nahtzuordnung',
    description: 'Zwei Kanten verschiedener Teile als zusammengehörige Naht zuordnen (erste Kante, dann zweite Kante anklicken).',
    access: 'Menü Naht → Nahtzuordnung',
    shortcut: undefined,
  },
  {
    category: 'Naht',
    name: 'Nahtzugabe 5 mm (schnell)',
    description: 'Schnell 5 mm Nahtzugabe auf ausgewählte Teile anwenden.',
    access: 'Menü Bearbeiten → Nahtzugabe 5 mm',
    shortcut: undefined,
  },

  // —— Ansicht & Toolbar ——
  {
    category: 'Profil',
    name: 'Profil zuordnen',
    description: 'Kante eines Teils anklicken und ein Profil zuordnen.',
    access: 'Menü Profil → Profil zuordnen',
    shortcut: undefined,
  },
  {
    category: 'Ansicht',
    name: 'Punkte ein-/ausblenden',
    description: 'Eckpunkte und weiche Punkte (blau) auf der Kontur ein- oder ausblenden.',
    access: 'Menü Bearbeiten → Punkte einblenden / Punkte ausblenden',
    shortcut: undefined,
  },
  {
    category: 'Ansicht',
    name: 'Linial (Strecke messen)',
    description: 'Strecke zwischen zwei Punkten messen. Einmal klicken = Start, zweites Klicken = Ende; Anzeige in mm.',
    access: 'Toolbar rechts → Linial',
    shortcut: undefined,
  },
  {
    category: 'Ansicht',
    name: 'Zoom + / −',
    description: 'Arbeitsfläche vergrößern oder verkleinern. Anzeige in % und mm maßstabsgetreu.',
    access: 'Toolbar rechts → − / +',
    shortcut: undefined,
  },
  {
    category: 'Ansicht',
    name: 'Raster',
    description: 'Hintergrundraster ein- oder ausblenden.',
    access: 'Unten → Anzeige → Raster',
    shortcut: undefined,
  },
  {
    category: 'Ansicht',
    name: 'Punkte',
    description: 'Punkte auf der Kontur ein- oder ausblenden.',
    access: 'Unten → Anzeige → Punkte',
    shortcut: undefined,
  },
  {
    category: 'Ansicht',
    name: 'Laufrichtung',
    description: 'Laufrichtungspfeil (Fadenlauf) der Teile ein- oder ausblenden.',
    access: 'Unten → Anzeige → Laufrichtung',
    shortcut: undefined,
  },
  {
    category: 'Ansicht',
    name: 'Kerben',
    description: 'Notches (Kerben) ein- oder ausblenden.',
    access: 'Unten → Anzeige → Kerben',
    shortcut: undefined,
  },
  {
    category: 'Ansicht',
    name: 'Bohrungen',
    description: 'Bohrungen/Markierungen ein- oder ausblenden.',
    access: 'Unten → Anzeige → Bohrungen',
    shortcut: undefined,
  },
  {
    category: 'Ansicht',
    name: 'Interne Linien',
    description: 'Interne Linien, Kreise, Steppung ein- oder ausblenden.',
    access: 'Unten → Anzeige → Interne Linien',
    shortcut: undefined,
  },
  {
    category: 'Ansicht',
    name: 'Teilnamen',
    description: 'Teilnamen auf der Arbeitsfläche ein- oder ausblenden.',
    access: 'Unten → Anzeige → Teilnamen',
    shortcut: undefined,
  },
  {
    category: 'Ansicht',
    name: 'Konturmaße',
    description:
      'Zeigt auf allen Teilen die Bogenlängen entlang der Schnittkontur (Außenkante): zwischen aufeinanderfolgenden Eckpunkten, zwischen Kerben und zwischen Ecke und Kerbe. Ein Klick auf die Checkbox schaltet die Anzeige für die ganze Arbeitsfläche ein oder aus.',
    access: 'Unten → Anzeige → Konturmaße',
    shortcut: undefined,
  },
  {
    category: 'Ansicht',
    name: 'Naht-Prüfanzeigen',
    description:
      'Zeigt bei Nahtzuordnungen Verbinder zwischen Teilen, Längenabweichungen (Δ mm), Kerben-Warnungen und grüne Häkchen (✓), wenn Teilabschnitte übereinstimmen. Ausblenden für eine ruhigere Arbeitsfläche — die Zuordnungen bleiben gespeichert.',
    access: 'Unten → Anzeige → Naht-Prüfanzeigen',
    shortcut: undefined,
  },

  // —— Sidebar & Teile ——
  {
    category: 'Teile',
    name: 'Teil auswählen',
    description: 'Teil in der Sidebar oder durch Klick auf der Arbeitsfläche auswählen.',
    access: 'Sidebar → Teile-Liste anklicken',
    shortcut: undefined,
  },
  {
    category: 'Teile',
    name: 'Teilnummer bearbeiten',
    description: 'Nummer des ausgewählten Teils in der Sidebar ändern.',
    access: 'Sidebar → Teil bearbeiten → Teilnummer',
    shortcut: undefined,
  },
  {
    category: 'Teile',
    name: 'Teil löschen',
    description: 'Teil von der Arbeitsfläche entfernen.',
    access: 'Sidebar → × neben dem Teil',
    shortcut: undefined,
  },
  {
    category: 'Teile',
    name: 'Teilnamen bearbeiten',
    description: 'Anzeigenamen des Teils ändern (Doppelklick auf Namen in Sidebar).',
    access: 'Sidebar → Doppelklick auf Teilname',
    shortcut: undefined,
  },

  // —— Prüfen ——
  {
    category: 'Prüfen',
    name: 'Geschlossene Kontur prüfen',
    description: 'Prüft, ob das ausgewählte Teil eine geschlossene Kontur hat.',
    access: 'Menü Prüfen → Geschlossene Kontur prüfen',
    shortcut: undefined,
  },
  {
    category: 'Prüfen',
    name: 'Alle Teile prüfen',
    description: 'Zeigt, wie viele Teile eine geschlossene Kontur haben.',
    access: 'Menü Prüfen → Alle Teile prüfen',
    shortcut: undefined,
  },

  // —— Sonstiges ——
  {
    category: 'Sonstiges',
    name: 'Anleitung öffnen',
    description: 'Die komplette Anleitung mit Funktionen, Zugriffen und Tastenkürzeln öffnen.',
    access: 'Menü Hilfe → Anleitung',
    shortcut: 'F1 oder ?',
  },
  {
    category: 'Sonstiges',
    name: 'Stückliste',
    description: 'Stücklisten-Funktion (Menüeintrag).',
    access: 'Menü Stückliste → Stückliste',
    shortcut: undefined,
  },
  {
    category: 'Sonstiges',
    name: 'Material',
    description: 'Material-Menü (aktuell ohne Einträge).',
    access: 'Menü Material',
    shortcut: undefined,
  },
  {
    category: 'Sonstiges',
    name: 'Digitize abbrechen',
    description: 'Digitalisieren-Modus beenden ohne neues Teil zu erzeugen.',
    access: 'Während Digitalisieren aktiv',
    shortcut: 'Escape',
  },
  {
    category: 'Sonstiges',
    name: 'Hintergrundbild Auswahl aufheben',
    description: 'Auswahl des Hintergrundbilds aufheben (Bild bleibt sichtbar).',
    access: 'Wenn Hintergrundbild ausgewählt',
    shortcut: 'Escape',
  },
]

// Kategorien in gewünschter Reihenfolge für die Anzeige
export const HELP_CATEGORIES_ORDER = [
  'Werkzeuge',
  'Datei',
  'Erzeugen',
  'Naht',
  'Profil',
  'Ansicht',
  'Teile',
  'Prüfen',
  'Sonstiges',
]

/** Zeile für die kompakte Shortcut-Übersicht (Hilfe → Tastenkürzel). */
export type ShortcutListRow = { category: string; name: string; shortcut: string }

/** Kürzel, die nicht als `shortcut` in HELP_ENTRIES stehen. */
const SHORTCUT_LIST_EXTRA: ShortcutListRow[] = []

/**
 * Alle Tastenkürzel gruppiert nach Kategorie (für die Übersichtsliste).
 * Pro Kategorie alphabetisch nach Funktionsname.
 */
export function getShortcutListGrouped(): { category: string; rows: ShortcutListRow[] }[] {
  const map = new Map<string, ShortcutListRow[]>()

  const push = (row: ShortcutListRow) => {
    if (!map.has(row.category)) map.set(row.category, [])
    map.get(row.category)!.push(row)
  }

  for (const row of SHORTCUT_LIST_EXTRA) push(row)

  for (const e of HELP_ENTRIES) {
    const sc = e.shortcut
    if (sc == null || String(sc).trim() === '') continue
    push({ category: e.category, name: e.name, shortcut: sc })
  }

  for (const rows of map.values()) {
    rows.sort((a, b) => a.name.localeCompare(b.name, 'de'))
  }

  const catOrder = ['Allgemein', ...HELP_CATEGORIES_ORDER]
  const out: { category: string; rows: ShortcutListRow[] }[] = []
  const seen = new Set<string>()

  for (const cat of catOrder) {
    const rows = map.get(cat)
    if (rows && rows.length > 0) {
      out.push({ category: cat, rows })
      seen.add(cat)
    }
  }
  for (const [cat, rows] of map) {
    if (!seen.has(cat) && rows.length > 0) out.push({ category: cat, rows })
  }

  return out
}
