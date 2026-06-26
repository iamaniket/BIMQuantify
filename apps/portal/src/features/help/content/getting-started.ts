import { Sparkles } from '@bimdossier/ui/icons';

import type { HelpArticle } from './types';

export const gettingStarted: HelpArticle = {
  slug: 'getting-started',
  category: 'gettingStarted',
  icon: Sparkles,
  order: 1,
  lastUpdated: '2026-06-26',
  title: {
    en: 'Getting started',
    nl: 'Aan de slag',
  },
  summary: {
    en: 'A quick tour of BimDossier — from your first project to your first finding.',
    nl: 'Een korte rondleiding door BimDossier — van je eerste project tot je eerste bevinding.',
  },
  body: {
    en: `## Welcome to BimDossier

BimDossier helps building teams manage their digital dossier: 3D models, 2D drawings,
inspections, and compliance — all in one place. This guide walks you through the core
flow so you can get productive quickly.

## 1. Create a project

Everything starts with a **project**. From **Projects**, choose **New project** and fill in
the wizard:

- **Name & description** — how your team will recognise the project.
- **Country** — anchors the project to a jurisdiction (the Netherlands by default), which
  decides the available compliance frameworks.
- **Phase** — the current stage, from *design* through *handover*.

## 2. Add a container

A **container** is the viewable artifact of a project. It holds both your **3D models**
(IFC) and your **2D drawings** (PDF). Open a project, go to **Documents**, and upload a
file:

1. Pick an \`.ifc\` model or a \`.pdf\` drawing.
2. The file uploads directly to secure storage.
3. We extract its geometry and metadata in the background — the status moves from
   *pending* to *ready* when it is viewable.

> **Tip:** large IFC models can take a few minutes to process. You can keep working; the
> container updates itself when extraction finishes.

## 3. Open the viewer

Once a container is *ready*, open it in the **viewer**. You can explore the model in 3D,
switch to a 2D floor plan, or view both side by side. See [Using the viewer](/help/using-the-viewer)
for navigation, measuring, and section cuts.

## 4. Record findings

Spot something on site or in the model? Drop a **finding** (a snag) directly onto the
exact spot. Assign it, attach photos, and track it from *open* to *resolved* to *verified*.

## 5. Check compliance & generate reports

Run a **compliance check** against the project's framework (such as Bbl or Wkb) and
generate a PDF **report** to share with stakeholders.

## Where to next?

| You want to… | Go to |
| --- | --- |
| Learn the 3D / 2D controls | [Using the viewer](/help/using-the-viewer) |
| Reach a human | Use the **Support** tile at the top of this page |

That's the whole loop — **project → container → viewer → findings → reports**. Welcome aboard.`,
    nl: `## Welkom bij BimDossier

BimDossier helpt bouwteams hun digitale dossier te beheren: 3D-modellen, 2D-tekeningen,
inspecties en regelgeving — allemaal op één plek. Deze handleiding loodst je door de
kernstappen, zodat je snel aan de slag kunt.

## 1. Maak een project aan

Alles begint met een **project**. Kies bij **Projecten** voor **Nieuw project** en vul de
wizard in:

- **Naam & omschrijving** — waaraan je team het project herkent.
- **Land** — koppelt het project aan een rechtsgebied (standaard Nederland), wat bepaalt
  welke regelgevingskaders beschikbaar zijn.
- **Fase** — de huidige fase, van *ontwerp* tot *oplevering*.

## 2. Voeg een informatiecontainer toe

Een **informatiecontainer** is het bekijkbare onderdeel van een project. Hij bevat zowel je
**3D-modellen** (IFC) als je **2D-tekeningen** (PDF). Open een project, ga naar
**Documenten** en upload een bestand:

1. Kies een \`.ifc\`-model of een \`.pdf\`-tekening.
2. Het bestand wordt direct naar beveiligde opslag geüpload.
3. We verwerken de geometrie en metadata op de achtergrond — de status gaat van
   *in behandeling* naar *gereed* zodra het bekijkbaar is.

> **Tip:** grote IFC-modellen kunnen enkele minuten verwerking vergen. Je kunt gewoon
> doorwerken; de container werkt zichzelf bij wanneer het verwerken klaar is.

## 3. Open de viewer

Zodra een container *gereed* is, open je hem in de **viewer**. Je kunt het model in 3D
verkennen, overschakelen naar een 2D-plattegrond, of beide naast elkaar bekijken. Zie
[De viewer gebruiken](/help/using-the-viewer) voor navigeren, meten en doorsneden.

## 4. Leg bevindingen vast

Zie je iets op de bouwplaats of in het model? Plaats een **bevinding** (een snag) direct op
de exacte plek. Wijs hem toe, voeg foto's toe en volg hem van *open* naar *opgelost* naar
*geverifieerd*.

## 5. Toets regelgeving & genereer rapporten

Voer een **conformiteitstoets** uit tegen het kader van het project (zoals Bbl of Wkb) en
genereer een PDF-**rapport** om met betrokkenen te delen.

## Wat nu?

| Je wilt… | Ga naar |
| --- | --- |
| De 3D-/2D-bediening leren | [De viewer gebruiken](/help/using-the-viewer) |
| Een mens spreken | Gebruik de **Support**-tegel boven aan deze pagina |

Dat is de hele cyclus — **project → container → viewer → bevindingen → rapporten**. Welkom.`,
  },
};
