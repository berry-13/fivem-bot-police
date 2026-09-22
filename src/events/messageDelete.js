'use strict';

const { logMessageDelete, safely } = require('../lib/logs');

module.exports = {
  name: 'messageDelete',
  execute(message) {
    return safely('messageDelete', () => logMessageDelete(message));
  },
};
