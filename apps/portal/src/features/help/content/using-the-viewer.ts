import { Box } from '@bimdossier/ui/icons';

import type { HelpArticle } from './types';

export const usingTheViewer: HelpArticle = {
  slug: 'using-the-viewer',
  category: 'viewer',
  icon: Box,
  order: 1,
  lastUpdated: '2026-06-26',
  title: {
    en: 'Using the viewer',
    nl: 'De viewer gebruiken',
  },
  summary: {
    en: 'Navigate models in 3D and 2D, measure, cut sections, and place finding pins.',
    nl: 'Navigeer modellen in 3D en 2D, meet, maak doorsneden en plaats bevindingspins.',
  },
  body: {
    en: `## The viewer at a glance

Open any *ready* container to launch the viewer. It can show your model in **3D**, as a
**2D** floor plan, or in a **split** view with both at once. Use the mode switcher in the
toolbar to change at any time.

## Navigating in 3D

| Action | How |
| --- | --- |
| Orbit | Left-drag |
| Pan | Right-drag |
| Zoom | Scroll wheel |
| Frame the model | Press the **Home** control |

Click any element to select it; its properties appear in the side panel. Selecting an
element also sets it as the orbit pivot, so rotation stays centred on what you care about.

## Working in 2D

Switch to **2D** to read a floor plan. Use the storey selector to move between levels. A
static **true-north compass** shows the plan's orientation. The 2D and 3D views stay
linked, so what you isolate in one reflects in the other.

## Measuring & sections

- **Measure** — pick two points to read the distance between them.
- **Section** — cut a clipping plane through the model to see inside. Place it on a face,
  then drag to move the cut.

## Placing finding pins

To log a snag exactly where it belongs, start a **finding** and place its pin on the model
(3D), the floor plan (2D), or a PDF drawing. The pin's colour reflects the finding's
status, and an open finding shows a red ring until it is closed.

> **Tip:** spaces (\`IfcSpace\`) are hidden by default to reduce clutter. Toggle them back on
> from the viewer settings when you need to see zones.

## Performance

The viewer renders on demand and uses native frustum culling, so even large federated
models stay responsive. If a model looks off-screen or offset, try the **Home** control to
re-frame it.`,
    nl: `## De viewer in het kort

Open een *gereed* container om de viewer te starten. Hij toont je model in **3D**, als
**2D**-plattegrond, of in een **split**-weergave met beide tegelijk. Wissel op elk moment
met de modusknop in de werkbalk.

## Navigeren in 3D

| Actie | Hoe |
| --- | --- |
| Draaien | Slepen met links |
| Verschuiven | Slepen met rechts |
| Zoomen | Scrollwiel |
| Model passend maken | Druk op de **Home**-knop |

Klik op een element om het te selecteren; de eigenschappen verschijnen in het zijpaneel.
Een geselecteerd element wordt ook het draaipunt, zodat het roteren gecentreerd blijft op
wat jij belangrijk vindt.

## Werken in 2D

Schakel naar **2D** om een plattegrond te lezen. Gebruik de verdiepingkiezer om tussen
niveaus te wisselen. Een statisch **noordkompas** toont de oriëntatie van de plattegrond.
De 2D- en 3D-weergaven blijven gekoppeld, dus wat je in de ene isoleert, zie je in de andere.

## Meten & doorsneden

- **Meten** — kies twee punten om de afstand ertussen af te lezen.
- **Doorsnede** — leg een snijvlak door het model om naar binnen te kijken. Plaats het op
  een vlak en sleep om de snede te verplaatsen.

## Bevindingspins plaatsen

Om een snag precies op de juiste plek vast te leggen, start je een **bevinding** en plaats
je de pin op het model (3D), de plattegrond (2D) of een PDF-tekening. De kleur van de pin
weerspiegelt de status, en een open bevinding toont een rode ring totdat hij gesloten is.

> **Tip:** ruimtes (\`IfcSpace\`) zijn standaard verborgen om rommel te beperken. Zet ze weer
> aan via de viewer-instellingen wanneer je zones wilt zien.

## Prestaties

De viewer rendert op aanvraag en gebruikt native frustum-culling, zodat zelfs grote
gefedereerde modellen vlot blijven. Lijkt een model buiten beeld of verschoven? Gebruik de
**Home**-knop om het opnieuw passend te maken.`,
  },
};
