'use strict';

const { onInviteDelete } = require('../lib/invites');

module.exports = {
  name: 'inviteDelete',
  execute(invite) {
    onInviteDelete(invite);
  },
};
