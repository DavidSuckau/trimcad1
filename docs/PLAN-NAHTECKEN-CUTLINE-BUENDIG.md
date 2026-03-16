# Plan: Nahtecken – CutLine an Naht-Ecken bündig machen

Stand: März 2025  
**Status:** Plan / Reflexion – noch keine Code-Umsetzung.

---

## Begriffe (für Diskussion und Implementierung)

- **Nahtecke**  
  = Ein **Vertex** am **Anfang** oder **Ende** einer Kante, die zu einer SeamAssignment gehört.  
  Die Nahtecke wird durch eine **SeamAssignment bestimmt**, existiert aber **geometrisch auf beiden beteiligten Teilen**: Vertex auf Teil A und Vertex auf Teil B. Die SeamAssignment sagt nur: *Diese beiden Ecken gehören zusammen.* (Inhaltlich „gehört die Ecke zur Naht“ – technisch gibt es die Ecke zweimal, je einmal pro Teil.)

- **Corner Join (Ecken-Join)**  
  = Die **Geometrie der cutLine an dieser Ecke** – wie die Nahtzugabe an der Nahtecke geformt wird.  
  Typen (für Implementierung/Modell): **MITER** (Winkelhalbierende / Miter-Join), **BEVEL** (Fase / abgeschnitten), **ROUND** (gerundet), **CUSTOM** (individuell).  
  *Sprachlich:* Mathematisch ist MITER = Winkelhalbierende, BEVEL = Fase; im Patternmaking wird „Fase“ oft für beides verwendet.  
  Der Join-Typ bestimmt, wo der cutLine-Vertex liegt und wie die anstoßenden Segmente verlaufen.

---

## 1. Die Tatsache (Problembeschreibung)

Wenn zwei Schnittteile **an einer Naht zusammengenäht** werden, legt man sie beim Nähen **rechts auf rechts** (Stoff rechts auf rechts). Dabei:

- Die **Nahtlinien (seamLine)** der beiden Teile liegen exakt aufeinander – das ist die Linie, an der genäht wird. Sie passen per Definition (z. B. durch Nahtzuordnung / SeamAssignment).
- Die **Schnittlinien (cutLine)** sind jeweils um die Nahtzugabe (*seamAllowanceMm*) nach außen versetzt. Sie werden heute pro Teil **unabhängig** erzeugt (z. B. durch Offset von der seamLine oder durch Zeichnen/Bearbeiten der cutLine).

**Das Problem:** An den **Ecken** der Naht (dort, wo die gemeinsame Nahtkante endet und die nächste Kante beginnt) sind die beiden cutLines **nicht bündig**. Im Screenshot z. B.: oben rechts ragt die cutLine des einen Teils über die des anderen hinaus, obwohl die seamLines genau übereinstimmen. Ursache: Jedes Teil hat an der Ecke „seine eigene“ Nahtzugaben-Ecke (z. B. jeweils ein Miter oder eine rechte Ecke), die nicht unter Berücksichtigung des anderen Teils berechnet wurde.

**Kernaussage:**  
- **seamLine** = unverändert, darf nie geändert werden.  
- **cutLine** = nur die **Ecken** (Nahtecken) an den Enden zugeordneter Nahtkanten sollen so angepasst werden, dass beim gedanklichen „Rechts-auf-Rechts-Legen“ die cutLines beider Teile an diesen Ecken bündig sind.

---

## 2. Ziel

- Das System soll **erkennen**, wo Teile über **Nahtzuordnungen (SeamAssignment)** an einer Naht verbunden sind.
- An diesen **Nahtecken** (Eckpunkte am Anfang/Ende der zugeordneten Nahtkante) soll **nur die cutLine** angepasst werden – z. B.:
  - **Fase / Miter (z. B. 45°)** – klassische abgeschrägte Nahtecke;
  - oder **individuelle** Form (später: Nutzer wählt Typ pro Ecke).
- Die **seamLine** bleibt in jedem Fall unangetastet.

---

## 2.1 Gedankenmodell: „Rechts-auf-Rechts-Klappen“

Für das Verständnis des Problems und der Zielgeometrie ist folgendes Bild hilfreich:

- Beim **Nähen** werden die beiden Teile **rechts auf rechts** gelegt: die rechten Stoffseiten zeigen zueinander, die Nahtkanten liegen aufeinander.
- **Gedanklich** entspricht das: **Ein Teil (z. B. B) wird gespiegelt/geklappt und so auf das andere (A) gelegt, dass die zugeordneten Nahtkanten deckungsgleich sind.**
- Dann gilt:
  - Die **Nahtlinien (seamLine)** von A und B liegen exakt übereinander – das ist die Nähgeometrie.
  - Die **Schnittlinien (cutLine)** liegen außen: jeweils auf der „Stoffaußenseite“ jedes Teils. Beim Klappen zeigen diese Außenseiten in **entgegengesetzte Richtungen**.
- **Bündigkeit** bedeutet: An den Ecken der Naht müssen die beiden cutLines so geformt sein, dass sie beim Klappen **eine gemeinsame Kante** bilden – keine Überhänge, keine Lücken. Das ist genau das, was professionelle CAD-Systeme mit „Nahtecken anpassen“ erreichen.

Dieses Klappen-Modell ist **konzeptionell richtig** und erklärt, warum die Ecke durch die **Naht** (SeamAssignment) bestimmt wird und auf beiden Teilen existiert (siehe Begriffe: Nahtecke). Für die **Implementierung** reicht ein einfacherer Algorithmus (siehe Abschnitt 4.1), der ohne explizites Klappen auskommt – didaktisch: Verständnis durch Klappen, Umsetzung durch lokalen Join.

---

## 2.2 Konzeptionelles Modell: seamLine als Master (Zielarchitektur)

Fachlich gilt:

- **seamLine** = **Nähgeometrie** (wo genäht wird) – Referenz, wird nicht verändert.
- **cutLine** = **Materialzugabe** (wo geschnitten wird) – abgeleitete Geometrie.

**Empfohlene Pipeline (Zielbild):**

```
seamLine (Master, unverändert)
   ↓ Offset um seamAllowance
cutLine (roh)
   ↓ Nahtecken-Korrektur (Join pro SeamAssignment-Ende)
final cutLine
```

Damit bleibt die seamLine **immer** unverändert; die cutLine wird aus ihr abgeleitet und nur an den Nahtecken nach Join-Regel angepasst.

**Hinweis zum aktuellen System:** TrimTex berechnet derzeit die seamLine aus der cutLine (`offsetCurvesInwardForSeam`). Das ist für Nahtecken „falsch herum“: Änderungen an der cutLine (z. B. Fase) verschieben dann die seamLine mit. Für eine spätere Implementierung wäre ein Übergang zu **seamLine = Master**, **cutLine = abgeleitet** wünschenswert. Wenn die Codebasis stark auf cutLine→seamLine ausgerichtet ist, kann man zunächst bei „nur cutLine an Nahtecken anpassen“ bleiben und die seamLine weiter aus der (angepassten) cutLine ableiten – die Entscheidung „nur cutLine ändern, seamLine logisch gleich“ bleibt fachlich richtig.

---

## 3. Bausteine im bestehenden System

- **SeamAssignment** (siehe `src/types/model.ts`):  
  `pieceIdA`, `curveIndicesA`, `pieceIdB`, `curveIndicesB` (+ Klickrichtung).  
  Definiert, welche Kante von Teil A mit welcher Kante von Teil B zusammengenäht wird. Damit sind die **Naht-Eckpunkte** ableitbar:  
  - Bei Teil A: erster und letzter Vertex der Kante `curveIndicesA` (Eckpunkt = gemeinsamer Punkt zweier cutLine-Segmente).  
  - Bei Teil B: analog für `curveIndicesB`.

- **cutLine / seamLine**:  
  - Eckpunkte der cutLine sind durch die Vertices (Segment-Endpunkte) definiert.  
  - Aktuell: seamLine wird aus cutLine per `offsetCurvesInwardForSeam` berechnet. Zielmodell (siehe 2.2): seamLine = Master, cutLine = abgeleitet. In jedem Fall: seamLine (Nähgeometrie) darf nicht verändert werden.

- **Offset-Logik** (`src/geometry/offset.ts`):  
  Aktuell wird die gesamte Kontur mit z. B. Miter/Round offsetet. Für **Nahtecken** braucht man eine **Ecken-spezifische** Anpassung nur an den Stellen, die zu einer SeamAssignment gehören.

---

## 4. Idee zur Umsetzung

### 4.1 Algorithmus für Implementierung (vereinfacht)

Die theoretisch korrekte Beschreibung („vier Kanten nach dem Klappen analysieren“) ist für Version 1 unnötig komplex. Stattdessen:

**An einer Nahtecke** hat man am **einzelnen Teil** zwei **seamLine-Segmente** (der Join basiert auf der **seamLine**, nicht auf der cutLine):
- **S1** = seamLine-Segment der **Nahtkante** (das Segment auf der zugeordneten Kante),
- **S2** = seamLine-Segment der **angrenzenden Kante** (an derselben Ecke).

**Miter-Join (Winkelhalbierende):**
1. **Außennormale** von **S1** an der Ecke bestimmen, um **seamAllowance** nach außen verschieben (Gerade bzw. Punkt auf der Offset-Linie).
2. **Außennormale** von **S2** an der Ecke bestimmen, um **seamAllowance** nach außen verschieben.
3. **Schnittpunkt** dieser beiden Offsets = neuer **cutLine-Vertex** (Miter-Join-Punkt).

**Orientierung der Außennormale:**  
Die Außennormale ist mathematisch nur eindeutig, wenn die **Polygonorientierung der seamLine** festgelegt ist. Beispiel: *counter-clockwise seamLine → außen = rechts*; *clockwise → außen = links*. Ohne diese Definition kann der Offset versehentlich nach **innen** gehen. Bei der Implementierung die Orientierung der seamLine (z. B. aus Umlaufsinn der Kurven) ableiten und konsistent verwenden.

**Miter-Limit (wichtig für CAD-Stabilität):**  
Bei sehr spitzen Winkeln (z. B. < 30°) wird der Miter extrem lang („Monster-Ecke“). Wie in Illustrator/CAD üblich: **miterLimit** einführen. Beispiel-Regel: *Wenn miterLength > seamAllowance × 4 → BEVEL statt MITER* (Ecke abgeschnitten statt Winkelhalbierende). Verhindert unbrauchbar lange Spitzen.

**Warum reicht das ohne „Klappen“?**  
Beide Teile teilen dieselbe Naht-Geometrie (die zugeordneten Kanten sind deckungsgleich). Wenn **beide** dieselbe Join-Regel (z. B. MITER) anwenden, ergeben sich an beiden Teilen dieselben relativen Ecken-Geometrien – die cutLines sind damit automatisch bündig. Es ist nicht nötig, die Geometrie des anderen Teils zu analysieren oder gedanklich zu klappen; der **Ecken-Join-Typ** wird pro SeamAssignment-Ende überschrieben (Ecke ↔ Naht gekoppelt, nicht Ecke ↔ Polygon – das verhindert, dass der normale Offset-Algorithmus die Nahtlogik zerstört). Die Berechnung erfolgt lokal pro Teil an der Nahtecke.

**Vorteil:** Implementierung deutlich einfacher und stabiler (kein Spiegeln, kein Abgleich mit dem anderen Teil).

### 4.2 Nahtecken identifizieren und nur cutLine anfassen

- **Nahtecken identifizieren:** Pro **SeamAssignment** die beiden Ecken der zugeordneten Kante (Anfangs- und End-Vertex von `curveIndicesA` bzw. `curveIndicesB`). Das sind die **Nahtecken** für diese Naht.
- **Override-Logik (wichtig für Implementierung):** Nahtecken **überschreiben** den normalen Offset-Join der Kontur. Also: *Wenn Vertex = Nahtecke (SeamCorner) → seamCornerJoin anwenden (z. B. MITER/BEVEL); sonst → defaultJoin des globalen Offsets.* So bleibt die Nahtlogik erhalten und der Standard-Offset zerstört sie nicht.
- **Berechnung pro SeamAssignment-Ende:** Für **startCorner** und **endCorner** jeweils den cutLine-Vertex nach dem gewählten Join-Typ (z. B. MITER) setzen. **Beide Teile** (A und B) werden an der jeweiligen Nahtecke angepasst – sonst entstehen wieder Differenzen.
- **Nur cutLine ändern:** Es werden nur **Vertex-Positionen** der cutLine angepasst (ggf. an den Nahtecken die anstoßenden Segmente auf Line umstellen). **seamLine** wird nicht verändert (siehe Abschnitt 2.2; bei aktuellem Stand ggf. seamLine aus der angepassten cutLine neu ableiten).

### 4.3 Architektur: Corner-Typ pro SeamAssignment-Ende

Nahtecken sollen **nicht global**, sondern **pro SeamAssignment-Ende** definiert werden:

- **SeamAssignment** um ergänzen:
  - `startCornerType`, `endCornerType`: Join-Typ an der Start- bzw. End-Ecke (z. B. `'MITER' | 'BEVEL' | 'ROUND' | 'CUSTOM'`).
  - **`startCornerManual?`, `endCornerManual?`** (oder gemeinsam `cornerOverride?: boolean`): Ob die Ecke **vom Nutzer geändert** wurde oder **automatisch** berechnet. Damit kann unterschieden werden: *auto berechnet* (z. B. bei neuer SeamAssignment) vs. *user geändert* (Nutzer hat Typ oder Position angepasst) – wichtig für Undo und für „Nahtecken nicht überschreiben, wenn manuell gesetzt“.

Damit ist flexibel steuerbar, welche Ecke welchen Typ hat. Die Berechnung läuft pro SeamAssignment für **startCorner** und **endCorner** getrennt.

**Beispiel-Struktur (konzeptionell):**
```ts
SeamAssignment {
  pieceIdA, curveIndicesA, clickedCurveA,
  pieceIdB, curveIndicesB, clickedCurveB,
  startCornerType?,   // z.B. 'MITER'
  endCornerType?,     // z.B. 'MITER'
  startCornerManual?, // false = auto, true = Nutzer hat geändert
  endCornerManual?
}
```

### 4.4 Wann ausführen

- Bei Änderung einer SeamAssignment (Hinzufügen/Entfernen/Ändern).
- Bei Änderung der Kontur oder Nahtzugabe eines zugehörigen Teils (Nahtecken neu berechnen).
- Option: expliziter Akt „Nahtecken anpassen“ oder automatisch bei jeder relevanten Änderung (Stabilität/Undo ggf. separat klären).

---

## 5. Corner-Join-Typen (Nahtecken-Typen)

Entsprechend der Begriffsdefinition **Corner Join** und der Architektur (startCornerType / endCornerType):

| Typ      | Bedeutung / Geometrie |
|----------|------------------------|
| **MITER** | Winkelhalbierende: Schnitt der beiden Offset-Normalen (Miter-Join). Klassische abgeschrägte Nahtecke. Mathematisch = Winkelhalbierende. |
| **BEVEL** | Fase / abgeschnitten (cut-off): Ecke rechtwinklig abgeschnitten, ähnlich „square“ beim Offset. |
| **ROUND** | Gerundete Ecke (Nahtzugabe rund geführt). |
| **CUSTOM** | Individuell: Nutzer definiert die Eckenform (z. B. durch Ziehen der cutLine-Ecke). |

Für Version 1: **Fokus auf MITER**, damit die Ecken bündig werden; BEVEL/ROUND/CUSTOM können schrittweise ergänzt werden (siehe auch `FUNKTIONSVORSCHLAEGE-NUTZER-NUTZEN.txt`).

---

## 6. Offene Fragen / Klärungen

Folgende Punkte waren offen; unten sind **getroffene Klärungen** festgehalten (für spätere Implementierung/Diskussion).

1. **Welches Teil wird angepasst?**  
   **Klärung:** **Beide** Teile an der Nahtecke anpassen. Sonst entstehen wieder Differenzen zwischen den cutLines.

2. **Mehrere Nahtzuordnungen an einem Vertex**  
   Ein Vertex kann Endpunkt von zwei SeamAssignments sein (z. B. zwei Nähte treffen sich an einer Ecke).  
   **Klärung:** Beide SeamAssignments müssen an dieser Ecke **denselben** cornerType nutzen (Priorität = SeamAssignment; Konsistenz erzwingen).

3. **Bézier-Kanten**  
   **Klärung:** An der **Nahtecke** die Ecke immer als **Line**-Segment(e) modellieren. Das ist Standard in CAD; vereinfacht die Join-Berechnung und den Export.

4. **seamLine-Ableitung**  
   Siehe Abschnitt 2.2: Zielbild ist seamLine = Master, cutLine = abgeleitet. Bei bestehender cutLine→seamLine-Logik: cutLine an Nahtecken anpassen, seamLine weiter aus (angepasster) cutLine ableiten; seamLine konzeptionell unverändert (Nähgeometrie).

5. **Notches / softVertices auf der Nahtkante**  
   **Klärung:** Für **Version 1 ignorieren**. Notches liegen auf der Naht, nicht an der Ecke; die Nahtecken sind die beiden Haupt-Eckpunkte (Anfang/Ende der curveIndices).

6. **DXF / AAMA / ASTM**  
   **Klärung:** Keine Probleme. Der Export interessiert sich nur für die **cutLine-Geometrie**; die angepasste Nahtecke ist Teil dieser Geometrie. Norm-spezifische Anforderungen an Eckenform ggf. später prüfen.

7. **Undo / Stabilität**  
   Noch offen: Soll die Nahtecken-Anpassung bei jeder relevanten Änderung automatisch laufen oder nur auf explizite Aktion („Nahtecken anpassen“)? Letzteres kann die Vorhersehbarkeit erhöhen (kein Überschreiben manuell gesetzter Ecken ohne Nutzeraktion).

---

## 7. Kurzfassung

- **Problem:** An Nahtecken (Enden zugeordneter Nahtkanten) sind die cutLines der beiden Teile nicht bündig, obwohl die seamLines übereinstimmen.  
- **Lösungsrichtung:** Über SeamAssignments die Nahtecken finden; nur die **cutLine** an diesen Ecken anpassen (Join-Typ z. B. MITER); **seamLine** nie direkt ändern.  
- **Gedankenmodell:** Rechts-auf-Rechts-Klappen (ein Teil gedanklich auf das andere legen) erklärt die Zielgeometrie. **Implementierung:** Vereinfachter Miter-Join pro Nahtecke (Normale S1, Normale S2, je um seamAllowance offsetten, Schnittpunkt = cutLine-Vertex); beide Teile gleiche Regel → automatisch bündig.  
- **Architektur:** Corner-Typ pro **SeamAssignment-Ende** (startCornerType, endCornerType: MITER | BEVEL | ROUND | CUSTOM); Berechnung pro SeamAssignment-Ende, beide Teile anpassen.  
- **Nächste Schritte (bei Umsetzung):** SeamAssignment um startCornerType/endCornerType und startCornerManual/endCornerManual erweitern; Miter-Join an seamLine-Segmenten S1/S2 mit definierter Polygonorientierung und miterLimit; Nahtecken überschreiben defaultJoin; nur cutLine-Vertices setzen; ggf. langfristig seamLine = Master, cutLine = abgeleitet.

Dieses Dokument dient der Reflexion und als Grundlage für spätere Implementierung; es wird bewusst noch **kein Code** geändert.

---

## Bewertung (Einordnung)

| Bereich             | Einordnung |
|---------------------|------------|
| Domänenlogik        | seamLine unverändert, cutLine = Materialzugabe; Nahtecke durch SeamAssignment bestimmt, existiert auf beiden Teilen. |
| Geometrieverständnis| Klappen-Modell für Verständnis; Implementierung ohne Klappen (lokaler Join an seamLine S1/S2, Orientierung + miterLimit). |
| Systemintegration   | Anbindung an SeamAssignment; Corner pro Naht-Ende statt global. |
| Umsetzbarkeit       | Vereinfachter Algorithmus ohne Klappen/Spiegeln; nur Vertex-Positionen anfassen. |
