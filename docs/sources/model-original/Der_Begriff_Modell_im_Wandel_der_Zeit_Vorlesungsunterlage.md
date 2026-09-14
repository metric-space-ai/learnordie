# Der Begriff „Modell“ im Wandel der Zeit

## Von der Gedankenminiatur über das Naturgesetz zur gelernten, technisch wirksamen Funktion

**Vorlesungsunterlage zur digitalen Transformation in der Produktentwicklung**  
Begleitskript zur Präsentation `Modellbegriff_ThreeJS_clean.html`  
Zielgruppe: Studierende der Ingenieurwissenschaften mit Grundkenntnissen in Mathematik und Mechanik  
Rahmen: 90 Minuten für den Hauptteil; zusätzliche Vertiefungen und Aufgaben für Übung und Selbststudium

---

## Orientierung und Quellenbasis

Die Leitfrage dieser Vorlesung lautet: **Was verändert sich, wenn wir eine gedankliche Vorstellung, eine physikalische Beschreibung und ein großes Sprachmodell mit demselben Wort „Modell“ bezeichnen?**

Ausgangspunkt ist die bereitgestellte Präsentation *Digitale Transformation – Introduction(1).pdf*. Das Skript folgt ihrem Gedankengang: Gegenstände und Beziehungen; mathematische Beschreibungen; Modelle mit Geltungsgrenzen; algorithmische Realisierung; Topologie, Parameter und Schnittstellen; Lern- und Laufzeitumgebung. Die im Gespräch entwickelte Fortführung zum LLM und zur Produktentwicklung bildet den Abschluss. Die späteren PDF-Abschnitte zu Daten, Abständen und Entscheidungsstrukturen werden in den Vertiefungen A und B aufgegriffen.

Das Skript ist eine Ausarbeitung dieser Argumentation, keine lückenlose Geschichte sämtlicher Modellbegriffe. Die Abfolge bezeichnet **Bedeutungserweiterungen**, keine Epochen, in denen jeweils alle früheren Modellformen verschwinden. Auch die Reihenfolge der historischen Beispiele in der Vorlage ist argumentativ, nicht durchgehend chronologisch.

Quellen werden im Text mit Kurzbezeichnungen genannt: **P** bezeichnet die PDF mit ihren tatsächlichen Dateiseiten, **H** die achtteilige HTML-Präsentation einschließlich ihres Programmcodes. Weitere Kurzbezeichnungen verweisen auf die Quellen am Ende. Eigene Herleitungen, Lehrbeispiele und Übertragungen sind als solche bezeichnet. Historische oder mathematische Präzisierungen gegenüber der Vorlage stehen ausdrücklich dabei; sie sind keine stillschweigende Wiedergabe der ursprünglichen Folien.

### Lernziele

Nach der Veranstaltung sollen Studierende:

1. erklären können, wie sich Abbild, mathematische Beschreibung und gelernte Funktion im Modellbegriff unterscheiden und verbinden;
2. Modellstruktur, Parameter, Lernverfahren, Schnittstelle und Laufzeitumgebung auseinanderhalten können;
3. an einfachen Gleichungen nachvollziehen können, was bei einer Modellauswertung und was bei einer Parameteranpassung geschieht;
4. begründen können, weshalb ein ausführbares oder gelerntes Modell weder automatisch ein Naturgesetz noch bereits eine geeignete technische Lösung ist.

### Inhalt

1. [Ein Begriff im Wandel: die leitende Unterscheidung](#1-ein-begriff-im-wandel-die-leitende-unterscheidung)
2. [Die Gedankenminiatur: Wirklichkeit vorstellbar machen](#2-die-gedankenminiatur-wirklichkeit-vorstellbar-machen)
3. [Das Naturgesetz: Beziehungen mathematisch ausdrücken](#3-das-naturgesetz-beziehungen-mathematisch-ausdrücken)
4. [Das Naturgesetz als Modell: Beschreibung und Geltungsbereich](#4-das-naturgesetz-als-modell-beschreibung-und-geltungsbereich)
5. [Das ausführbare Modell: vom Abbild zur Wirkung](#5-das-ausführbare-modell-vom-abbild-zur-wirkung)
6. [Das gelernte Modell: die Entstehung der Funktion gestalten](#6-das-gelernte-modell-die-entstehung-der-funktion-gestalten)
7. [Das LLM: Sprache als Gegenstand und Schnittstelle eines Modells](#7-das-llm-sprache-als-gegenstand-und-schnittstelle-eines-modells)
8. [Die Konsequenz: KI als Methode der Produktentwicklung](#8-die-konsequenz-ki-als-methode-der-produktentwicklung)

**Vertiefungen und Arbeitsmaterialien:** [A – Daten und Ähnlichkeit](#vertiefung-a-von-tabellen-zu-ähnlichkeitsräumen); [B – Entscheidungsstrukturen](#vertiefung-b-von-ähnlichkeit-zu-einer-gelernten-entscheidungsstruktur); [C – Aufgaben und Lösungshinweise](#c-aufgaben-und-lösungshinweise); [D – Ablauf und Demonstrationen](#d-ablauf-und-demonstrationen-für-den-vortrag); [E – Begriffe und Symbole](#e-begriffe-und-symbole); [F – Quellen und Abgrenzungen](#f-quellen-zeitliche-orientierung-und-abgrenzungen).

---

## 1. Ein Begriff im Wandel: die leitende Unterscheidung

*Bezug: H, Folie 1; P, S. 7–11. Die verbindende These ist eine didaktische Synthese aus Vorlage und Gespräch.*

### 1.1 Warum das Wort „Modell“ erklärungsbedürftig ist

Ein verkleinertes Fahrzeug, eine Gleichung zur Beschreibung einer Schwingung und ein Sprachmodell erscheinen zunächst als sehr verschiedene Dinge. Beim Fahrzeugmodell denken wir an ein anschauliches Gegenüber. Bei der Gleichung denken wir an Größen und ihre Beziehungen. Beim Sprachmodell begegnet uns ein System, das auf eine Eingabe reagiert und weitere Sprache erzeugt.

Die Vorlesung nimmt diese Verschiedenheit ernst. Sie versucht nicht, alle drei Gegenstände mit einer möglichst weiten Definition gleichzumachen. Stattdessen fragt sie, welcher Teil der Bedeutung erhalten bleibt und welcher hinzukommt.

Für den hier entwickelten Begriffsgang lässt sich eine gemeinsame Perspektive formulieren: Ein Modell macht ausgewählte Zusammenhänge in einer bestimmten Form zugänglich. Diese Form kann anschaulich, symbolisch, mathematisch oder algorithmisch sein. Entscheidend ist jeweils, **welche Beziehungen erfasst werden und wofür die Darstellung verwendet wird**.

Dabei verschiebt sich der Schwerpunkt:

> Wir stellen uns etwas vor. Wir beschreiben seine Beziehungen. Wir führen eine Beschreibung aus. Wir gestalten ein Verfahren, durch das eine verwendbare Funktion entsteht.

Dies ist die Leitlinie des Skripts. Sie ist keine Behauptung, die Wissenschaft habe historisch exakt vier voneinander getrennte Entwicklungsstufen durchlaufen.

### 1.2 Drei Fragen statt einer einzigen Definition

Damit der Begriff im weiteren Verlauf nicht unscharf wird, unterscheiden wir drei Fragen.

**Worauf bezieht sich das Modell?** Ein Modell kann beispielsweise die Geometrie eines Bauteils, dessen Bewegung oder die Wahrscheinlichkeit einer sprachlichen Fortsetzung betreffen. Schon dadurch unterscheiden sich seine möglichen Aussagen.

**Wie entsteht das Modell?** Eine Person kann Beziehungen explizit formulieren. Parameter können gemessen, geschätzt oder durch ein Lernverfahren angepasst werden. Auch diese Wege können kombiniert werden.

**Wie wird das Modell verwendet?** Es kann eine Überlegung unterstützen, eine Vorhersage liefern oder als ausgeführte Funktion in ein technisches System eingebunden sein.

Die dritte Frage lässt sich nicht aus der zweiten beantworten. Ein von Hand formuliertes Modell kann technisch wirksam werden. Ein gelerntes Modell kann ausschließlich der Auswertung von Versuchsdaten dienen. **„Gelernt“ und „ausführbar“ bezeichnen unterschiedliche Eigenschaften.** Diese Trennung wird durch die Lern- und Laufzeitumgebungen der Vorlage vorbereitet. (P, S. 10–11.)

### 1.3 Die Vorlesungsthese

Der Bedeutungswandel lässt sich zunächst so zuspitzen:

$$
\text{gedankliches Abbild}
\;\longrightarrow\;
\text{mathematische Beschreibung}
\;\longrightarrow\;
\text{gelernte, ausführbare Funktion}.
$$

Der letzte Ausdruck enthält jedoch zwei Veränderungen: **Lernen betrifft die Entstehung, Ausführung betrifft die Verwendung.** Deshalb werden beide in eigenen Kapiteln behandelt.

Für die Produktentwicklung folgt daraus als Arbeitsthese: Ingenieurmäßiges Gestalten beschränkt sich nicht auf das direkte Formulieren einer technischen Funktion. Es kann zusätzlich die Auswahl der Daten, die Festlegung der Modellstruktur, die Gestaltung des Lernverfahrens und die Prüfung der entstandenen Funktion umfassen.

---

## 2. Die Gedankenminiatur: Wirklichkeit vorstellbar machen

*Bezug: H, Folie 2; P, S. 2 und 7. Das Feder-Masse-System ist das Lehrbeispiel der HTML-Präsentation.*

### 2.1 Ein Stellvertreter, kein zweites Original

Eine Gedankenminiatur ist eine vereinfachte Vorstellung, an der wir einen Zusammenhang untersuchen können. „Miniatur“ bedeutet hier nicht zwingend maßstäbliche Verkleinerung. Gemeint ist, dass etwas Unübersichtliches in eine geistig handhabbare Form gebracht wird.

Wir stellen uns beispielsweise eine Masse vor, die an einer Feder schwingt. Zunächst mögen eine Halterung, die Befestigung der Feder, die Oberflächen der Bauteile und das umgebende Gestell dazugehören. Für die Frage nach der Schwingungsdauer müssen wir aber nicht alles gleichermaßen berücksichtigen.

Das Modell steht für etwas anderes. Es ist weder der vollständige Gegenstand noch eine vollständige Beschreibung seiner Eigenschaften. In dieser Funktion greift es den Abbild- und Gedankenkonstruktbegriff auf, von dem Seite 7 der Vorlage ausgeht. (P, S. 7.)

### 2.2 Gegenstände oder Beziehungen? Der philosophische Einstieg

Die Vorlage eröffnet mit einer Gegenüberstellung: Auf der einen Seite stehen materielle Elemente und ihre Anordnung; auf der anderen Ideen, Abbilder und Beziehungen. Sie verbindet diese Perspektiven mit Demokrit und Platon. Für den Aufbau der Vorlesung hat diese Gegenüberstellung eine klare Aufgabe: Sie macht den Unterschied zwischen **„Woraus besteht etwas?“** und **„Wie hängt etwas zusammen?“** sichtbar. (P, S. 2.)

**Historische Präzisierung:** Diese Gegenüberstellung darf nicht wörtlich als vollständige Darstellung beider Philosophien gelesen werden. Aristoteles berichtet über Leukipp und Demokrit, dass Unterschiede unter anderem auf Gestalt, Anordnung und Lage der Elemente zurückgeführt werden. Platon unterscheidet im *Timaios* dagegen ausdrücklich das beständig Seiende vom Werdenden und spricht vom Verhältnis zwischen Vorbild und Abbild. Die Wendung „Alles ist im Fluss“ ist daher keine geeignete Zusammenfassung von Platons Ideenlehre. Das Skript übernimmt die didaktische Unterscheidung der Vorlage, nicht diese pauschale Zuschreibung. [Aristoteles, Buch I, Kap. 4; Platon, 27d–29b.]

Als Gedankenexperiment lässt sich ein Feder-Masse-System entsprechend zweimal beschreiben. Einmal zählen wir seine Teile auf. Ein anderes Mal fragen wir nach der Beziehung zwischen Auslenkung, Rückstellkraft und Bewegung. Beide Beschreibungen betreffen denselben Gegenstand, beantworten aber verschiedene Fragen.

### 2.3 Abstraktion und Idealisierung

Für die folgenden Beispiele verwenden wir eine eigene begriffliche Unterscheidung:

**Abstraktion** bedeutet, bestimmte Aspekte nicht zu berücksichtigen. Wenn die Farbe des Gestells für unsere Schwingungsfrage keine Rolle spielt, lassen wir sie weg.

**Idealisierung** bedeutet, einen Sachverhalt in einer vereinfachten Grenzform anzunehmen. Wir behandeln die Feder beispielsweise als linear und masselos oder vernachlässigen Reibung.

Diese Unterscheidung hilft zu erkennen, warum ein Modell nicht durch möglichst viele Details automatisch besser wird. Für eine Montageplanung kann die räumliche Form der Befestigung wichtig sein. Für eine erste Untersuchung der Schwingung kann dieselbe Form entbehrlich sein. Umgekehrt ist eine rein geometrische Miniatur möglicherweise ungeeignet, um den zeitlichen Verlauf einer Bewegung zu erklären.

Im gewählten Beispiel ist deshalb nicht die Frage entscheidend, wie viel vom Original übrig bleibt. Entscheidend ist, ob die für die Aufgabe benötigten Beziehungen erhalten bleiben.

### 2.4 Was die erste Animation zeigen soll

In der HTML-Präsentation entfernt der Regler „Abstraktion“ körperliche Details des Feder-Masse-Systems. Die Demonstration ist eine visuelle Vereinfachung, kein Verfahren zur automatischen physikalischen Modellreduktion. (H, Folie 2.)

Eine geeignete Frage an die Studierenden lautet: **Welche Information verlieren wir – und für welche Aufgabe wäre dieser Verlust problematisch?**

Die mögliche Antwort soll nicht einfach „weniger Details“ heißen. Wer die Befestigung entfernt, verliert beispielsweise Aussagen über ihre konstruktive Ausführung. Wer die Feder nur noch als Wirkbeziehung betrachtet, kann ihre Funktion untersuchen, ohne ihre konkrete Fertigungsform zu beschreiben.

Der Übergang zum nächsten Kapitel entsteht genau hier: Ein Modell muss seinem Gegenstand nicht ähnlich sehen, wenn es dessen relevante Beziehungen auf andere Weise zugänglich macht.

---

## 3. Das Naturgesetz: Beziehungen mathematisch ausdrücken

*Bezug: H, Folie 3; P, S. 3. Die nachfolgende Rechnung ist eine eigene Herleitung des bereits in H verwendeten Lehrbeispiels.*

### 3.1 Von Eigenschaften zu berechenbaren Zusammenhängen

Die Newton-Passage der Vorlage verbindet Gegenstände und mathematische Beziehungen. Sie beschreibt den Übergang zu quantitativen Aussagen über Bewegung. Historischer Bezugspunkt sind Newtons *Philosophiae Naturalis Principia Mathematica* von 1687. Die dortigen Bewegungsgesetze werden im Folgenden in heutiger Schreibweise verwendet, nicht als wörtliches Formelzitat der Originalausgabe. (P, S. 3; [Newton].)

Die gedankliche Veränderung lautet: Wir fragen nicht mehr nur, wie wir uns einen Vorgang vorstellen können. Wir fragen, welche Größen ihn beschreiben und welche mathematische Beziehung zwischen ihnen besteht.

Für eine konstante Masse schreiben wir im betrachteten eindimensionalen Fall:

$$
F = m\ddot{x}.
$$

Dabei ist $F$ die resultierende Kraft, $m$ die Masse und $\ddot{x}$ die Beschleunigung. Der Punkt bezeichnet die Ableitung nach der Zeit; zwei Punkte bezeichnen die zweite Ableitung. Die Form setzt unter anderem eine geeignete Bezugssystemwahl und die im Beispiel konstant gehaltene Masse voraus. [Newton; moderne Darstellung.]

### 3.2 Aus Annahmen entsteht ein konkretes Modell

Wir betrachten eine lineare Feder mit der Steifigkeit $k$. Die Koordinate $x$ misst die Auslenkung aus der Gleichgewichtslage. Positive Auslenkung erzeugt eine negative Rückstellkraft:

$$
F_\mathrm{Feder} = -kx.
$$

Unser Lehrmodell vernachlässigt Dämpfung und äußere zeitabhängige Anregung. Bei einer vertikalen Anordnung ist die konstante Gewichtskraft bereits durch die Wahl der Gleichgewichtslage berücksichtigt. Es folgt:

$$
m\ddot{x} = -kx
\qquad\Longleftrightarrow\qquad
m\ddot{x}+kx=0.
$$

Diese Gleichung ist nicht der Gegenstand selbst. Sie ist auch nicht unabhängig von den eben genannten Annahmen. Das konkrete Feder-Masse-Modell verbindet vielmehr eine allgemeine mechanische Beziehung mit einer idealisierten Beschreibung der Feder und einer Systemabgrenzung.

Damit wird eine wichtige Unterscheidung sichtbar: **Ein allgemeines Gesetz und ein konkretes Modell, das dieses Gesetz verwendet, sind nicht ohne Weiteres dasselbe.** Im Lehrbeispiel ist die Bewegungsgleichung das Ergebnis mehrerer Festlegungen, nicht eine voraussetzungslose Beschreibung jeder denkbaren Feder.

### 3.3 Eine Gleichung ist noch keine bestimmte Bewegung

Zur Bewegungsgleichung benötigen wir Anfangsbedingungen. Für die Animation wählen wir:

$$
x(0)=A,
\qquad
\dot{x}(0)=0.
$$

Die Masse wird also aus der Auslenkung $A$ ohne Anfangsgeschwindigkeit freigegeben. Mit

$$
\omega=\sqrt{\frac{k}{m}}
$$

ergibt sich:

$$
x(t)=A\cos(\omega t),
\qquad
\dot{x}(t)=-A\omega\sin(\omega t).
$$

Die Lösung lässt sich durch zweimaliges Ableiten prüfen:

$$
\ddot{x}(t)=-A\omega^2\cos(\omega t)
            =-\frac{k}{m}x(t).
$$

Einsetzen liefert wieder $m\ddot{x}+kx=0$. Auch die beiden Anfangsbedingungen sind erfüllt.

Diese Rechnung zeigt drei Ebenen: Die **Modellgleichung** beschreibt den Zusammenhang. Die **Anfangsbedingungen** bestimmen den betrachteten Fall. Die **Lösung** liefert den Verlauf für diesen Fall.

### 3.4 Ein numerisches Beispiel aus der Präsentation

Die HTML-Demonstration verwendet $m=1\,\mathrm{kg}$ und $A=0{,}65\,\mathrm{m}$. Wählen wir $k=4\,\mathrm{N/m}$, erhalten wir:

$$
\omega=2\,\mathrm{rad/s},
\qquad
T=\frac{2\pi}{\omega}=\pi\,\mathrm{s}\approx3{,}142\,\mathrm{s}.
$$

Nach einer Sekunde ist die Auslenkung:

$$
x(1\,\mathrm{s})=0{,}65\cos(2)\,\mathrm{m}
\approx-0{,}2705\,\mathrm{m}.
$$

Die Zahlen sind Ergebnisse des Lehrmodells, keine Messdaten eines realen Versuchs. Erhöhen wir $k$ von $4$ auf $9\,\mathrm{N/m}$, wächst $\omega$ von $2$ auf $3\,\mathrm{rad/s}$. Die Schwingungsdauer sinkt entsprechend auf etwa $2{,}094\,\mathrm{s}$. Die Masse muss dafür nicht anders aussehen. Eine veränderte Beziehung genügt, um einen veränderten Verlauf zu berechnen. (H, Folie 3; eigene Auswertung.)

Auch eine Einheitenkontrolle ist möglich. Aus

$$
\frac{k}{m}
\;\sim\;
\frac{\mathrm{N/m}}{\mathrm{kg}}
=\frac{1}{\mathrm{s}^2}
$$

folgt die passende Dimension der Kreisfrequenz. Eine formal richtig aussehende Gleichung muss also zusätzlich zu den Größen und Einheiten passen, die wir ihr zuordnen.

### 3.5 Die Bedeutung des Schritts

Das Modell hat gegenüber der Gedankenminiatur etwas gewonnen: Es ermöglicht quantitative Folgerungen. Zugleich verlangt es eine explizite Entscheidung darüber, welche Größen vorkommen, wie sie definiert sind und welche Beziehungen wir voraussetzen.

Seine Güte hängt nicht mehr hauptsächlich von anschaulicher Ähnlichkeit ab. Die zentrale Frage lautet jetzt: **Trifft der berechnete Zusammenhang für den betrachteten Vorgang und unter den genannten Bedingungen zu?**

Damit ist der nächste Übergang vorbereitet. Wenn eine Beschreibung nur unter bestimmten Bedingungen trägt, müssen wir über den Status und die Grenzen dieser Beschreibung sprechen.

---

## 4. Das Naturgesetz als Modell: Beschreibung und Geltungsbereich

*Bezug: H, Folie 4; P, S. 4–6. Historische Präzisierungen und die mechanischen Herleitungen sind gegenüber der Vorlage ausdrücklich ergänzt.*

### 4.1 Hertz: Beschreibungen sind nicht mit ihren Gegenständen identisch

Seite 6 der Vorlage bildet ein Scharnier. Unterschiedliche Beschreibungen der Mechanik führen zur Frage, ob eine mathematische Darstellung die Wirklichkeit selbst wiedergibt oder ein geeignetes Bild ausgewählter Beziehungen ist. Die Folie verbindet diesen Gedanken mit Hertz. (P, S. 6.)

**Historische Präzisierung:** Gemeint ist **Heinrich Hertz**, nicht der in der Vorlage genannte „Friedrich Hertz“. In den 1894 erschienenen *Prinzipien der Mechanik* diskutiert Heinrich Hertz gedankliche Bilder und unterscheidet ihre logische Zulässigkeit, ihre Übereinstimmung mit Erfahrungen und ihre Zweckmäßigkeit. Mehrere Bilder können geeignet sein. Die Vorlagenformulierung, Hertz habe die Ära der Naturgesetze beendet, wird hier als didaktische Zuspitzung behandelt, nicht als belegte historische Abschaffung des Gesetzesbegriffs. [Hertz, Einleitung.]

Für die Vorlesung bleibt die zentrale Folgerung bestehen: Wir müssen zwischen einem Geschehen und seiner Darstellung unterscheiden. Ob eine Darstellung brauchbar ist, lässt sich nicht allein daran entscheiden, wie unmittelbar oder selbstverständlich sie uns erscheint.

### 4.2 Dasselbe Geschehen unter dem Blickwinkel von Kraft und Energie

Am Feder-Masse-System lässt sich diese Unterscheidung ohne neue Technik erklären. Die Kraftbeschreibung lautet:

$$
F=-kx,
\qquad
m\ddot{x}+kx=0.
$$

Eine ergänzende Beschreibung betrachtet die Energie. Wir definieren für das Lehrmodell die Bewegungsenergie $E_\mathrm{kin}$ und die Federenergie $E_\mathrm{pot}$:

$$
E_\mathrm{kin}=\frac12m\dot{x}^2,
\qquad
E_\mathrm{pot}=\frac12kx^2.
$$

Ihre Summe ist:

$$
E=\frac12m\dot{x}^2+\frac12kx^2.
$$

Wir leiten diese Summe nach der Zeit ab:

$$
\frac{\mathrm dE}{\mathrm dt}
=m\dot{x}\ddot{x}+kx\dot{x}
=\dot{x}\bigl(m\ddot{x}+kx\bigr)=0.
$$

Die Gesamtenergie bleibt im gewählten Modell konstant. Bei maximaler Auslenkung ist die Geschwindigkeit null; in der Gleichgewichtslage ist die Federenergie null und die Bewegungsenergie maximal. Für $k=4\,\mathrm{N/m}$ und $A=0{,}65\,\mathrm{m}$ erhalten wir:

$$
E=\frac12kA^2=0{,}845\,\mathrm J.
$$

Diese Herleitung ist ein eigenes Rechenbeispiel zur Animation. Sie zeigt, wie eine Eigenschaft derselben Bewegung aus der Bewegungsgleichung folgt. **Die skalare Aussage „Die Energie bleibt konstant“ ist für sich allein noch keine vollständige zeitliche Bewegungslösung.** Dazu fehlen insbesondere die konkrete Entwicklung entlang der Bahn und die erforderlichen Anfangsbedingungen. (H, Folie 4; eigene Herleitung.)

### 4.3 Vertiefung: eine weitere mathematische Form

Die Vorlage erwähnt auch den Lagrange-Formalismus. Für unser Beispiel können wir eine Lagrange-Funktion definieren:

$$
\mathcal L(x,\dot{x})
=\frac12m\dot{x}^2-\frac12kx^2.
$$

Wenden wir die Euler-Lagrange-Gleichung an,

$$
\frac{\mathrm d}{\mathrm dt}
\left(\frac{\partial\mathcal L}{\partial\dot{x}}\right)
-\frac{\partial\mathcal L}{\partial x}=0,
$$

erhalten wir erneut:

$$
m\ddot{x}+kx=0.
$$

Dies ist eine eigene Ausarbeitung des in P, S. 6 genannten Formalismus. Im betrachteten Beispiel stimmen die resultierenden Bewegungsgleichungen überein. Daraus folgt weder die Gleichwertigkeit beliebiger Modelle noch, dass jedes Energieargument automatisch eine vollständige alternative Mechanik darstellt.

### 4.4 Warum die Vorlage Gauß, Hilbert und Einstein einschiebt

Die Seiten 4 und 5 erweitern den Blick auf mathematische Räume. Ihre argumentative Funktion ist, die Bindung mathematischer Beschreibung an die unmittelbar anschauliche Umwelt zu lockern. Die Darstellung von Beziehungen muss nicht auf das beschränkt bleiben, was wir uns als dreidimensionalen Alltagsraum vorstellen. (P, S. 4–5.)

**Mathematische Präzisierung:** „Nichteuklidisch“ bedeutet nicht einfach „mehr als drei Dimensionen“. Der Raum $\mathbb R^{20}$ mit dem üblichen Skalarprodukt ist euklidisch. Umgekehrt kann bereits eine zweidimensionale Geometrie nichteuklidische Eigenschaften besitzen. Dimension und geometrische Struktur beantworten unterschiedliche Fragen.

Hilberts *Grundlagen der Geometrie* von 1899 eignen sich als Bezugspunkt für die zweite Frage: Welche Beziehungen und Schlussfolgerungen folgen aus bestimmten Axiomen? Das Werk untersucht ausdrücklich auch die Unabhängigkeit des Parallelenaxioms. Die Frage nach der logischen Struktur einer Geometrie ist von der Frage zu trennen, welche Geometrie einen physischen Sachverhalt angemessen beschreibt. [Hilbert, Einleitung und §§ 1, 10.]

Einsteins Darstellung der allgemeinen Relativitätstheorie von 1916 verbindet die Beschreibung von Gravitation mit der Geometrie der Raumzeit. Für unseren Begriffsgang ist daran wichtig, dass eine nicht unmittelbar alltagsanschauliche mathematische Struktur physikalisch relevant sein kann. **Präzisierung zur Vorlage:** Relativistische Effekte bei hohen Geschwindigkeiten sind nicht gleichbedeutend mit gravitativer Raumzeitkrümmung. Spezielle Relativität und allgemeine Relativität dürfen hier nicht in einer einzigen Bedingung „große Massen oder große Geschwindigkeiten“ zusammengezogen werden. [Einstein, insbesondere Teil A.]

Hertz wird in der Vorlage nach Einstein behandelt, obwohl die genannten *Prinzipien der Mechanik* früher erschienen. Diese Reihenfolge dient der Argumentation; sie ist keine zeitliche Reihenfolge der Veröffentlichungen.

### 4.5 Geltungsgrenzen sind eine Eigenschaft guter Modellierung

Für unser Feder-Masse-Modell lassen sich die Grenzen konkret benennen. Wird die Feder stark nichtlinear, ist $F=-kx$ möglicherweise ungeeignet. Ist die Dämpfung wesentlich, fehlt ein Term. Wird die Feder selbst dynamisch relevant, reicht eine einzige konzentrierte Masse unter Umständen nicht aus.

Als eigene Erweiterung kann ein gedämpftes, angeregtes Lehrmodell geschrieben werden:

$$
m\ddot{x}+c\dot{x}+kx=F_\mathrm{ext}(t).
$$

Hier bezeichnet $c$ einen Dämpfungsparameter und $F_\mathrm{ext}$ eine äußere Anregung. Die ursprüngliche Gleichung wird dadurch nicht bedeutungslos. Sie bleibt der einfachere Spezialfall unserer erweiterten Beschreibung.

Die Lernaufgabe lautet daher nicht, zwischen „vollständig wahr“ und „wertlos“ zu wählen. Sie lautet, eine Modellbehauptung mit einer Fragestellung, ihren Annahmen und ihrer empirischen Bewährung zu verbinden. Der Ausdruck „Modell“ ist kein Freibrief für Beliebigkeit.

**Zwischenergebnis:** Aus der mathematischen Beschreibung wird eine bewusst gewählte Darstellung mit einem bestimmten Geltungsbereich. Der nächste Schritt verändert nicht nur den Erkenntnisanspruch, sondern die technische Rolle dieser Darstellung.

---

## 5. Das ausführbare Modell: vom Abbild zur Wirkung

*Bezug: H, Folie 5; P, S. 7 und 9–11. Die technische Einordnung und die folgenden Formalisierungen arbeiten die dortigen Schaubilder aus.*

### 5.1 Ein Modell eines Systems und ein Modell im System

Bis hierhin haben wir Modelle vor allem als Erkenntnismittel betrachtet. Ein Mensch kann mit ihnen nachdenken, rechnen und Vorhersagen treffen. Seite 7 der Vorlage verschiebt diese Perspektive: Eine Funktion lässt sich algorithmisch realisieren und in Hardware ausführen. Über ihre Einbindung kann sie reale technische Vorgänge beeinflussen. (P, S. 7.)

Die Zuspitzung der Vorlesung lautet:

> Aus einem Modell **eines** Systems kann ein Modell **im** System werden.

Diese Formulierung bezeichnet einen Rollenwechsel, keine Verwandlung von Mathematik in Materie. Eine Gleichung bewegt allein noch keinen Motor. Technische Wirksamkeit entsteht durch ihre Implementierung, die Ausführung auf Hardware und die Verbindung zu Ein- und Ausgängen.

Eine ausgeführte Simulation kann beispielsweise nur eine Darstellung auf dem Bildschirm erzeugen. Dieselbe oder eine verwandte Berechnung kann in einer anderen Einbindung einen Sollwert für einen Aktor liefern. Die mathematische Beschreibung muss dafür nicht vollständig wechseln; ihre Verwendung und ihre Schnittstellen ändern sich. Das ist eine didaktische Ableitung aus der Unterscheidung von Modell, Interface und Laufzeitumgebung in der Vorlage. (P, S. 10.)

### 5.2 Das Kästchen mit dem Buchstaben f

Seite 9 reduziert die Frage „Was ist ein Modell?“ auf:

$$
y=f(x).
$$

Diese Schreibweise ist in der Vorlesung ein nützliches Schema: Einer Eingabe wird eine Ausgabe zugeordnet. Sie ist aber keine vollständige Definition sämtlicher wissenschaftlicher Modelle. Die Bewegungsgleichung aus Kapitel 3 ist zunächst eine Differentialgleichung; zur Auswertung eines bestimmten Verlaufs braucht sie zusätzlich Anfangsbedingungen und ein Lösungsverfahren.

Für die folgenden technischen Beispiele erweitern wir das Schema zu:

$$
y=f_\theta(x),
$$

wobei $\theta$ die Parameter bezeichnet. Die Struktur der Funktion legen wir zunächst fest. Seite 10 der Vorlage nennt dafür Topologie, Elemente sowie Parameter beziehungsweise Gewichte. (P, S. 9–10.)

Mit **Topologie** ist in diesem technischen Zusammenhang die Anordnung und Verknüpfung der Verarbeitungselemente gemeint. Bei einem Polynom können das Potenzbildung, Gewichtung und Addition sein. Bei einer anderen Struktur können es verknüpfte Verarbeitungsschichten oder Entscheidungszweige sein. Der Begriff wird hier als Strukturbegriff verwendet, nicht als vollständige Einführung in das mathematische Gebiet der Topologie.

### 5.3 Warum die Schnittstelle Teil der Aufgabe ist

Eine Größe im Rechner erhält ihre technische Bedeutung erst durch eine festgelegte Interpretation. Im Lehrbeispiel könnte der Eingabewert $0{,}5$ einen normierten Stellwunsch bezeichnen. In einer anderen Anwendung könnte dieselbe Zahl eine Zeit, Temperatur oder Wahrscheinlichkeit bedeuten.

Wir können die technische Einbindung schematisch schreiben als:

$$
\text{Eingangssignal}
\xrightarrow{\text{Aufbereitung}}
x
\xrightarrow{f_\theta}
y
\xrightarrow{\text{Interpretation}}
\text{technische Ausgabe}.
$$

Diese Darstellung ist eine eigene Ausarbeitung des Interfaces aus P, S. 10. Sie macht sichtbar, warum die richtige Funktion allein nicht genügt. Auch Einheit, Wertebereich, zeitliche Bedeutung und Zuordnung der Signale müssen passen.

Für einen zeitabhängigen Prozess kann ein Zustandsmodell hilfreicher sein:

$$
z_{n+1}=F_\theta(z_n,u_n),
\qquad
y_n=G_\theta(z_n,u_n).
$$

Hier bezeichnet $z_n$ den internen Zustand zum diskreten Zeitpunkt $n$, $u_n$ die Eingabe und $y_n$ die Ausgabe. Diese zusätzliche Schreibweise zeigt, wie das einfache Kästchen-Pfeil-Schema erweitert werden kann. Sie ist kein weiteres Modell, das die HTML-Demonstration tatsächlich implementiert.

### 5.4 Was die Stellwinkel-Demonstration zeigt

Die HTML-Präsentation verwendet eine bewusst einfache Zuordnung:

$$
y=60^\circ\cdot x,
\qquad -1\leq x\leq1.
$$

Bei $x=0{,}5$ ist der ausgegebene Sollwinkel $30^\circ$. Solange die Ausführung aktiv ist, folgt der simulierte Zeiger einer Änderung des Eingangs. Wird „Ausführung anhalten“ gewählt, bleiben der ausgegebene Wert und die Stellbewegung in der Demonstration erhalten, auch wenn der Eingaberegler verändert wird. (H, Folie 5 und Programmcode.)

Dieses Verhalten ist eine didaktisch gewählte Simulation. Es ist keine allgemeine Aussage darüber, wie ein reales Gerät beim Anhalten eines Programms reagieren würde, und keine sicherheitstechnische Auslegung.

An diesem Beispiel ist nichts gelernt. Die Zuordnung wurde direkt festgelegt. Dennoch wird sie ausgeführt und beeinflusst einen simulierten Zustand. Genau deshalb müssen Ausführung und Lernen begrifflich getrennt bleiben.

### 5.5 Die neue Entwicklungsfrage

Bisher fragte die Modellbildung vor allem: Welche Beschreibung ist geeignet? Mit der Implementierung kommt hinzu: **Wie wird diese Beschreibung Teil einer technisch definierten Wirkungskette?**

Ein Modell kann nun Gegenstand einer technischen Gestaltung sein, nicht nur Hilfsmittel dafür. In der Logik der Vorlage ist dies ein entscheidender Teil der digitalen Transformation. Erst im nächsten Kapitel ändern wir zusätzlich die Art, wie eine solche Funktion entsteht.

---

## 6. Das gelernte Modell: die Entstehung der Funktion gestalten

*Bezug: H, Folie 6; P, S. 11–15. Das Optimierungsproblem und die Rechenschritte sind eigene Ausarbeitungen des dortigen Polynomfittings.*

### 6.1 Vom direkten Festlegen zur Parameterbestimmung

Eine Funktion kann explizit formuliert werden. Im Stellwinkel-Beispiel wurden sowohl die Form als auch der Faktor direkt vorgegeben. Für andere Aufgaben kennen wir zunächst Beispiele für Eingaben und zugehörige Ausgaben, aber noch keine hinreichend passende Parametrisierung.

Die Vorlage beschreibt dafür eine Lernumgebung: Beispieldaten, Modellvorgabe und Lernverfahren wirken zusammen; das entstandene Modell wird anschließend in einer Laufzeitumgebung verwendet. Das Polynomfitting dient als einfaches Beispiel. (P, S. 11–12.)

Die entscheidende Änderung lautet nicht, dass Menschen überhaupt nichts mehr formulieren. Menschen legen vielmehr zusätzlich fest, **innerhalb welcher Möglichkeiten und nach welchem Kriterium eine Funktion bestimmt wird**.

### 6.2 Modellstruktur und Parameter am Polynom

Wir betrachten das quadratische Modell:

$$
\hat y=f_\theta(x)=a_0+a_1x+a_2x^2,
\qquad
\theta=(a_0,a_1,a_2).
$$

Das Dach über $y$ kennzeichnet eine Modellvorhersage. Die Struktur enthält einen konstanten Anteil, einen linearen Anteil und einen quadratischen Anteil. Diese Struktur steht fest. Veränderlich sind die drei Koeffizienten.

Seite 15 der PDF zeigt ein Polynom bis zum vierten Grad. Die HTML-Demonstration verwendet dagegen den zweiten Grad, damit nur drei Parameter angepasst werden müssen. Beide veranschaulichen denselben Gedanken: Potenzen werden gebildet, mit Koeffizienten gewichtet und addiert. Die konkrete Vereinfachung auf den zweiten Grad stammt aus der HTML-Ausarbeitung. (P, S. 15; H, Folie 6.)

Daran lassen sich zwei Eingriffe unterscheiden. Ändern wir $a_2$, verändern wir die Parametrisierung innerhalb derselben Struktur. Ergänzen wir einen Term $a_3x^3$, verändern wir die Modellstruktur und den Raum der möglichen Funktionen.

### 6.3 Was „Lernen“ in diesem Beispiel bedeutet

Gegeben sei eine Datenmenge:

$$
D=\{(x_i,y_i)\}_{i=1}^{N}.
$$

Für eine zunächst gewählte Parametrisierung berechnen wir die Abweichungen:

$$
e_i=f_\theta(x_i)-y_i.
$$

Als Lernkriterium verwenden wir den mittleren quadratischen Fehler:

$$
J(\theta;D)=\frac1N\sum_{i=1}^{N}\bigl(f_\theta(x_i)-y_i\bigr)^2.
$$

Das Quadrat verhindert, dass sich positive und negative Abweichungen in der Summe aufheben. Zugleich werden größere Abweichungen in diesem Kriterium stärker gewichtet. Beides folgt unmittelbar aus der gewählten mathematischen Form.

Das idealisierte Optimierungsziel ist:

$$
\theta^\star\in\operatorname*{arg\,min}_{\theta}J(\theta;D).
$$

Diese Schreibweise bezeichnet die bestmöglichen Parameter innerhalb des betrachteten Optimierungsproblems. Ein tatsächlich ausgeführtes, nach endlich vielen Schritten angehaltenes Verfahren liefert zunächst einen berechneten Parametervektor $\hat\theta$; es ist nicht allein durch die Schreibweise garantiert, dass das globale Minimum erreicht wurde.

Der Lernbegriff ist hier bewusst technisch eng: Parameter werden anhand von Daten und eines Kriteriums verändert. Das Beispiel setzt weder menschliches Verstehen noch Bewusstsein voraus. Es soll zunächst nachvollziehbar machen, wie eine Funktion aus einer gewählten Funktionsfamilie bestimmt werden kann.

### 6.4 Ein nachvollziehbarer Lernschritt

Für das Polynom ergeben sich die Ableitungen:

$$
\frac{\partial J}{\partial a_j}
=\frac{2}{N}\sum_{i=1}^{N}e_i x_i^j,
\qquad j\in\{0,1,2\}.
$$

Für $j=0$ verwenden wir $x_i^0=1$. Ein Schritt des Gradientenabstiegs lautet:

$$
a_j^{(r+1)}
=a_j^{(r)}-\eta\frac{\partial J}{\partial a_j},
$$

wobei $r$ den Lernschritt und $\eta>0$ die Schrittweite bezeichnet.

Für ein eigenes kleines Rechenbeispiel wählen wir die drei Datenpunkte $(-1,1)$, $(0,0)$ und $(1,1)$. Starten wir mit $a_0=a_1=a_2=0$, betragen die Abweichungen $-1$, $0$ und $-1$. Damit ist:

$$
J_0=\frac23,
\qquad
\nabla J=\left(-\frac43,0,-\frac43\right).
$$

Mit $\eta=0{,}1$ erhalten wir nach einem Schritt:

$$
a_0=a_2=\frac{2}{15}\approx0{,}1333,
\qquad a_1=0.
$$

Die Funktion verändert sich, weil das Verfahren ihre Parameter verändert. Die Grundform $a_0+a_1x+a_2x^2$ bleibt bestehen. Dieses Dreipunktbeispiel ist eine Rechenübung und nicht die Datenmenge der HTML-Animation.

### 6.5 Die tatsächliche Berechnung in der HTML-Präsentation

Die Animation verwendet 21 feste synthetische Punkte. Ihre Erzeugung ist im Programmcode vollständig festgelegt:

$$
x_i=-1+\frac{i}{10},
\qquad i=0,\ldots,20,
$$

$$
y_i=0{,}45-0{,}35x_i+0{,}85x_i^2
+0{,}04\sin(2{,}9i)+0{,}025\cos(1{,}8i).
$$

Die letzten beiden Terme erzeugen eine feste Abweichung vom quadratischen Grundverlauf. Es handelt sich nicht um reale Messungen und nicht um bei jedem Start neu gezogenes Zufallsrauschen.

Die Anfangswerte sind $(0{,}3;0{,}32;0{,}05)$, die Schrittweite ist $\eta=0{,}045$. Nach einem vollständigen ersten Lauf von 600 Parameterschritten ergibt eine Nachrechnung der implementierten Aktualisierung ungefähr:

$$
\hat y=0{,}44976-0{,}35090x+0{,}85409x^2.
$$

Der mittlere quadratische Trainingsfehler fällt dabei von etwa $0{,}43353$ auf $0{,}001194$. Die Werte ergeben sich aus dem bereitgestellten Programmcode; sie sind kein Ergebnis eines externen KI-Dienstes. (H, Folie 6; eigene numerische Nachrechnung.)

### 6.6 Training und Auswertung sind verschiedene Vorgänge

Nach dem Lernen lässt sich die Funktion für eine Eingabe auswerten. Für $x=0{,}5$ liefert die eben genannte Parametrisierung ungefähr $\hat y=0{,}48783$.

Beim Verschieben des Eingabereglers bleiben die Parameter unverändert. Dies ist **Auswertung beziehungsweise Inferenz**, nicht ein weiterer Parameterschritt. Beim erneuten Lernen werden dagegen die Parameter verändert. Die Unterscheidung lässt sich kompakt schreiben:

$$
\text{Lernen:}
\quad (D,\text{Struktur},\text{Kriterium},\text{Verfahren})
\longmapsto\hat\theta,
$$

$$
\text{Auswertung:}
\quad x\longmapsto f_{\hat\theta}(x).
$$

Diese beiden Zuordnungen arbeiten die Trennung aus Seite 11 der Vorlage aus.

### 6.7 Was wir aus einem kleinen Trainingsfehler nicht folgern dürfen

Ein geringer Fehler auf $D$ belegt zunächst nur eine gute Anpassung an die betrachteten Daten nach dem verwendeten Kriterium. Er beweist weder ein Naturgesetz noch die Eignung für jede neue Eingabe.

Das lässt sich ohne zusätzliche Theorie sehen: Durch endlich viele Datenpunkte können unterschiedliche Funktionen verlaufen. Sie können an den beobachteten Stellen ähnlich sein und außerhalb dieser Stellen stark voneinander abweichen. Die Daten allein bestimmen deshalb nicht jede mögliche Fortsetzung eindeutig. Die gewählte Struktur ist bereits eine Einschränkung dessen, was das Verfahren überhaupt finden kann.

Für die technische Verwendung müssen daher zusätzliche Fragen beantwortet werden: Welche Eingaben soll das Modell bearbeiten? Welche Daten wurden zur Auswahl von Struktur und Lernbedingungen benutzt? Welche unabhängigen Fälle bleiben für die Prüfung? Welche Abweichungen sind für die Entwicklungsaufgabe relevant?

Auch diese Fragen gehören zur Gestaltung der Funktion. Das Lernverfahren nimmt sie dem Entwicklungsteam nicht automatisch ab.

### 6.8 Die begriffliche Konsequenz

Ein gelerntes Modell bleibt mathematisch und algorithmisch bestimmt. Seine Funktion ist nicht „ohne Regeln“ entstanden. Neu ist in unserem Gedankengang, dass die konkrete Parametrisierung nicht vollständig von Hand festgelegt wird, sondern aus Daten und einem geregelten Anpassungsprozess hervorgeht.

Die Entwicklungsaufgabe verschiebt sich somit von der alleinigen Frage **„Welche Funktion schreibe ich hin?“** zur zusätzlichen Frage **„Wie gestalte ich die Bedingungen, unter denen eine geeignete Funktion entsteht?“**

---

## 7. Das LLM: Sprache als Gegenstand und Schnittstelle eines Modells

*Bezug: H, Folie 7 und Gespräch. Dieser Abschnitt ist die ausdrücklich gewünschte Fortführung; die ursprüngliche PDF enthält keine ausgearbeitete LLM-Erklärung. Die technischen Ergänzungen stützen sich auf die unten genannten Forschungsarbeiten.*

### 7.1 Nicht ein anderer Naturgesetztyp, sondern ein anderer Modellgegenstand

Ein großes Sprachmodell, englisch *Large Language Model* oder LLM, führt den Begriffsgang zu einer gelernten Funktion über sprachlichen Darstellungen. Für diese Vorlesung betrachten wir ein **autoregressives Sprachmodell**: Es bestimmt aus vorhandenem Kontext eine Verteilung möglicher nächster Tokens. Nicht jede denkbare Sprachmodellarchitektur wird damit erfasst. [Bengio; Brown.]

Die grundlegende Schreibweise lautet:

$$
p_\theta(t_i\mid t_1,\ldots,t_{i-1}).
$$

$t_i$ bezeichnet ein Token an Position $i$, die vorhergehenden Tokens bilden den Kontext und $\theta$ die gelernten Parameter. Die Ausgabe ist hier zunächst eine Wahrscheinlichkeitsverteilung, nicht eine physikalische Größe wie Auslenkung oder Kraft.

Der begriffliche Anschluss an Kapitel 6 liegt in den gelernten Parametern. Der Unterschied liegt im Gegenstand, in der Repräsentation und in der verwendeten Struktur. Ein LLM ist nicht einfach ein höhergradiges Polynom und auch kein neues Bewegungsgesetz.

### 7.2 Von Sprache zu einer berechenbaren Darstellung

Ein Token ist nicht notwendig ein vollständiges Wort. Wörter können etwa in Teilworteinheiten zerlegt werden. Sennrich und Kollegen untersuchen solche Einheiten für die neuronale Sprachverarbeitung, unter anderem mithilfe von Byte-Pair-Encoding. Die Kästchen der HTML-Demonstration stehen dagegen vereinfachend für ganze Wörter; sie zeigen keine reale Tokenisierung. [Sennrich; H, Folie 7.]

Gelernte Vektorrepräsentationen erlauben, sprachliche Einheiten in einer mathematisch verarbeitbaren Form darzustellen. Bengio und Kollegen beschreiben bereits 2003 das gemeinsame Lernen solcher Repräsentationen und einer Wahrscheinlichkeitsfunktion für Wortfolgen. Die Bedeutung für unseren Begriffsgang: Nicht nur die Zahlenwerte einer abschließenden Zuordnung, sondern auch interne Darstellungen können Gegenstand des Lernens sein. [Bengio.]

### 7.3 Beziehungen werden kontextabhängig verarbeitet

Die Transformer-Arbeit von Vaswani und Kollegen führt eine Architektur mit Attention und weiteren Verarbeitungsschritten ein. Bei Self-Attention werden Darstellungen verschiedener Positionen miteinander verknüpft. Schematisch lautet ein zentraler Rechenschritt:

$$
\operatorname{Attention}(Q,K,V)
=\operatorname{softmax}\left(\frac{QK^\mathsf T}{\sqrt{d_k}}\right)V.
$$

$Q$, $K$ und $V$ sind aus den Eingabedarstellungen berechnete Matrizen; $d_k$ ist die Dimension der Schlüsselrepräsentationen. Die Softmax-Funktion erzeugt zeilenweise normierte Gewichte. Damit werden Wertvektoren gewichtet zusammengeführt. In einem autoregressiven Decoder verhindert eine Maskierung den Zugriff auf noch nicht verfügbare spätere Tokens. Attention ist dabei nicht die gesamte Architektur; weitere Transformationen und Positionsinformationen gehören dazu. Die ursprüngliche Arbeit von 2017 beschreibt einen Encoder-Decoder-Transformer, nicht bereits jedes spätere LLM. [Vaswani, Abschnitte 3.1–3.5.]

Für den Vortrag muss die Matrixrechnung nicht vollständig hergeleitet werden. Ihre Funktion im Gedankengang ist, die scheinbar sprachliche Oberfläche mit einem ausführbaren mathematischen Verfahren zu verbinden. „Aufmerksamkeit“ bezeichnet hier eine technische Operation und ist nicht als Behauptung über menschliches Erleben zu verstehen.

### 7.4 Wie aus einer Verteilung eine Fortsetzung wird

Zur Verteilung kommt eine Auswahlregel. Schematisch:

$$
\pi_i=p_\theta(\,\cdot\mid t_{<i}),
\qquad
\tilde t_i=\operatorname{Auswahl}(\pi_i).
$$

Das gewählte Token wird dem Kontext hinzugefügt; anschließend kann der nächste Schritt berechnet werden. Die Auswahl kann beispielsweise deterministisch oder stochastisch erfolgen. Der Begriff „Modell“ kann deshalb im Alltag sowohl die gelernte Wahrscheinlichkeitsfunktion als auch das sie ausführende Gesamtsystem meinen. Im Skript halten wir beides auseinander. [Bengio; Brown; eigene Systemabgrenzung.]

Ein didaktisches Beispiel aus der HTML-Datei lautet „Die Halterung muss …“. Die dort angezeigten Kandidaten „steif“, „leicht“ und „montierbar“ sowie ihre Prozentwerte sind fest vorgegeben. Die Szene veranschaulicht die Idee einer möglichen Fortsetzung. **Sie berechnet weder echte Modellwahrscheinlichkeiten noch einen technischen Anforderungskatalog.** (H, Folie 7 und Programmcode.)

Aus diesem Beispiel lässt sich eine eigene Prüfregel ableiten: Die sprachliche Plausibilität einer Anforderung ersetzt nicht ihre Begründung durch die Entwicklungsaufgabe. Aus „Die Halterung muss steif sein“ folgt noch kein zulässiger Verformungswert und keine Aussage über die passende konstruktive Lösung.

### 7.5 Parameterlernen und Anpassung an einen Kontext

Das schematische Lernziel eines autoregressiven Basissprachmodells kann über die beobachteten Tokens formuliert werden:

$$
J(\theta)
=-\sum_i\log p_\theta(t_i\mid t_{<i}).
$$

Die Ausgestaltung des Trainings kann darüber hinausgehen. Ouyang und Kollegen untersuchen beispielsweise eine zusätzliche Anpassung an gewünschtes Antwortverhalten durch Demonstrationen und menschliche Bewertungen. Die Arbeit zeigt zugleich, dass auch solche angepassten Modelle weiterhin Fehler machen können. [Bengio; Ouyang.]

Davon zu unterscheiden ist die Verwendung von Anweisungen oder Beispielen im Kontext. Brown und Kollegen untersuchen Aufgabenbearbeitung durch Texteingaben ohne entsprechende Gradientenaktualisierung während dieser Anwendung. Das Verhalten kann sich also mit dem Kontext verändern, obwohl die Modellparameter fest bleiben. [Brown.]

Daher sind zwei vorschnelle Aussagen zu vermeiden. Erstens bedeutet jede neue Eingabe nicht automatisch ein erneutes Training. Zweitens ist kontextabhängige Anpassung nicht bedeutungslos, nur weil keine Gewichte geändert werden. Begriffe wie „In-Context Learning“ beziehen sich auf eine andere Anpassungsform als die Parameterschritte unseres Polynombeispiels. [Brown.]

### 7.6 Was sich im Modellbegriff verändert

Als eigene Synthese können wir jetzt drei Unterschiede gegenüber der Gedankenminiatur formulieren.

Das Modell muss nicht mehr als anschauliches Gegenüber vorliegen. Es kann als gelernte Struktur bestehen, deren konkrete Leistung erst in der Ausführung sichtbar wird.

Die menschliche Gestaltung liegt nicht ausschließlich in der direkten Formulierung aller einzelnen Beziehungen. Sie betrifft auch Daten, Repräsentationen, Struktur, Lernkriterien und Einbindung.

Sprache wird zugleich möglicher Modellgegenstand und Bedienoberfläche. Dadurch kann ein Mensch eine Funktion verwenden, ohne ihre internen Rechenschritte als Gleichungen zu formulieren. Die Verantwortung, ihre Ergebnisse im Anwendungskontext zu prüfen, verschwindet dadurch jedoch nicht.

Diese Synthese ist keine Aussage, ein LLM sei ein vollständiges Weltmodell oder besitze den Geltungsanspruch eines physikalischen Gesetzes. Sie beschreibt, welche zusätzliche Bedeutung „Modell“ in dieser Vorlesung erhält: **eine gelernte Struktur, die in einer Laufzeitumgebung verwendbare Ausgaben erzeugt.**

---

## 8. Die Konsequenz: KI als Methode der Produktentwicklung

*Bezug: H, Folie 8; Ableitung aus P, S. 7 und 10–15 sowie dem Gespräch. Der nachfolgende Entwicklungsfall ist ein eigenes, fiktives Lehrbeispiel, kein dokumentierter industrieller Anwendungsfall.*

### 8.1 Die Gestaltungsaufgabe erweitert sich

Die Vorlesung endet nicht mit einer Liste von KI-Werkzeugen. Ihre Schlussfolgerung betrifft die Methode des Entwickelns.

Im direkten Vorgehen formuliert ein Entwicklungsteam eine Funktion und ihre technische Realisierung. Im datenbasierten Vorgehen gestaltet es zusätzlich einen Prozess, der eine geeignete Parametrisierung oder Modellstruktur hervorbringen soll. In beiden Fällen müssen die Ergebnisse mit der Entwicklungsaufgabe verbunden werden.

Die Schlussformel der HTML-Präsentation lässt sich daher erläutern als:

$$
\text{Funktion formulieren}
\quad+\quad
\text{Entstehung und Verwendung der Funktion gestalten}.
$$

Dies ist eine Erweiterung, kein Ausschluss der bisherigen ingenieurwissenschaftlichen Methoden. Gerade das Feder-Masse-Beispiel zeigt, dass explizite Beziehungen, experimentell bestimmte Parameter und gelernte Zuordnungen miteinander kombiniert werden können.

### 8.2 Ein fiktiver Entwicklungsfall: eine elastische Halterung

Angenommen, ein Team entwickelt eine Halterung. Für verschiedene Geometrien und Lastfälle sollen Verformungen bewertet werden. Die konkrete Konstruktion und die folgenden Entscheidungen sind erfunden; sie dienen ausschließlich der Anwendung des Vorlesungsgedankens.

Ein erstes vereinfachtes Modell könnte die Halterung über eine effektive Steifigkeit $k_\mathrm{eff}$ beschreiben:

$$
\delta=\frac{F}{k_\mathrm{eff}}.
$$

Das ist hier eine gesetzte Modellannahme für eine betrachtete lineare Beziehung. Sie sagt noch nicht, wie $k_\mathrm{eff}$ für jede Geometrie zu bestimmen ist und unter welchen Belastungen die Annahme trägt.

Ein datenbasiertes Teilmodell könnte dagegen aus ausgewählten Geometriegrößen $g$, einer Lastbeschreibung $u$ und Materialmerkmalen $m_\mathrm{mat}$ eine Verformung schätzen:

$$
\hat\delta=f_\theta(g,u,m_\mathrm{mat}).
$$

Die Schreibweise belegt noch keinen Nutzen. Zunächst muss geklärt werden, ob eine solche Zuordnung für die vorgesehenen Varianten überhaupt geeignet ist, aus welchen Quellen die Referenzwerte stammen und welche Bewertung sie unterstützen soll.

### 8.3 Fünf Entscheidungen, die nicht im Lernalgorithmus verschwinden

**Aufgabe.** Das Team muss sagen, welche Entscheidung besser werden soll. Geht es um ein schnelles Aussortieren ungeeigneter Varianten, um eine Rangfolge oder um einen belastbaren Nachweis? Diese Zwecke erfordern nicht automatisch dieselbe Modellgüte.

**Daten.** Die Beispiele müssen zur Aufgabe passen. Daten aus einem einzigen Lastfall beantworten nicht von selbst Fragen über beliebige andere Lastfälle. Auch die Herkunft eines Zielwerts ist relevant: Messung und Simulation sind unterschiedliche Referenzen mit unterschiedlichen Voraussetzungen.

**Lernen.** Das Team legt Struktur, Eingabedarstellung, Lernkriterium und Verfahren fest. Ein Kriterium, das nur den durchschnittlichen Fehler verkleinert, kann für eine Aufgabe unzureichend sein, bei der einzelne große Unterschätzungen besonders problematisch sind. Diese Aussage folgt aus dem Unterschied zwischen Durchschnitts- und Einzelfallbewertung.

**Prüfen.** Das entstandene Modell wird mit Fällen konfrontiert, die nicht bereits alle seine Gestaltungsentscheidungen bestimmt haben. Es reicht nicht, denselben Datensatz beliebig oft für Anpassung, Auswahl und abschließende Bewertung zu verwenden und anschließend von unabhängiger Prüfung zu sprechen.

**Einsetzen.** Die Ausgabe muss in einen definierten Arbeitsablauf gelangen. Wer oder was verwendet sie? Welche Eingaben werden akzeptiert? Wann wird auf eine genauere Berechnung oder eine andere Prüfung zurückgegriffen? In dieser letzten Entscheidung kehren Schnittstelle und Laufzeitumgebung aus Kapitel 5 wieder.

Die fünf Entscheidungen folgen dem didaktischen Prozessbild der HTML-Folie. Sie sind kein aus der PDF übernommener verbindlicher Standard. (H, Folie 8.)

### 8.4 Wo ein LLM in diesem Fall eine andere Rolle spielen könnte

Zusätzlich könnte ein Sprachmodell einen textlichen Anforderungsentwurf strukturieren oder Fragen zu fehlenden Randbedingungen formulieren. Das wäre jedoch eine andere Modellaufgabe als die Vorhersage einer Verformung.

Ein sprachlich überzeugender Vorschlag darf nicht stillschweigend die Rolle eines mechanischen Nachweises übernehmen. Umgekehrt beantwortet eine genaue Verformungsprognose nicht die Frage, ob die richtigen Anforderungen gewählt wurden.

Im fiktiven Projekt könnten daher verschiedene Modelle nebeneinander verwendet werden: eine explizite mechanische Beziehung, ein gelerntes Prognosemodell und eine Sprachfunktion für die Bearbeitung von Text. Die Vorlesung liefert gerade die Begriffe, um diese Rollen auseinanderzuhalten, statt alles unter dem Wort „KI“ zusammenzufassen.

### 8.5 Was am Ende des Begriffsgangs bleibt

| Perspektive | Zentrale Frage | Was gestaltet oder geprüft wird |
|---|---|---|
| Gedankenminiatur | Wie machen wir uns einen Zusammenhang vorstellbar? | Auswahl, Vereinfachung und Zweck der Darstellung |
| Mathematische Beschreibung | Welche Beziehungen erlauben quantitative Aussagen? | Größen, Gleichungen, Annahmen und Anfangsbedingungen |
| Modell mit Geltungsbereich | Für welche Fragen trägt die Beschreibung? | Übereinstimmung, Grenzen und alternative Darstellungen |
| Ausführbares Modell | Wie wird eine Funktion technisch verwendet? | Algorithmus, Schnittstellen und Laufzeitumgebung |
| Gelerntes Modell | Wie bestimmen wir eine geeignete Funktion aus Daten? | Struktur, Parameter, Daten und Lernverfahren |
| Sprachmodell | Wie wird sprachlicher Kontext in weitere Sprache überführt? | Repräsentation, gelernte Verarbeitung und Ausgabeauswahl |

Die Zeilen sind keine sich ausschließenden Klassen. Eine gelernte Funktion kann beispielsweise gleichzeitig ein Prognosemodell und ein technisch eingebundener Bestandteil sein.

Die Schlussaussage dieser Vorlesung lautet:

> Digitale Transformation verändert nicht nur die Werkzeuge, mit denen wir Modelle bearbeiten. Sie erweitert die Bedeutung des Modells: vom Mittel des Vorstellens und Beschreibens zu einer gestaltbaren, lernbaren und technisch verwendbaren Funktion.

Für die Produktentwicklung heißt das: Wir entwickeln nicht nur mit Modellen. Wir entwickeln auch Modelle, ihre Entstehungsbedingungen und ihre Einbindung als Teile einer technischen Lösung.

---

## Vertiefung A. Von Tabellen zu Ähnlichkeitsräumen

*Bezug: P, S. 16–26. Diese Vertiefung führt die zweite Hälfte der PDF aus. Sie ist nicht als zusätzliche Erklärung auf den acht HTML-Folien vorhanden.*

### A.1 Weshalb dieser Abschnitt zum Modellbegriff gehört

Ein Lernverfahren verarbeitet nicht die Wirklichkeit unmittelbar. Es verarbeitet Daten in einer festgelegten Darstellung. Wenn wir die Entstehung einer Funktion gestalten, müssen wir deshalb auch festlegen, wie die für die Aufgabe relevanten Gegenstände dargestellt und verglichen werden.

Die Vorlage führt von Tabellen über mehrdimensionale Daten zu Abstandsmaßen und Nachbarschaftsgraphen. Der rote Faden bleibt derselbe wie im Hauptteil: Nicht nur die Gegenstände, sondern ihre darstellbaren Beziehungen werden zum Gegenstand der Modellierung. (P, S. 16–25.)

### A.2 Ein Tabelleneintrag muss nicht eine einzelne Zahl sein

In einer einfachen Tabelle bezeichnet eine Zeile einen Datenpunkt und eine Spalte ein Merkmal. Diese vertraute Anordnung legt noch nicht fest, von welchem Typ die Einträge sein müssen.

Auf Seite 27 der PDF enthält eine Spalte beispielsweise einen Vektor, eine weitere eine Ganzzahl, eine dritte eine Zeichenkette und eine vierte eine Gleitkommazahl. Neben diesen Eingaben steht ein Label. Das Schema lautet:

$$
x_i=(x_i^{(1)},x_i^{(2)},x_i^{(3)},x_i^{(4)}),
\qquad y_i\in\{\mathrm{Bus},\mathrm{Train},\mathrm{Car}\}.
$$

Dabei kann $x_i^{(1)}$ selbst ein Vektor sein. Die äußere Tabellenstruktur und die innere Struktur eines Eintrags sind zu unterscheiden. (P, S. 27.)

Eine eigene Übertragung auf die Produktentwicklung wäre eine Zeile, die eine Bauteilvariante beschreibt: ein Zahlenvektor für Geometriemerkmale, ein Profil aus einem Versuch und eine textliche Beschreibung. Diese Interpretation ist ein Lehrbeispiel; die ursprünglichen Spalten $X_1$ bis $X_4$ erhalten dadurch nicht nachträglich eine behauptete technische Bedeutung.

### A.3 Ein Vergleich benötigt eine definierte Beziehung

Für numerische Vektoren gleicher Dimension können wir den euklidischen Abstand verwenden:

$$
d_2(u,v)=\sqrt{\sum_{j=1}^{p}(u_j-v_j)^2}.
$$

Ein anderes Beispiel ist der Manhattan-Abstand:

$$
d_1(u,v)=\sum_{j=1}^{p}|u_j-v_j|.
$$

Beide setzen voraus, dass die verglichenen Komponenten sinnvoll einander zugeordnet sind. Auch ihre Skalierung ist eine Modellierungsentscheidung. Wenn wir dieselbe Länge einmal in Metern und einmal in Millimetern in die Rechnung einsetzen, ändern sich ihre Zahlenwerte und damit ihr Beitrag zu einem nicht angepassten Abstand.

Die Formeln arbeiten die in P, S. 20 genannten Vergleiche aus. Ihre Auswahl ergibt sich nicht allein daraus, dass Daten in einer Tabelle stehen.

### A.4 Was einen metrischen Raum auszeichnet

Für diese Vertiefung verwenden wir die vollständige mathematische Definition. Ein metrischer Raum besteht aus einer Menge $\mathcal X$ und einer Funktion

$$
d:\mathcal X\times\mathcal X\to\mathbb R,
$$

für die für alle $u,v,w\in\mathcal X$ gilt:

$$
\begin{aligned}
&d(u,v)\geq0,\\
&d(u,v)=0\quad\Longleftrightarrow\quad u=v,\\
&d(u,v)=d(v,u),\\
&d(u,w)\leq d(u,v)+d(v,w).
\end{aligned}
$$

Das sind Nichtnegativität, Identität der Ununterscheidbaren, Symmetrie und Dreiecksungleichung. Häufig werden die ersten beiden Bedingungen gemeinsam formuliert.

**Präzisierung zur Vorlage:** Seite 19 nennt unter „Positive Definitheit“ sichtbar nur die Nichtnegativität. Die Bedingung $d(u,v)=0\Leftrightarrow u=v$ wird hier ausdrücklich ergänzt. Außerdem ist eine Distanz ein Maß der Verschiedenheit: Ein kleiner Wert bedeutet Nähe in der gewählten Darstellung. Nicht jedes allgemein als „Ähnlichkeit“ bezeichnete Maß ist eine Metrik.

Das lässt sich an einem eigenen Gegenbeispiel zeigen. Für Einheitsvektoren ist der Ausdruck $1-\cos(\alpha)$ ein naheliegendes winkelbezogenes Unähnlichkeitsmaß. Wählen wir Richtungen bei $0^\circ$, $60^\circ$ und $120^\circ$, betragen die beiden benachbarten Werte jeweils $0{,}5$, der Wert zwischen den äußeren Richtungen aber $1{,}5$. Damit ist die Dreiecksungleichung verletzt. Die Nennung von „Cosine“ in P, S. 20 darf deshalb nicht als Garantie gelesen werden, jede daraus gebildete Distanz sei metrisch.

### A.5 Die drei Strukturperspektiven der Vorlage

Seite 20 unterscheidet „k-related“, „k-structured“ und „k-random“. Das Skript übernimmt diese Bezeichnungen als Begriffe der Vorlage, nicht als Behauptung einer universell verwendeten Klassifikation.

Bei **k-related** stehen einander zugeordnete Merkmalspositionen im Vordergrund. Eine gemeinsame Umordnung derselben Koordinaten in beiden Vektoren verändert beispielsweise den euklidischen Abstand nicht. Das bedeutet nicht, dass die Zuordnung zwischen beliebigen Komponenten vertauscht werden dürfte.

Bei **k-structured** ist die innere Anordnung wesentlich. Bei einer Zeichenfolge oder einem zeitlichen Profil kann es einen Unterschied machen, in welcher Reihenfolge Einträge auftreten. Eine reine positionsweise Differenz kann dann eine andere Frage beantworten als ein Vergleich, der Verschiebungen oder Einfügungen berücksichtigt.

Bei **k-random** stellt die Vorlage Stichproben ohne feste paarweise Zuordnung gegenüber. Der Vergleich betrifft dann nicht selbstverständlich „Eintrag eins mit Eintrag eins“. Welche statistische Beziehung stattdessen angemessen ist, muss für die jeweilige Aufgabe festgelegt werden. Die Folie benennt mögliche Ansätze, liefert aber keine vollständige Auswahlregel für jede Datenart. (P, S. 20.)

### A.6 Editierabstand als Beispiel einer strukturierten Beziehung

Seite 21 verwendet die Editier- beziehungsweise Levenshtein-Distanz. Für ein einfaches Lehrverständnis zählen wir, wie viele Einfügungen, Löschungen oder Ersetzungen notwendig sind, um eine Zeichenfolge in eine andere zu überführen, wenn jede Operation die Kosten eins hat.

So unterscheiden sich `Tor` und `Ton` durch eine Ersetzung. `Tor` und `Tore` unterscheiden sich durch eine Einfügung. Der Wert entsteht nicht durch eine physische Entfernung zwischen Buchstaben, sondern durch die gewählten erlaubten Operationen.

Dieses eigene Beispiel erklärt den methodischen Punkt der Vorlage: **Was wir als Nähe ansehen, hängt von der definierten Struktur des Vergleichs ab.** Ein kleiner Editierabstand ist dabei nicht automatisch gleichbedeutend mit ähnlicher fachlicher Bedeutung.

### A.7 Aus Abständen werden Nachbarschaften

Ist ein Vergleich definiert, können wir zu jedem Datenpunkt eine festgelegte Anzahl naher Punkte auswählen und einen Nachbarschaftsgraphen aufbauen. Die Vorlage zeigt diesen Schritt zunächst für Punktdaten und anschließend für Bilder und Profile. (P, S. 22–25.)

In einer eigenen einfachen Konstruktion erhält jeder Punkt Kanten zu seinen $q$ nächsten Nachbarn. Das liefert zunächst einen gerichteten Graphen. Für einen ungerichteten Graphen müsste zusätzlich festgelegt werden, ob eine einseitige Nachbarschaft genügt oder ob beide Punkte einander als Nachbarn wählen müssen.

Die räumliche Zeichnung eines solchen Graphen ist wiederum eine Darstellung. Ein Abstand auf dem Bildschirm ist nicht ohne Weiteres identisch mit dem ursprünglichen Abstand der Daten. Ebenso ist dieser Datengraph nicht dasselbe wie die Verarbeitungstopologie eines neuronalen Modells.

Seite 26 ergänzt einen kd-Baum als Beispiel einer räumlichen Zerlegung. Im Rahmen dieses Skripts genügt seine Funktion als Hinweis, dass Daten auch durch Such- und Verzweigungsstrukturen organisiert werden können. Die konkrete kd-Baum-Konstruktion wird in der PDF nicht ausführlich hergeleitet und hier nicht stillschweigend zu einem vollständigen Algorithmuskurs erweitert.

**Anschluss an den Hauptteil:** Bei der Gestaltung eines Lernverfahrens legen wir nicht nur fest, welches Ergebnis wir wünschen. Wir entscheiden auch, in welcher Darstellung und durch welche Vergleichsbeziehungen dieses Ergebnis überhaupt gesucht werden kann.

---

## Vertiefung B. Von Ähnlichkeit zu einer gelernten Entscheidungsstruktur

*Bezug: P, S. 27–30. Die Grundidee und die Daten stammen aus der Vorlage. Die Rechenwege, Abgrenzungen und ausdrücklich bezeichneten Neuberechnungen werden hier ergänzt.*

### B.1 Das Trainingsbeispiel der PDF

Die Vorlage verwendet zehn Datensätze. Sie sind hier mit unveränderten Einträgen und Labels wiedergegeben:

| Nr. | $X_1$: Vektor | $X_2$: Ganzzahl | $X_3$: Zeichenkette | $X_4$: Zahl | $Y$: Label |
|---:|---|---:|---|---:|---|
| 1 | `[0,1,1,1,1,1,2,3]` | 0 | günstig | −1,0 | Bus |
| 2 | `[1,1,1,1,1,2,3,4]` | 1 | günstig | 0,1 | Bus |
| 3 | `[2,2,2,1,1,2,0,0]` | 1 | günstig | 0,2 | Train |
| 4 | `[3,3,2,2,1,1,0,0]` | 0 | günstig | −1,1 | Bus |
| 5 | `[4,3,2,1,0,0,0,0]` | 1 | günstig | 0,8 | Bus |
| 6 | `[5,3,2,1,0,0,0,0]` | 0 | standard | 0,2 | Train |
| 7 | `[4,6,2,2,1,1,0,0]` | 1 | standard | 0,1 | Train |
| 8 | `[3,7,2,1,0,0,1,2]` | 1 | teuer | 1,7 | Car |
| 9 | `[2,8,2,1,0,1,2,3]` | 2 | teuer | 0,7 | Car |
| 10 | `[1,2,2,1,0,1,0,1]` | 2 | teuer | 1,8 | Car |

Für $X_1$ und $X_4$ nennt die Folie den euklidischen Vergleich, für $X_2$ Manhattan und für $X_3$ die Editierdistanz. Die Bedeutungen der Eingabemerkmale bleiben in der Vorlage weitgehend abstrakt. Sie werden deshalb hier nicht mit erfundenen Messgrößen hinterlegt. (P, S. 27.)

### B.2 Entropie als Bewertung der Labelmischung

Im Datensatz treten viermal `Bus`, dreimal `Train` und dreimal `Car` auf. Für diese empirische Verteilung gilt:

$$
p(\mathrm{Bus})=0{,}4,
\quad p(\mathrm{Train})=0{,}3,
\quad p(\mathrm{Car})=0{,}3.
$$

Wir verwenden die in der Vorlage eingesetzte Entropieformel:

$$
H(Y)=-\sum_c p(c)\log_2p(c),
$$

wobei ein Term mit $p(c)=0$ als null behandelt wird. Einsetzen ergibt:

$$
H(Y)=-0{,}4\log_2(0{,}4)-2\cdot0{,}3\log_2(0{,}3)
\approx1{,}57095\;\text{Bit}.
$$

Die Zahl bewertet hier die Mischung der Labels. Sie bewertet nicht unmittelbar die technische Güte der Kategorien und auch nicht die Wahrheit eines physikalischen Zusammenhangs. Eine Gruppe mit nur einem Label hat in diesem Kriterium Entropie null. (P, S. 27; eigene Erläuterung der verwendeten Formel.)

### B.3 Medoids erzeugen Gruppen, Labels bewerten die Aufteilung

Für die erste Spalte zeigt die PDF ein k-Medoids-Verfahren mit drei Gruppen. Ein Medoid ist in dieser Ausarbeitung ein tatsächlich vorhandener Repräsentant einer Gruppe, der die Summe der gewählten Abstände zu deren Mitgliedern minimiert. Schematisch für eine feste Gruppe $C$:

$$
m_C\in\operatorname*{arg\,min}_{z\in C}
\sum_{x\in C}d(x,z).
$$

Anschließend kann ein neuer Eintrag dem nächstgelegenen ausgewählten Medoid zugeordnet werden. Die Gruppenbildung benutzt die Eingabedarstellung und ihren Vergleich; die nachfolgende Bewertung betrachtet die Labelverteilung in den entstandenen Gruppen. (P, S. 28–29; eigene Formalisierung.)

Die Zahl drei ist eine Vorgabe dieses Beispiels. Dass es drei Labels gibt, bedeutet nicht, dass k-Medoids automatisch drei Gruppen findet, die genau diesen Labels entsprechen. Die in der PDF gezeigten Gruppen sind tatsächlich zum Teil gemischt. Auch die verwendeten Initialisierungen und sämtliche Optimierungsschritte des Clusterverfahrens sind in den Folien nicht dokumentiert. Die vorliegende Rechnung wertet deshalb die **gezeigte Aufteilung** aus, statt deren globale Optimalität zu behaupten.

### B.4 Informationsgewinn als Auswahlkriterium

Für eine Aufteilung des Datensatzes $D$ in Gruppen $C_1,\ldots,C_r$ lautet das Kriterium:

$$
IG=H(Y)-\sum_{j=1}^{r}\frac{|C_j|}{|D|}H(Y\mid C_j).
$$

Der Informationsgewinn vergleicht die anfängliche Labelentropie mit der nach Gruppengröße gewichteten verbleibenden Entropie. Es wäre falsch, die Gruppenentropien unabhängig von ihrer Größe einfach ungewichtet zu mitteln, wenn die Gruppen unterschiedlich viele Datensätze enthalten.

Die für $X_1$ auf Seite 29 gezeigte Aufteilung besitzt die Gruppen:

| Gruppe | Datensatznummern | Zusammensetzung der Labels | Entropie in Bit, neu berechnet |
|---|---|---|---:|
| A | 7, 8, 9 | 1 Train, 2 Car | 0,91830 |
| B | 3, 4, 5, 6, 10 | 2 Bus, 2 Train, 1 Car | 1,52193 |
| C | 1, 2 | 2 Bus | 0 |

Damit ergibt sich:

$$
IG_{X_1}
=1{,}5709506
-\left(\frac3{10}\cdot0{,}9182958
+\frac5{10}\cdot1{,}5219281
+\frac2{10}\cdot0\right)
\approx0{,}53450\;\text{Bit}.
$$

**Rechenpräzisierung zur Vorlage:** Die PDF nennt für Gruppe A $0{,}9149$ und anschließend $0{,}5356$ als Informationsgewinn. Aus den dort angegebenen Anteilen $1/3$ und $2/3$ ergibt sich jedoch $0{,}9182958$. Der hier verwendete Informationsgewinn $0{,}53450$ ist deshalb eine ausdrücklich gekennzeichnete Neuberechnung und keine unveränderte Übernahme der Folienzahl. (P, S. 29.)

### B.5 Warum im gezeigten Beispiel die Textspalte interessant ist

Für die drei auf Seite 30 dargestellten Zweige der Spalte $X_3$ lässt sich die Labelverteilung direkt aus der Tabelle bestimmen. Die Gruppe `günstig` enthält vier `Bus` und ein `Train`. Die Gruppe `standard` enthält zwei `Train`; die Gruppe `teuer` enthält drei `Car`.

Die beiden letzten Gruppen haben Entropie null. Die erste besitzt:

$$
H_{\mathrm{günstig}}
=-0{,}8\log_2(0{,}8)-0{,}2\log_2(0{,}2)
\approx0{,}72193.
$$

Für die gezeigte Aufteilung folgt:

$$
IG_{X_3}
=1{,}5709506-\frac5{10}\cdot0{,}7219281
\approx1{,}20999\;\text{Bit}.
$$

Das stimmt gerundet mit dem Wert $1{,}21$ in der PDF überein. Für einen zukünftigen, bislang nicht beobachteten Zeichenkettenwert wäre zusätzlich die vorgesehene Zuordnung zu den Repräsentanten anzuwenden. Die Rechnung hier betrifft zunächst die zehn vorhandenen Daten. (P, S. 30; eigene Nachrechnung.)

### B.6 Aus der Aufteilung wird eine Struktur

Die Vorlage wählt anschließend das Merkmal mit dem höchsten angegebenen Informationsgewinn und wiederholt das Vorgehen in den Teilmengen. Daraus entsteht eine rekursive Entscheidungsstruktur. (P, S. 30.)

Diese Struktur ist ein weiteres Beispiel für die Entstehung eines Modells aus Daten und einem Auswahlkriterium. Während beim quadratischen Polynom die Struktur feststand und Parameter verändert wurden, kann hier die Verzweigungsstruktur datenabhängig aufgebaut werden.

Für eine vollständige Implementierung müssten außerdem Abbruchbedingungen, der Umgang mit Gleichständen, die Behandlung leerer oder kleiner Gruppen und die Ausgabe an den Blättern festgelegt werden. Diese Einzelheiten sind in der PDF nicht vollständig spezifiziert. Das Skript ergänzt deshalb keine angeblich originalgetreue Implementierung.

Der Bezug zum Hauptthema lautet: **Ein Modell kann auch dadurch entstehen, dass ein Verfahren Beziehungen auswählt und zu einer Entscheidungsstruktur zusammensetzt.** Ein günstiger Informationsgewinn auf den Trainingsdaten ersetzt dabei keine Prüfung der späteren Verwendung.

---

## C. Aufgaben und Lösungshinweise

Die Aufgaben dienen der Wiederholung des Begriffsgangs und der selbstständigen Anwendung. Die Rechenaufgaben verwenden ausschließlich die im Skript eingeführten Annahmen. Die Lösungshinweise können bei einer Ausgabe an Studierende zunächst getrennt werden.

### C.1 Aufgaben

#### Aufgabe 1 – Ein Wort, unterschiedliche Rollen

Betrachten Sie drei Fälle: eine vereinfachte Zeichnung eines Feder-Masse-Systems; ein Programm, das dessen Bewegungsgleichung auswertet; eine aus Versuchsdaten bestimmte Funktion, die einen Sollwert für einen simulierten Aktor liefert.

Erläutern Sie für jeden Fall, worauf sich das Modell bezieht, wie es entstanden sein könnte und welche Rolle es übernimmt. Begründen Sie anschließend, weshalb „gelernt“ und „technisch wirksam“ keine Synonyme sind.

#### Aufgabe 2 – Vom Zusammenhang zur Zahl

Ein ungedämpfter linearer Oszillator besitzt $m=1\,\mathrm{kg}$ und $k=4\,\mathrm{N/m}$. Er startet bei $x(0)=0{,}65\,\mathrm{m}$ mit $\dot{x}(0)=0$.

Bestimmen Sie die Kreisfrequenz, die Schwingungsdauer und die Gesamtenergie. Was ändert sich an der Schwingungsdauer, wenn $k$ auf $9\,\mathrm{N/m}$ erhöht wird und die anderen Vorgaben gleich bleiben? Nennen Sie zwei Annahmen, ohne die diese Rechnung nicht unverändert gilt.

#### Aufgabe 3 – Zwei Beschreibungen, eine Bewegung?

Jemand behauptet: „Wenn zwei Zustände dieselbe Gesamtenergie besitzen, ist auch ihre weitere Bewegung identisch.“ Prüfen Sie diese Aussage am Feder-Masse-System. Erklären Sie, welche Information eine Energieangabe gegenüber einer vollständigen Anfangsbedingung offenlässt.

#### Aufgabe 4 – Ein Lernschritt von Hand

Verwenden Sie die Datenpunkte $(-1,1)$, $(0,0)$ und $(1,1)$ sowie das Modell $\hat y=a_0+a_1x+a_2x^2$. Alle Parameter starten bei null.

Berechnen Sie den mittleren quadratischen Fehler, die drei Komponenten des Gradienten und einen Parameterschritt mit $\eta=0{,}1$. Werten Sie danach das Modell für $x=0$ und $x=1$ aus. Wird dabei erneut gelernt?

#### Aufgabe 5 – Kontext ist nicht gleich Parameteränderung

Ein Sprachmodell erhält zunächst die Eingabe „Die Halterung muss …“. Anschließend wird im Kontext ergänzt: „Die Halterung trägt eine empfindliche optische Komponente.“ Das Modell erzeugt nun eine andere Fortsetzung.

Welche Art von Veränderung ist damit beobachtet? Was müsste zusätzlich bekannt sein, um von einer Parameteränderung zu sprechen? Begründen Sie außerdem, warum eine plausible Fortsetzung noch keine validierte technische Anforderung ist.

#### Aufgabe 6 – Welche Nähe wird überhaupt gemessen?

Eine Tabelle enthält einen Zahlenvektor und eine Zeichenfolge pro Bauteil. Eine Person möchte für beide Spalten ohne weitere Festlegung denselben euklidischen Abstand verwenden.

Welche Voraussetzungen müssten für diesen Vorschlag geklärt werden? Erläutern Sie an einem eigenen Beispiel, weshalb eine kleine Distanz in einer Darstellung nicht automatisch ähnliche technische Bedeutung garantiert. Ergänzen Sie die vier Metrikbedingungen.

#### Aufgabe 7 – Informationsgewinn

Verwenden Sie die Labelverteilung aus Vertiefung B: vier `Bus`, drei `Train`, drei `Car`. Eine Aufteilung erzeugt eine Gruppe mit vier `Bus` und einem `Train`, eine Gruppe mit zwei `Train` und eine Gruppe mit drei `Car`.

Berechnen Sie den Informationsgewinn. Erklären Sie, weshalb die Gruppengrößen in die Rechnung eingehen und warum das Ergebnis noch keine Güteaussage für bislang unbekannte Daten ist.

#### Aufgabe 8 – Die Entwicklungsaufgabe gestalten

Für die fiktive Halterung aus Kapitel 8 soll ein gelerntes Modell eine erste Bewertung von Varianten unterstützen. Formulieren Sie einen kurzen Entwicklungsauftrag mit fünf Absätzen: Aufgabe, Daten, Lernen, Prüfen und Einsetzen.

Machen Sie ausdrücklich kenntlich, welche Grenzen, Toleranzen oder Annahmen Sie selbst festlegen. Erklären Sie, wo ein LLM eine ergänzende Rolle spielen könnte und welche Rolle es damit nicht automatisch übernimmt.

### C.2 Lösungshinweise

#### Zu Aufgabe 1

Die Zeichnung repräsentiert ausgewählte Bauteile und Beziehungen. Über ihre Entstehung wissen wir zunächst nur, dass jemand eine Auswahl getroffen hat. Ihre unmittelbare Rolle ist die Veranschaulichung.

Das Programm wertet eine explizite mechanische Beschreibung aus. Ausführbarkeit folgt aus seiner Implementierung, nicht aus einem Lernverfahren. Es kann ein reines Prognosewerkzeug bleiben, solange seine Ausgabe nicht in eine weitere technische Wirkungskette eingebunden wird.

Die dritte Funktion wurde anhand von Daten bestimmt. Sie kann zugleich Teil einer simulierten Stellfunktion sein. Lernen betrifft die Bestimmung der Funktion; technische Wirksamkeit betrifft ihre Einbindung. Beide Eigenschaften können gemeinsam auftreten, müssen es aber nicht.

#### Zu Aufgabe 2

Es gilt $\omega=\sqrt{k/m}=2\,\mathrm{rad/s}$ und $T=2\pi/\omega=\pi\,\mathrm{s}\approx3{,}142\,\mathrm{s}$. Die Gesamtenergie beträgt bei der vorgegebenen Anfangsbedingung $E=\tfrac12kA^2=0{,}845\,\mathrm J$.

Bei $k=9\,\mathrm{N/m}$ ist $\omega=3\,\mathrm{rad/s}$ und $T\approx2{,}094\,\mathrm{s}$. Bei gleichbleibender Anfangsauslenkung würde auch die anfängliche Gesamtenergie auf $1{,}90125\,\mathrm J$ steigen. Das ist ein Vergleich zweier Vorgaben, keine Simulation eines plötzlichen Federwechsels im laufenden Versuch.

Zu den Annahmen gehören die Linearität der Feder, konstante Masse, fehlende Dämpfung und die fehlende äußere zeitabhängige Anregung. Außerdem wird $x$ relativ zur Gleichgewichtslage gemessen.

#### Zu Aufgabe 3

Die Aussage ist falsch. Die Zustände $(x,\dot{x})=(0,+v)$ und $(0,-v)$ besitzen dieselbe Energie, bewegen sich aber zunächst in entgegengesetzte Richtungen. Auch verschiedene Punkte einer Schwingungsbahn können dieselbe Gesamtenergie haben.

Die Energie bestimmt im betrachteten Modell eine Beziehung zwischen Auslenkung und Geschwindigkeitsbetrag. Eine einzelne Energiezahl legt weder die aktuelle Phase noch das Vorzeichen der Geschwindigkeit vollständig fest. Für die eindeutige Bewegung benötigen wir eine hinreichende Zustands- beziehungsweise Anfangsangabe und die Entwicklungsgleichung.

#### Zu Aufgabe 4

Zu Beginn sind die Vorhersagen null und die Fehler $(-1,0,-1)$. Der Fehler ist $J_0=2/3$, der Gradient $(-4/3,0,-4/3)$.

Nach einem Schritt ergeben sich $a_0=a_2=2/15$ und $a_1=0$. Deshalb gilt $\hat y(0)=2/15$ und $\hat y(1)=4/15$. Der neue Fehler beträgt:

$$
J_1=\frac13\left[2\left(\frac4{15}-1\right)^2+\left(\frac2{15}\right)^2\right]
=\frac{82}{225}\approx0{,}36444.
$$

Er ist kleiner als der Anfangsfehler. Bei der anschließenden Auswertung werden die Parameter nicht verändert. Es wird also nicht erneut gelernt.

#### Zu Aufgabe 5

Beobachtet wird zunächst eine Veränderung der Ausgabe bei verändertem Kontext. Daraus allein folgt keine Gewichtsänderung. Dafür müsste beispielsweise ein Trainings- oder Anpassungsvorgang dokumentiert sein, der die Parameter tatsächlich verändert hat.

Der ergänzte Kontext kann für die Fortsetzung relevant sein. Er legt aber noch keine prüfbaren Grenzwerte oder vollständigen Lastfälle fest. Eine Anforderung benötigt eine fachliche Begründung und eine überprüfbare Bedeutung; die sprachliche Fortsetzung ist zunächst ein Vorschlag. Diese Antwort wendet die Unterscheidung aus Kapitel 7 an, nicht eine behauptete Eigenschaft des konkret nicht benannten Systems.

#### Zu Aufgabe 6

Für den Zahlenvektor müssen Dimension, Zuordnung, Einheiten und Skalierung geklärt sein. Eine Zeichenfolge ist nicht ohne weitere Repräsentation ein Vektor in einem festgelegten euklidischen Raum. Es könnte etwa eine explizite numerische Darstellung oder ein Editierabstand gewählt werden; beides beantwortet unterschiedliche Fragen.

`mit` und `ohne` können in einer Anforderung eine entscheidende technische Unterscheidung darstellen, die ein bloßer Zeichenvergleich nicht nach ihrem technischen Gewicht bewertet. Die Metrikbedingungen sind Nichtnegativität, Abstand null genau bei identischen Elementen, Symmetrie und Dreiecksungleichung.

#### Zu Aufgabe 7

Die Anfangsentropie ist etwa $1{,}57095$ Bit. Die erste Gruppe besitzt Entropie $0{,}72193$ Bit; die beiden anderen Gruppen besitzen Entropie null. Der Informationsgewinn beträgt:

$$
IG=1{,}57095-\frac5{10}\cdot0{,}72193
\approx1{,}20999\;\text{Bit}.
$$

Die Gewichtung berücksichtigt, welcher Anteil der Datensätze in der jeweiligen Gruppe verbleibt. Bewertet wird eine Aufteilung der vorhandenen Trainingsdaten. Ob zukünftige Fälle ähnlich verteilt sind und angemessen zugeordnet werden, ist damit noch nicht geprüft.

#### Zu Aufgabe 8

Eine mögliche Lösung begrenzt die Aufgabe auf das frühe Aussortieren von Varianten innerhalb einer festgelegten Geometriefamilie und definierter Lastfälle. Sie behauptet ausdrücklich keinen abschließenden Bauteilnachweis.

Für die Daten werden Eingaben und Referenzwerte mit Herkunft, Einheiten und Bedingungen beschrieben. Für das Lernen werden Modellstruktur und Fehlerkriterium festgelegt. Für das Prüfen werden getrennte Fälle und ein fachlich begründetes Akzeptanzkriterium vorgesehen. Für den Einsatz werden Eingabegrenzen, Ausgabeinterpretation und ein Rückgriff auf eine andere Prüfung definiert.

Ein LLM könnte in dieser Lösung etwa fehlende Angaben im textlichen Auftrag kenntlich machen. Es übernimmt dadurch nicht automatisch die mechanische Prognose oder die Freigabe. Bewertet wird vor allem die Konsistenz zwischen Zweck, Daten, Kriterium und Verwendung. Erfundenen Zahlenwerten darf keine durch die Aufgabenstellung nicht gedeckte Verbindlichkeit zugeschrieben werden.

---

## D. Ablauf und Demonstrationen für den Vortrag

Dieser Abschnitt richtet sich an die vortragende Person. Der Haupttext davor bleibt unabhängig von der Animation lesbar.

### D.1 Vorschlag für 90 Minuten

| Zeit | HTML-Folie | Schwerpunkt | Aktivität |
|---|---:|---|---|
| 0–5 Minuten | 1 | Ein Begriff im Wandel | Beispiele für „Modell“ aus dem Publikum sammeln |
| 5–15 Minuten | 2 | Gedankenminiatur und Abstraktion | Details des Feder-Masse-Systems entfernen |
| 15–27 Minuten | 3 | Quantitative Beziehungen | Bewegungsgleichung und Änderung von $k$ |
| 27–42 Minuten | 4 | Beschreibungen und Geltungsbereich | Kraft und Energie vergleichen; historischer Einschub |
| 42–52 Minuten | 5 | Technische Ausführung | Eingang ändern, Ausführung anhalten, erneut ändern |
| 52–68 Minuten | 6 | Modelllernen | Lernlauf und anschließende Auswertung unterscheiden |
| 68–82 Minuten | 7 | Sprachmodell | Kontext, Fortsetzung und Modellparameter auseinanderhalten |
| 82–90 Minuten | 8 | Erweiterte Entwicklungsaufgabe | Fiktiven Entwicklungsfall diskutieren und abschließen |

Die ausführliche Lagrange-Rechnung sowie die Vertiefungen A und B sind nicht zusätzlich in diese 90 Minuten eingerechnet. Für einen zweiten Termin können etwa 15 Minuten für Daten und Abstände, 20 Minuten für die Entscheidungsstruktur und 10 Minuten für gemeinsame Aufgaben verwendet werden.

### D.2 Hinweise zu den acht Folien

#### Folie 1 – Ein Begriff. Im Wandel.

Zunächst ohne Definition fragen: „Woran denken Sie beim Wort Modell?“ Zwei oder drei Antworten genügen. Anschließend die unterschiedlichen Formen der Punktdarstellung mit dem Begriffsregler zeigen. Die fünf Formen sind visuelle Metaphern; sie sind weder historische Fundstücke noch Belege für eine zwingende Entwicklung.

**Übergang:** „Wir beginnen bei dem Modell, das uns etwas vorstellbar macht.“

#### Folie 2 – Die Welt im Kleinen.

Den Abstraktionsregler langsam verschieben. Nicht die entfernten Details aufzählen, sondern nach ihrer Bedeutung für eine konkrete Frage fragen. Eine hilfreiche Gegenüberstellung lautet: Schwingungsdauer untersuchen oder Befestigung montieren.

**Übergang:** „Die Darstellung muss nicht alles behalten. Sie muss die für unsere Frage wichtigen Beziehungen behalten.“

#### Folie 3 – Nicht das Ding. Die Beziehung.

Die Gleichung links zunächst aus den Modellannahmen entwickeln. Vor der Änderung von $k$ eine Vorhersage abfragen: schneller oder langsamer? Danach den Regler bewegen. Die Demonstration startet bei einer geänderten Modellvorgabe die Beispielbewegung neu; sie zeigt keinen realen Eingriff in eine laufende Feder.

**Übergang:** „Wir können rechnen. Aber welche Aussage trifft die Rechnung – und wo nicht mehr?“

#### Folie 4 – Ein Geschehen. Viele Modelle.

Zwischen Kraftbilanz und Energie wechseln. Die zentrale Beobachtung ist die gleichbleibende modellierte Bewegung bei verändertem Beschreibungsblick. Die Energiegleichung kann an der Tafel oder anhand des Skripts erklärt werden; in der reduzierten HTML-Fassung sind zusätzliche Formeleinblendungen in der Szene ausgeblendet.

Den Hertz-Bezug in seiner begrenzten Funktion verwenden: unterschiedliche Bilder, keine beliebige Wirklichkeit. Historische Präzisierungen nicht als Nebenvorlesung ausdehnen.

**Übergang:** „Bis hierhin haben wir mit Modellen über Wirklichkeit nachgedacht. Nun setzen wir eine Funktion in eine technische Umgebung ein.“

#### Folie 5 – Vom Abbild zur Wirkung.

Bei aktiver Ausführung den Eingang auf ungefähr $0{,}5$ setzen. Der ausgegebene Winkel soll ungefähr $30^\circ$ betragen. Dann die Ausführung anhalten und den Eingang erneut verändern. Die gehaltene Ausgabe macht sichtbar, dass Eingang, Berechnung und Wirkung nicht identisch sind.

Die Demonstration ausdrücklich als Simulation bezeichnen. Sie zeigt keine reale Maschine und keinen sicheren Abschaltzustand.

**Übergang:** „Eine Funktion lässt sich ausführen, ohne gelernt zu sein. Wie entsteht nun eine gelernte Funktion?“

#### Folie 6 – Die Funktion entsteht.

Bei Bedarf zurücksetzen, dann „Lernen starten“ wählen. Während des Lernens auf die Veränderung der Kurve und des Fehlers hinweisen. Nach dem Lernlauf den Eingaberegler bewegen. Die Parameter bleiben dabei bestehen; geändert wird nur die Stelle, an der die Funktion ausgewertet wird.

Nicht behaupten, dass die Demo die Eignung für unbekannte Realbedingungen nachweist. Sie passt ein Polynom an synthetische Daten an.

**Übergang:** „Dieses Prinzip erklärt noch kein LLM. Es liefert aber die Begriffe, um seine Entstehung und seine Ausführung zu unterscheiden.“

#### Folie 7 – Das Modell spricht.

Vor Beginn sagen, dass kein LLM im Browser ausgeführt wird. Zwischen „Halterung“ und „Akku“ wechseln und einen Token-Platzhalter ergänzen. Die Wörter und Prozentwerte sind didaktisch gesetzt. Gerade diese Abgrenzung sollte mündlich erfolgen, weil in der bereinigten Folienansicht erklärende Kleintexte reduziert wurden.

Die Frage an das Publikum lautet: „Was wurde gerade verändert: der Kontext, die dargestellte Auswahl oder Modellparameter?“ In der tatsächlichen HTML-Szene werden nur vorgegebene Beispiele umgeschaltet.

**Übergang:** „Wenn wir solche Funktionen entwickeln oder verwenden, welche Entscheidungen bleiben unsere Aufgabe?“

#### Folie 8 – Wir gestalten das Lernen.

Die fünf Stationen Aufgabe, Daten, Lernen, Prüfen und Einsetzen auf den fiktiven Halterungsfall beziehen. Nicht fünf neue Technologiethemen eröffnen. Jede Station soll eine andere notwendige Entscheidung sichtbar machen.

**Abschlussfrage:** „Was müssen wir gestalten, damit aus Daten eine für unsere Entwicklungsaufgabe geeignete und angemessen eingesetzte Funktion entsteht?“

### D.3 Bedienung und Vorbereitung

Die HTML-Datei enthält die Bibliothek und die Demonstrationen lokal. Die Bedienung ist im Programm vorgesehen über Pfeiltasten für die Navigation, `F` für Vollbild, `N` für Notizen, `O` für die Übersicht und `Q` für Quellen. Die Leertaste schaltet die Animation um; `R` setzt den 3D-Blick zurück. (H, Bedienlogik.)

Vor dem Vortrag die Datei auf dem tatsächlichen Präsentationsrechner öffnen, alle Szenen einmal aufrufen und die Größenverhältnisse am Projektor prüfen. Das ist insbesondere für WebGL, Vollbild und die Bildschirmauflösung sinnvoll. Die Notizen erscheinen im selben Fenster; sie sind keine getrennte private Referentenansicht.

---

## E. Begriffe und Symbole

Die folgenden Definitionen sind Arbeitsbegriffe dieses Skripts. Sie sollen die Unterschiede der Vorlesung stabil halten, nicht sämtliche fachphilosophischen Bedeutungen abschließend vereinheitlichen.

### E.1 Begriffe

**Modell.** Eine für einen Zweck gewählte Darstellung oder Struktur, mit der ausgewählte Beziehungen bearbeitet werden. Im technischen Teil kann sie als ausführbare Funktion vorliegen.

**Abbild.** Eine Darstellung, die für etwas anderes steht. Ähnlichkeit kann anschaulich sein, muss sich aber nicht auf die äußere Form beschränken.

**Abstraktion.** Das bewusste Nichtberücksichtigen bestimmter Aspekte eines Gegenstands oder Zusammenhangs.

**Idealisierung.** Die Annahme einer vereinfachten Grenzform, etwa einer linearen Feder ohne Dämpfung.

**Naturgesetz.** Im hier verwendeten naturwissenschaftlichen Zusammenhang eine gesetzesartige Aussage über Beziehungen. Ein konkretes technisches Modell kann solche Aussagen mit zusätzlichen Annahmen, Parametern und Randbedingungen verbinden.

**Geltungsbereich.** Die Bedingungen und Fragestellungen, für die die Aussagen eines Modells beansprucht und geprüft werden.

**Modellstruktur beziehungsweise Topologie.** Die Festlegung von Elementen und ihren Verknüpfungen. Der Ausdruck bezeichnet hier eine Verarbeitungsstruktur, nicht automatisch räumliche Geometrie.

**Parameter beziehungsweise Gewichte.** Größen, die innerhalb einer festgelegten Struktur eine konkrete Funktion bestimmen. Ihre Herkunft kann Vorgabe, Messung oder Lernen sein.

**Algorithmus.** Ein festgelegtes Verfahren zur Durchführung von Rechenschritten. Ein Lernalgorithmus und die spätere Modellauswertung erfüllen unterschiedliche Aufgaben.

**Interface beziehungsweise Schnittstelle.** Die Festlegung, wie ein Modell Eingaben erhält und Ausgaben an seine Umgebung übergibt und wie diese interpretiert werden.

**Laufzeitumgebung.** Die technische Umgebung, in der eine implementierte Funktion ausgeführt wird.

**Lernumgebung.** Die Umgebung, in der Daten, Modellvorgaben und Lernverfahren zur Bestimmung eines Modells zusammengeführt werden.

**Training.** Im Polynom- und Parametersinn dieses Skripts die wiederholte Anpassung von Parametern anhand von Daten und eines Lernkriteriums.

**Inferenz.** Die Verwendung einer bereits bestimmten Funktion für eine Eingabe. Inferenz muss nicht automatisch eine Gewichtsänderung einschließen.

**Generalisierung.** Die Eignung eines aus Daten bestimmten Modells für weitere Fälle jenseits der unmittelbar zur Anpassung verwendeten Beispiele.

**Token.** Eine Verarbeitungseinheit sprachlicher Darstellung, die nicht mit einem vollständigen Wort identisch sein muss. [Sennrich.]

**LLM.** Ein großes Sprachmodell. Im Haupttext wird exemplarisch die autoregressive Verarbeitung von Kontext zu einer Verteilung nächster Tokens betrachtet. [Bengio; Brown.]

**Attention.** Ein Mechanismus zur gewichteten Verknüpfung von Repräsentationen; keine Gleichsetzung mit menschlichem Bewusstsein. [Vaswani.]

**Metrik.** Eine Distanzfunktion mit den vier in A.4 angegebenen Eigenschaften.

**Medoid.** Ein tatsächlich vorhandener Repräsentant einer Gruppe, der in der hier verwendeten Definition die Summe der Abstände zu ihren Mitgliedern minimiert.

**Informationsgewinn.** Die Verringerung der Labelentropie durch eine betrachtete Aufteilung, gewichtet nach den Größen der entstandenen Gruppen.

### E.2 Symbolübersicht

| Symbol | Bedeutung im Skript |
|---|---|
| $x(t)$ | Auslenkung zur Zeit $t$ im mechanischen Beispiel |
| $\dot{x},\ddot{x}$ | Geschwindigkeit und Beschleunigung |
| $m,k,c$ | Masse, Federsteifigkeit und gegebenenfalls Dämpfungsparameter |
| $A,\omega,T$ | Anfangsamplitude, Kreisfrequenz und Schwingungsdauer |
| $E,\mathcal L$ | Gesamtenergie und Lagrange-Funktion |
| $x,y$ | Allgemeine Eingabe und Ausgabe; Bedeutung abhängig vom Beispiel |
| $\hat y$ | Modellvorhersage |
| $\theta,\hat\theta$ | Parametervektor und berechnete Parametrisierung |
| $D,N$ | Datenmenge und Anzahl ihrer Beispiele |
| $J,\eta$ | Lernkriterium und Schrittweite |
| $t_i,p_\theta$ | Token und parametrisierte Wahrscheinlichkeitsfunktion |
| $d(u,v)$ | Gewählter Abstand zwischen zwei Datenelementen |
| $H(Y),IG$ | Labelentropie und Informationsgewinn |

Der Buchstabe $x$ hat im mechanischen und im allgemeinen Funktionsschema nicht automatisch dieselbe physikalische Bedeutung. Ebenso bezeichnet **H** als Quellenkürzel die HTML-Datei, während $H(Y)$ eine mathematische Entropie bezeichnet.

---

## F. Quellen, zeitliche Orientierung und Abgrenzungen

### F.1 Zuordnung zur bereitgestellten PDF

| PDF-Seiten | Inhalt der Vorlage | Stelle im Skript |
|---|---|---|
| 2 | Materielle Elemente, Ideen, Abbilder und Beziehungen | Kapitel 2 |
| 3 | Newton und mathematische Beziehungen | Kapitel 3 |
| 4–5 | Mathematische Räume, Gauß, Hilbert und Einstein | Kapitel 4.4 |
| 6 | Hertz und Modellgrenzen | Kapitel 4.1–4.3 |
| 7–8 | Technische Wirksamkeit und Wandel von Begriffen | Kapitel 1, 5 und 8 |
| 9–11 | Funktion, Struktur, Interface, Lern- und Laufzeitumgebung | Kapitel 5–6 |
| 12–15 | Polynomfitting, Programmierung und Topologien | Kapitel 6; Begriffsübersicht |
| 16–26 | Tabellen, Datenstrukturen, Vergleiche und Nachbarschaften | Vertiefung A |
| 27–30 | Trainingsbeispiel, Medoids, Entropie und Rekursion | Vertiefung B |
| 31 | Weiterführende Leselinks | In P enthalten; hier nicht als zusätzlich ausgewertete Quellen ausgegeben |

Seite 13 der Vorlage nennt Programmierparadigmen, verweist aber selbst darauf, dass die frühere Vertiefung nicht mehr Bestandteil der Vorlesung ist. Entsprechend enthält dieses Skript keinen nachträglich ergänzten Programmierkurs. Die LLM-Stufe und der ausdrücklich formulierte Entwicklungsfall stammen aus der Fortführung des Gesprächs und der HTML-Ausarbeitung, nicht aus den ursprünglichen 31 PDF-Seiten.

### F.2 Zeitliche Orientierung: Bezugspunkte, keine Ablösungskette

| Zeitpunkt | Bezugspunkt | Bedeutung für diese Vorlesung |
|---|---|---|
| Antike | Die in der Vorlage aufgerufenen Perspektiven von Demokrit und Platon | Einstieg in Gegenstände, Beziehungen sowie Vorbild und Abbild; keine historische LLM-Vorläufertheorie |
| 1687 | Newtons *Principia* | Mathematische Beziehungen als Grundlage quantitativer Beschreibung |
| 1894 | Hertz’ *Prinzipien der Mechanik* | Reflexion unterschiedlicher Bilder und ihrer Beurteilung |
| 1899 | Hilberts *Grundlagen der Geometrie* | Axiome, Beziehungen und logische Struktur einer mathematischen Beschreibung |
| 1916 | Einsteins Darstellung der allgemeinen Relativitätstheorie | Physikalische Relevanz einer nicht auf Alltagsanschauung beschränkten Beschreibung |
| Digitale technische Realisierung, ohne einzelnen Ursprungszeitpunkt | Algorithmische Implementierung und Laufzeitumgebungen | Funktionsausführung als Teil eines technischen Systems; konzeptioneller Bezug aus P, S. 7 und 10–11 |
| 2003 | Bengio und Kollegen | Gemeinsames Lernen sprachlicher Repräsentationen und Wahrscheinlichkeiten |
| 2017 | Vaswani und Kollegen | Transformer als architektonischer Bezugspunkt der LLM-Erklärung |
| 2020 | Brown und Kollegen | Beispiel für aufgabenbezogene Verwendung großer Sprachmodelle über Kontext |
| 2022 | Ouyang und Kollegen | Beispiel einer zusätzlichen Anpassung an gewünschtes Antwortverhalten |

Die Tabelle beansprucht keine historischen Erstleistungen außer den konkret bezeichneten Publikationsdaten. Sie behauptet insbesondere nicht, dass Modelllernen erst 2003 begann oder technische Modelle zuvor nicht ausgeführt beziehungsweise materiell realisiert werden konnten. Die einzelnen Arbeiten dienen als nachvollziehbare Bezugspunkte der ausgewählten Argumentation.

### F.3 Was gegenüber der Vorlage ausdrücklich präzisiert wurde

**Historische Zuschreibungen.** Die Gegenüberstellung von Demokrit und Platon wird als didaktisches Ausgangsbild behandelt. Sie wird nicht als vollständige Rekonstruktion ihrer Philosophien ausgegeben. Die Namensangabe auf der Hertz-Folie wird zu Heinrich Hertz präzisiert. Die Formulierung vom Ende der Naturgesetze wird als Zuspitzung, nicht als historische Tatsache verwendet.

**Räume und Relativität.** Nichteuklidische Struktur wird von Dimensionszahl unterschieden. Hohe Geschwindigkeit wird nicht ohne Weiteres mit gravitativer Raumzeitkrümmung gleichgesetzt. Die historischen Beispiele bleiben erhalten, ihre verkürzten Gleichsetzungen werden jedoch nicht übernommen.

**Mathematische Vergleichsbegriffe.** Die vollständige Metrikdefinition wird angegeben. Nicht jedes Ähnlichkeits- oder Unähnlichkeitsmaß wird als Metrik bezeichnet.

**Rechenwerte.** Der Entropiewert einer Dreiergruppe und der daraus folgende Informationsgewinn in P, S. 29 werden unter Beibehaltung der gezeigten Gruppen neu berechnet. Die Abweichung zur Folienzahl ist in B.4 dokumentiert.

**Modelllernen und Realität.** Ein gelerntes Modell bleibt mathematisch definiert. Die technische Wirksamkeit liegt in seiner Implementierung und Einbindung, nicht darin, dass ein abstraktes Objekt ohne Vermittlung physisch handelt. Das folgt der zentralen Richtung von P, S. 7, formuliert sie aber genauer aus.

### F.4 Quellenverzeichnis

**[P] Bereitgestellte Vorlesungsfolien.** *Digitale Transformation – Introduction(1).pdf*. 31 Dateiseiten. Vom Nutzer bereitgestellte inhaltliche Grundlage. Die Seitenangaben dieses Skripts beziehen sich auf diese Datei; eine zusätzliche Autorenzuordnung oder Datierung wird nicht erfunden.

**[H] Begleitende HTML-Präsentation.** *Modellbegriff_ThreeJS_clean.html*. Acht Folien. Im Gespräch erstellte und bereitgestellte Präsentation einschließlich eingebetteter Erläuterungen und Programmlogik. Quelle der Demonstrationen und ihrer tatsächlichen Zahlenwerte. Die HTML-Datei ist keine unabhängige historische oder naturwissenschaftliche Fachquelle.

**[Aristoteles] Aristoteles.** *Metaphysik*, Buch I, Kapitel 4, insbesondere die Darstellung von Leukipp und Demokrit. Englische Textausgabe im Internet Classics Archive des MIT. Verwendet zur gekennzeichneten Präzisierung des antiken Einstiegs. Text: `https://classics.mit.edu/Aristotle/metaphysics.1.i.html`.

**[Platon] Platon.** *Timaios*, insbesondere 27d–29b. Englische Textausgabe im Internet Classics Archive des MIT. Verwendet für die Unterscheidung zwischen Sein und Werden sowie Vorbild und Abbild. Text: `https://classics.mit.edu/Plato/timaeus.html`.

**[Newton] Newton, Isaac (1687).** *Philosophiae Naturalis Principia Mathematica*, Abschnitt *Axiomata Sive Leges Motus*. Wissenschaftliche Textedition des Newton Project, University of Oxford. Die im Skript verwendete Symbolik ist eine moderne Darstellung. Text: `https://www.newtonproject.ox.ac.uk/view/texts/normalized/NATP00076`.

**[Hertz] Hertz, Heinrich (1894).** *Die Prinzipien der Mechanik in neuem Zusammenhange dargestellt*. Leipzig: Johann Ambrosius Barth. Herangezogen über die englische Ausgabe *The Principles of Mechanics Presented in a New Form* (1899), Übersetzung D. E. Jones und J. T. Walley, insbesondere Einleitung, S. 1–3. Digitalisat: `https://archive.org/details/principlesofmech00hertuoft`.

**[Hilbert] Hilbert, David (1899).** *Grundlagen der Geometrie*. Herangezogen über *The Foundations of Geometry*, autorisierte englische Übersetzung von E. J. Townsend (1902), als digitalisierter Nachdruck von 1950. Relevant: Einleitung, § 1 und § 10. Digitaler Text: `https://www.gutenberg.org/ebooks/17384`.

**[Einstein] Einstein, Albert (1916).** „Die Grundlage der allgemeinen Relativitätstheorie“. *Annalen der Physik* 354(7), 769–822. DOI: `10.1002/andp.19163540702`. Für die inhaltliche Einordnung wurde auch die digital zugängliche englische Übersetzung *The Foundation of the Generalised Theory of Relativity* von Satyendra Nath Bose herangezogen; die Textedition erläutert eigene redaktionelle Anpassungen. Text: `https://en.wikisource.org/wiki/The_Foundation_of_the_Generalised_Theory_of_Relativity`.

**[Bengio] Bengio, Yoshua; Ducharme, Réjean; Vincent, Pascal; Jauvin, Christian (2003).** „A Neural Probabilistic Language Model“. *Journal of Machine Learning Research* 3, 1137–1155. Grundlage für gelernte Repräsentationen und Wahrscheinlichkeitsfunktionen für sprachliche Folgen. Quelle: `https://www.jmlr.org/papers/v3/bengio03a.html`.

**[Sennrich] Sennrich, Rico; Haddow, Barry; Birch, Alexandra (2016).** „Neural Machine Translation of Rare Words with Subword Units“. ACL 2016; Vorabfassung von 2015. Grundlage für die Abgrenzung von Wort und Teilworteinheit. Quelle: `https://arxiv.org/abs/1508.07909`.

**[Vaswani] Vaswani, Ashish et al. (2017).** „Attention Is All You Need“. *Advances in Neural Information Processing Systems*. Grundlage für die schematische Transformer- und Attention-Erklärung, insbesondere Abschnitte 3.1–3.5. Quelle: `https://arxiv.org/abs/1706.03762`.

**[Brown] Brown, Tom B. et al. (2020).** „Language Models are Few-Shot Learners“. *Advances in Neural Information Processing Systems*. Grundlage für die Unterscheidung zwischen Aufgabenbearbeitung über Kontext und Parameteraktualisierung. Quelle: `https://arxiv.org/abs/2005.14165`.

**[Ouyang] Ouyang, Long et al. (2022).** „Training language models to follow instructions with human feedback“. *Advances in Neural Information Processing Systems*. Beispiel einer zusätzlichen Anpassung an gewünschtes Verhalten; keine Behauptung über die genaue Trainingsweise jedes Sprachmodells. Quelle: `https://arxiv.org/abs/2203.02155`.

### F.5 Reichweite der Unterlage

Diese Unterlage behandelt den Modellbegriff als Zugang zur digitalen Transformation in der Produktentwicklung. Sie ersetzt weder eine vollständige Wissenschaftsgeschichte noch Lehrbücher zu Mechanik, Optimierung, maschinellem Lernen oder Sprachverarbeitung.

Die Grenzen sind Teil des Inhalts: Aus anschaulicher Darstellung folgt keine Vollständigkeit, aus mathematischer Form keine empirische Bewährung, aus geringem Trainingsfehler keine allgemeine Gültigkeit und aus sprachlicher Plausibilität keine technische Freigabe. Gerade deshalb gehören Darstellung, Entstehung, Prüfung und Verwendung eines Modells zusammen.
