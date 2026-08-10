'use strict';

// Streamer da monitorare per le notifiche live.
// platform: 'twitch' | 'tiktok'
// id: login Twitch (minuscolo) o username TikTok senza @
// displayName: nome mostrato nel messaggio Discord (opzionale)

module.exports = {
  // Intervallo di default tra un controllo e l'altro (ms).
  // Sovrascrivibile con LIVE_POLL_INTERVAL_MS.
  defaultPollIntervalMs: 60_000,

  streamers: [
    {
      platform: 'twitch',
      id: 'salvinosalvo',
      displayName: 'SalvinoSalvo',
    },
    {
      platform: 'tiktok',
      id: 'xx_cicci_xx',
      displayName: 'xx_cicci_xx',
    },
    {
      platform: 'twitch',
      id: 'ydiablo93',
      displayName: 'YDiablo93',
    },
    {
      platform: 'twitch',
      id: 'bigtaurus94',
      displayName: 'BigTaurus94',
    },
  ],
};
