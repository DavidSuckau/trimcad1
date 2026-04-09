## Repro-Checklist (Go-Live): Seam/Master, Notches, SeamAssignment

Ziel: Nach jeder Änderung an Seam-/Notch-Logik sicherstellen, dass keine „Notch-Sprünge“, keine kaputten Indizes und keine fehlerhafte Master-Auswahl auftreten.

### 1) SeamInsertion: Punkt-Insert auf `seamLine` (Master)
1. Lade oder erstelle ein Teil mit gültiger `seamAllowanceMm` (damit ist `seamLine` der Master).
2. Aktiviere im UI `curvepoint` (bzw. den Punkt-Insert-Workflow) und klicke auf der Kontur so, dass ein Segment auf der `seamLine` getroffen wird.
3. Beobachte: `seamLine` bekommt genau den neuen Kurven-/Eckpunkt, und `cutLine` folgt daraus (kein direktes Edit von `cutLine` nötig/erkennbar).
Erwartung:
- Keine „disappearing points“.
- Keine unplausiblen Master-/Index-Sprünge in der Vorschau.

### 2) Verankerte Kerbe: anchored + `seamAllowance` apply + Vertex-Edit
1. Füge mindestens eine Kerbe so ein, dass sie verankert ist (Corner/Vertex-Modus so, dass `vertexIndex` gesetzt bleibt).
2. Setze/aktualisiere anschließend `seamAllowanceMm` (damit `cutLine` neu aus `seamLine` abgeleitet wird).
3. Danach: verschiebe oder entferne den betreffenden Vertex (z. B. über den Vertex-Edit-Workflow).
Erwartung:
- Die Kerbe bleibt geometrisch auf der neuen `cutLine` (keine Sprünge zu einer falschen Ecke).
- Die Kerbe wird nach dem Resync korrekt weiterhin als „verankert“ behandelt (UI-Ausblendung/Kein zusätzlicher roter Punkt an falscher Ecke).

### 3) Nahtzuordnung: `nahtzuordnungMode` zwischen zwei Teilen (Master-Kontur konsistent)
1. Erstelle/lege zwei Teile an, bei denen (je nach Setup) `seamAllowanceMm` so gesetzt ist, dass der Master auf beiden Kanten konsistent sein kann.
2. Wechsle in den Modus `nahtzuordnungMode`: erst „first“, dann „second“.
3. Klicke zuerst am inneren Bereich der richtigen Kante (soll auf dem Master `seamLine` basieren, falls Nahtzugabe aktiv), danach auf dem zweiten Teil.
Erwartung:
- `SeamAssignment` verwendet die korrekten Master-`curveIndex`-Basen.
- Nachfolgende Aktionen wie Länge-/Notch-Zählung auf der Nahtkante sind stabil (kein „jumping notches“ oder falsche Range).

