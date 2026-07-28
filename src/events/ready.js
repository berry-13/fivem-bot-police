module.exports = {
  name: 'clientReady',
  once: true,
  execute(client) {
    console.log(`Bot online come ${client.user.tag}`);
  },
};