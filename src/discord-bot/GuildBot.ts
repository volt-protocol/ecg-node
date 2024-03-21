import {
  ApplicationCommandDataResolvable,
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  InteractionReplyOptions
} from 'discord.js';
import * as dotenv from 'dotenv';
import { PingCommand } from './commands/utility/Ping';
import { UserCommand } from './commands/utility/User';
import { ServerCommand } from './commands/utility/Server';
dotenv.config();
const TOKEN = process.env.BOT_TOKEN;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// When the client is ready, run this code (only once).
// The distinction between `client: Client<boolean>` and `readyClient: Client<true>` is important for TypeScript developers.
// It makes some properties non-nullable.
client.once(Events.ClientReady, (readyClient) => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);

  if (client.application) {
    client.application.commands.set([PingCommand.cmd, UserCommand.cmd, ServerCommand.cmd]).then((_) => {
      console.log('Reloaded commands');
    });
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  switch (interaction.commandName) {
    case 'ping': {
      await PingCommand.execute(interaction);
      break;
    }
    case 'user': {
      await UserCommand.execute(interaction);
      break;
    }
    case 'server': {
      await ServerCommand.execute(interaction);
      break;
    }
  }
});

// Log in to Discord with your client's token
client.login(TOKEN);
