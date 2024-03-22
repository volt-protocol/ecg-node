import {
  CommandInteraction,
  InteractionReplyOptions,
  ApplicationCommandData,
  ApplicationCommandOptionType
} from 'discord.js';
import path from 'path';
import { DATA_DIR } from '../../../utils/Constants';
import fs from 'fs';
import { ReadJSON, WriteJSON } from '../../../utils/Utils';
import { DiscordUserSavedData } from '../../model/DiscordUserSavedData';
import { ethers } from 'ethers';

export class LinkWalletCommand {
  static cmd: ApplicationCommandData = {
    name: 'link-wallet',
    description: 'Link a public address to you discord username. allowing other calls after',
    options: [
      {
        name: 'address',
        description: 'Address to link to you user',
        type: ApplicationCommandOptionType.String
      }
    ]
  };

  static recordUser(userId: string, interaction: CommandInteraction): string {
    const userFilePath = path.join(DATA_DIR, 'bot', 'users', `${userId}.json`);

    let userData: DiscordUserSavedData = {
      addresses: []
    };

    if (fs.existsSync(userFilePath)) {
      userData = ReadJSON(userFilePath);
    }

    const addressToAdd = interaction.options.data.find((_) => _.name == 'address');
    if (!addressToAdd || !addressToAdd.value || !(addressToAdd.value as string)) {
      return `Cannot find address in parameters | currently ${userData.addresses.length} linked address to your user`;
    }

    const stringVal = addressToAdd.value as string;

    if (!ethers.isAddress(stringVal)) {
      return `Invalid address given, please use checksumed address | currently ${userData.addresses.length} linked address to your user`;
    }

    if (userData.addresses.includes(stringVal)) {
      return `Address already linked to your user | currently ${userData.addresses.length} linked address to your user`;
    }

    userData.addresses.push(stringVal);

    WriteJSON(userFilePath, userData);

    return `${stringVal} added | currently ${userData.addresses.length} linked address to your user`;
  }

  static async execute(interaction: CommandInteraction) {
    await interaction.deferReply({ ephemeral: true });
    const msg = this.recordUser(interaction.user.id, interaction);
    const reply: InteractionReplyOptions = {
      ephemeral: true,
      content: msg
    };
    await interaction.editReply(reply);
  }
}
