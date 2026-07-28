const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');
require('dotenv').config();

const commands = [];
const slashPath = path.join(__dirname, 'commands', 'slash');
const slashFiles = fs.readdirSync(slashPath).filter(file => file.endsWith('.js'));

for (const file of slashFiles) {
  const command = require(path.join(slashPath, file));
  commands.push(command.data.toJSON());
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`Registrazione di ${commands.length} slash command...`);

    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );

    console.log('✅ Slash command registrati con successo!');
  } catch (error) {
    console.error(error);
  }
})();