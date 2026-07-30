'use strict';

// Gerarchia del Sheriff's Department.
// I ruoli sono identificati per ID (stabili se rinomini il ruolo).
// Ogni gruppo e' un blocco separato da **--------------------------------------------------------------------------------**.
// footerRoles appaiono in fondo senza separatori di grado.

module.exports = {
  title: "# GERARCHIA SCHERIFF'S DEPARTMENT",

  // Separatore tra ruoli dello stesso gruppo (sottile)
  separator: '--------------------------------------------------------------------------------------',

  // Separatore tra gruppi (in grassetto)
  groupSeparator: '**--------------------------------------------------------------------------------**',

  // Placeholder se nessun membro ha quel ruolo
  emptyPlaceholder: '//',

  groups: [
    // Alto comando
    [
      '1527670632647495831',
      '1527670734615351348',
      '1527670988769067008',
    ],
    // Ufficiali
    [
      '1527671139600568430',
      '1527671193862148208',
      '1527671248233037955',
      '1527671305581891614',
    ],
    // NCO
    [
      '1527671357763223574',
      '1527671411680743424',
    ],
    // Agenti
    [
      '1527671448729157713',
      '1527671507386634240',
      '1527671541167558697',
    ],
    // Base
    [
      '1527671588655333376',
    ],
  ],

  // Ruolo di reparto / footer (es. @Sheriff's Department)
  footerRoles: [
    '1527672537012637886',
  ],
};
