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
import path from 'path';
import { DATA_DIR } from '../utils/Constants';
import { mkdirSync } from 'fs';
import { LinkWalletCommand } from './commands/users/LinkWallet';
import { OpenLoansCommand } from './commands/users/OpenLoans';
import { LoanDetailsCommand } from './commands/users/LoanDetails';
import { UnlinkWalletCommand } from './commands/users/UnlinkWallet';
import { ListWalletsCommands } from './commands/users/ListWallets';
dotenv.config();
const TOKEN = process.env.BOT_TOKEN;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const userDataDir = path.join(DATA_DIR, 'bot', 'users');
mkdirSync(userDataDir, { recursive: true });

// When the client is ready, run this code (only once).
// The distinction between `client: Client<boolean>` and `readyClient: Client<true>` is important for TypeScript developers.
// It makes some properties non-nullable.
client.once(Events.ClientReady, (readyClient) => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);

  if (client.application) {
    client.application.commands
      .set([
        PingCommand.cmd,
        LinkWalletCommand.cmd,
        UnlinkWalletCommand.cmd,
        OpenLoansCommand.cmd,
        LoanDetailsCommand.cmd,
        ListWalletsCommands.cmd
      ])
      .then((_) => {
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
    case LinkWalletCommand.cmd.name: {
      await LinkWalletCommand.execute(interaction);
      break;
    }
    case OpenLoansCommand.cmd.name: {
      await OpenLoansCommand.execute(interaction);
      break;
    }
    case LoanDetailsCommand.cmd.name: {
      await LoanDetailsCommand.execute(interaction);
      break;
    }
    case UnlinkWalletCommand.cmd.name: {
      await UnlinkWalletCommand.execute(interaction);
      break;
    }
    case ListWalletsCommands.cmd.name: {
      await ListWalletsCommands.execute(interaction);
      break;
    }
  }
});

// Log in to Discord with your client's token
client.login(TOKEN);
