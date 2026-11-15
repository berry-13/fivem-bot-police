'use strict';

// Liste dei reparti: come la gerarchia, ma ognuna in un canale fisso.
// Il bot pubblica il messaggio al primo avvio e lo riedita da solo quando
// cambia un ruolo elencato (o esce un membro che lo aveva).
// Ogni gruppo: `roles` = una riga per ruolo con i membri, `footer` = ruolo
// di reparto mostrato sotto il gruppo senza membri (facoltativo).

module.exports = {
  // Separatore tra il titolo e i gruppi e tra un gruppo e l'altro.
  separator: '--------------------------------------------------------------------------------------',
  emptyPlaceholder: '//',

  boards: [
    {
      key: 'logistici',
      channelId: '1528106291376164934', // 📌・ʀᴇꜱᴘᴏɴꜱᴀʙɪʟɪ_ᴅɪ_ʀᴇᴘᴀʀᴛᴏ
      title: '# **REPARTI LOGISTICI**',
      groups: [
        // HR
        {
          roles: [
            '1527674377418576014', // Capo Reparto
            '1527674278303109360', // Vice Capo Reparto
            '1527674061885407352', // Esaminatore
            '1527673776957948015', // Istruttore
          ],
        },
        // CID
        {
          roles: [
            '1527677464988618982',
            '1527677406213705848',
            '1527677291641962758',
            '1527677343076712568',
          ],
          footer: '1527676976163328172',
        },
        // Coordinamento
        {
          roles: [
            '1528396342303395840',
            '1528396343067021502',
            '1528396344258199604',
            '1528396343557754931',
          ],
          footer: '1528393895615135914',
        },
        // Documentazione
        {
          roles: [
            '1528391600462364783',
            '1528391601146298499',
            '1528391601896816840',
            '1528391602509189210',
          ],
          footer: '1528390001044492388',
        },
        // Magazzino
        {
          roles: [
            '1528479321285726338',
            '1528479322476908686',
            '1528479322816385215',
            '1528479321818271804',
          ],
          footer: '1545098668816867419',
        },
        // Pubbliche Relazioni
        {
          roles: [
            '1528480368687186001',
            '1528480368745906216',
            '1528480369593159800',
            '1528480373674217643',
          ],
        },
      ],
    },
  ],
};
