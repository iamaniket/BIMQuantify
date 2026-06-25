import type { LegalContent } from './types.js';

export const legalNlContent: LegalContent = {
  meta: {
    draftBanner: 'Concept: nog te beoordelen door een Nederlandse IT-juridisch specialist voordat het in productie komt.',
    lastUpdatedLabel: 'Laatst bijgewerkt: {date}',
  },
  privacy: {
    title: 'Privacyverklaring',
    intro: 'BimDossier verwerkt persoonsgegevens van kwaliteitsborgers, aannemers en projectteams die gebruikmaken van het BimDossier-portaal. Deze verklaring beschrijft welke gegevens we verzamelen, met welk doel, en welke rechten je hebt onder de AVG/GDPR.',
    lastUpdated: '2026-05-10',
    sections: [
      {
        title: 'Welke gegevens we verwerken',
        body: 'Account- en contactgegevens (naam, e-mailadres, organisatie), projectinhoud die je uploadt (IFC-modellen, foto\'s, documenten), inspectiebevindingen en bijbehorende metadata, en technische loggegevens om de dienst te beveiligen en te verbeteren.',
      },
      {
        title: 'Doel van de verwerking',
        body: 'Het uitvoeren van de Wet kwaliteitsborging voor het bouwen (Wkb)-werkprocessen die je bij ons uitvoert: het bijhouden van borgingsplannen, inspecties, bevindingen en dossiervorming voor het bevoegd gezag. Wij verkopen je gegevens niet en gebruiken ze niet voor profiling of geautomatiseerde besluitvorming.',
      },
      {
        title: 'Bewaartermijn',
        body: 'Gegevens die deel uitmaken van een Wet kwaliteitsborging voor het bouwen (Wkb)-dossier worden conform de wettelijke bewaarplicht 10 jaar bewaard na oplevering. Account- en factuurgegevens bewaren we zo lang als noodzakelijk voor de uitvoering van de overeenkomst en de geldende fiscale bewaartermijn.',
      },
      {
        title: 'Jouw rechten',
        body: 'Je hebt recht op inzage, correctie, beperking van de verwerking, dataportabiliteit en (binnen de grenzen van de wettelijke bewaarplicht) verwijdering. Verzoeken kun je richten aan info@bimdossier.nl. Klachten kun je ook indienen bij de Autoriteit Persoonsgegevens.',
      },
      {
        title: 'Hosting en sub-verwerkers',
        body: 'Alle persoonsgegevens worden binnen de EU gehost. Een actuele lijst van sub-verwerkers (zoals onze e-mail-, betaal- en opslagleverancier) is opgenomen in de Verwerkersovereenkomst (DPA).',
      },
    ],
  },
  terms: {
    title: 'Algemene voorwaarden',
    intro: 'Deze voorwaarden zijn van toepassing op het gebruik van het BimDossier-portaal door zakelijke gebruikers. Door een account aan te maken of het portaal te gebruiken, ga je akkoord met deze voorwaarden.',
    lastUpdated: '2026-05-10',
    sections: [
      {
        title: 'De dienst',
        body: 'BimDossier is een softwareplatform voor kwaliteitsborging onder de Wet kwaliteitsborging voor het bouwen (Wkb). Het portaal ondersteunt onder andere risicobeoordelingen, borgingsplannen, inspecties, bevindingen en dossiervorming.',
      },
      {
        title: 'Jouw verplichtingen',
        body: 'Je zorgt voor juiste accountgegevens, deelt geen inloggegevens met derden, en gebruikt het portaal in overeenstemming met geldende wet- en regelgeving. De verantwoordelijkheid voor het inhoudelijke werk, zoals het indienen van meldingen bij het bevoegd gezag, blijft bij jou liggen.',
      },
      {
        title: 'Abonnement en betaling',
        body: 'Abonnementen lopen maandelijks of jaarlijks en worden automatisch verlengd tenzij vóór het verlengmoment opgezegd. Betaling vindt plaats via de in het portaal geboden betaalmethoden. Bij niet-betaling kunnen wij de toegang tot het account beperken.',
      },
      {
        title: 'Aansprakelijkheid',
        body: 'Onze aansprakelijkheid is beperkt tot directe schade tot maximaal het in de voorgaande twaalf maanden door jou betaalde abonnementsbedrag. Aansprakelijkheid voor indirecte schade, gevolgschade of gemiste besparingen is uitgesloten, behoudens opzet of bewuste roekeloosheid.',
      },
      {
        title: 'Beëindiging',
        body: 'Je kunt het abonnement opzeggen vanuit de portaalinstellingen. Bij beëindiging blijven Wet kwaliteitsborging voor het bouwen (Wkb)-dossiers beschikbaar zolang dat wettelijk vereist is; daarna worden ze veilig verwijderd.',
      },
    ],
  },
  dpa: {
    title: 'Verwerkersovereenkomst (DPA)',
    intro: 'Deze concept-DPA beschrijft hoe BimDossier (verwerker) persoonsgegevens verwerkt namens de klant (verantwoordelijke) bij het gebruik van het BimDossier-portaal. Een ondertekenbare PDF-versie wordt op verzoek toegestuurd.',
    lastUpdated: '2026-05-10',
    sections: [
      {
        title: 'Onderwerp en duur',
        body: 'De verwerking betreft persoonsgegevens van projectdeelnemers en eindgebruikers, voor de duur van de hoofdovereenkomst en eventuele wettelijke bewaartermijnen die daarna nog gelden.',
      },
      {
        title: 'Categorieën betrokkenen en gegevens',
        body: 'Betrokkenen: medewerkers van de verantwoordelijke, kwaliteitsborgers, aannemers en andere projectdeelnemers. Gegevens: contact- en accountgegevens, projectinhoud, inspectie-evidentie (foto\'s, locatiegegevens) en gebruikslogs.',
      },
      {
        title: 'Sub-verwerkers',
        body: 'Wij maken gebruik van zorgvuldig geselecteerde sub-verwerkers binnen de EU voor hosting, e-maildiensten, betalingsverwerking en foutmonitoring. Een actuele lijst is op verzoek beschikbaar; wij informeren de verantwoordelijke vooraf bij wijzigingen.',
      },
      {
        title: 'Beveiligingsmaatregelen',
        body: 'Wij hanteren passende technische en organisatorische maatregelen, waaronder encryptie tijdens transport en opslag, toegangsbeheer op basis van least privilege, audit logging en regelmatige back-ups.',
      },
      {
        title: 'Datalekken',
        body: 'Bij een vermoeden van een datalek informeren wij de verantwoordelijke zonder onnodige vertraging na ontdekking, met de tot dan toe bekende informatie en een initiële inschatting van impact en mitigerende maatregelen.',
      },
      {
        title: 'Rechten van betrokkenen',
        body: 'Wij ondersteunen de verantwoordelijke bij het beantwoorden van verzoeken van betrokkenen (inzage, correctie, verwijdering, dataportabiliteit) binnen de wettelijke termijnen.',
      },
      {
        title: 'Teruggave en verwijdering',
        body: 'Na beëindiging van de hoofdovereenkomst worden persoonsgegevens op verzoek teruggegeven of veilig verwijderd, behoudens wettelijke bewaarplichten zoals de 10-jaarsbewaring voor Wet kwaliteitsborging voor het bouwen (Wkb)-dossiers.',
      },
    ],
  },
};
