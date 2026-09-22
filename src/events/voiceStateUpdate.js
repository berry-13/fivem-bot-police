'use strict';

const { logVoiceStateUpdate, safely } = require('../lib/logs');

module.exports = {
  name: 'voiceStateUpdate',
  execute(oldState, newState) {
    return safely('voiceStateUpdate', () => logVoiceStateUpdate(oldState, newState));
  },
};
