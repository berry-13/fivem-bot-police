'use strict';

const { logMessageUpdate, safely } = require('../lib/logs');

module.exports = {
  name: 'messageUpdate',
  execute(oldMessage, newMessage) {
    return safely('messageUpdate', () => logMessageUpdate(oldMessage, newMessage));
  },
};
