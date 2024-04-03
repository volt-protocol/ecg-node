import { CommandInteraction, InteractionReplyOptions, ApplicationCommandData } from 'discord.js';
import path from 'path';
import { GLOBAL_DATA_DIR } from '../../../utils/Constants';
import fs from 'fs';
import { ReadJSON } from '../../../utils/Utils';
import { DiscordUserSavedData } from '../../model/DiscordUserSavedData';

export class ListWalletsCommands {
  static cmd: ApplicationCommandData = {
    name: 'list-wallets',
    description: 'List all addresses linked to your user'
  };

  static listWallets(userId: string): string {
    const userFilePath = path.join(GLOBAL_DATA_DIR, 'bot', 'users', `${userId}.json`);

    let userData: DiscordUserSavedData = {
      addresses: []
    };

    if (fs.existsSync(userFilePath)) {
      userData = ReadJSON(userFilePath);
    }

    if (userData.addresses.length == 0) {
      return '0 linked address found';
    } else {
      return `Linked addresses:\n${userData.addresses.join('\n')}`;
    }
  }

  static async execute(interaction: CommandInteraction) {
    await interaction.deferReply({ ephemeral: true });
    const msg = this.listWallets(interaction.user.id);
    const reply: InteractionReplyOptions = {
      ephemeral: true,
      content: msg
    };
    await interaction.editReply(reply);
  }
}
