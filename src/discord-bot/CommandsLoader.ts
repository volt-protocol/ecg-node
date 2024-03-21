import { Client, Collection, Events, GatewayIntentBits, REST, Routes } from 'discord.js';
import * as dotenv from 'dotenv';
import { PingCommand } from './commands/utility/Ping';
import { ServerCommand } from './commands/utility/Server';
import { UserCommand } from './commands/utility/User';
dotenv.config();
const TOKEN = process.env.BOT_TOKEN;
const APP_ID = process.env.BOT_APPLICATION_ID;

export async function ReloadCommands() {
  if (!TOKEN) {
    throw new Error('Cannot read BOT_TOKEN env variable');
  }
  if (!APP_ID) {
    throw new Error('Cannot read BOT_APPLICATION_ID env variable');
  }
  // loads commands
  const rest = new REST({ version: '10' }).setToken(TOKEN);

  try {
    console.log('Started refreshing application (/) commands.');

    const commands = [PingCommand.cmd, ServerCommand.cmd, UserCommand.cmd];

    await rest.put(Routes.applicationCommands(APP_ID), { body: commands });

    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
}
