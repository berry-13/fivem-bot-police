'use strict';

const { onInviteCreate } = require('../lib/invites');

module.exports = {
  name: 'inviteCreate',
  execute(invite) {
    onInviteCreate(invite);
  },
};
