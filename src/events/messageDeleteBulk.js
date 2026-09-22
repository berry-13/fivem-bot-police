'use strict';

const { logMessageDeleteBulk, safely } = require('../lib/logs');

module.exports = {
  name: 'messageDeleteBulk',
  execute(messages, channel) {
    return safely('messageDeleteBulk', () => logMessageDeleteBulk(messages, channel));
  },
};
