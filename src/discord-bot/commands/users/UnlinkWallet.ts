import {
  CommandInteraction,
  InteractionReplyOptions,
  ApplicationCommandData,
  ApplicationCommandOptionType
} from 'discord.js';
import path from 'path';
import { GLOBAL_DATA_DIR } from '../../../utils/Constants';
import fs from 'fs';
import { ReadJSON, WriteJSON } from '../../../utils/Utils';
import { DiscordUserSavedData } from '../../model/DiscordUserSavedData';
import { ethers } from 'ethers';

export class UnlinkWalletCommand {
  static cmd: ApplicationCommandData = {
    name: 'unlink-wallet',
    description: 'Unlink a public address to your discord username',
    options: [
      {
        name: 'address',
        description: 'Address to unlink',
        required: true,
        type: ApplicationCommandOptionType.String
      }
    ]
  };

  static unlinkWallet(userId: string, interaction: CommandInteraction): string {
    const userFilePath = path.join(GLOBAL_DATA_DIR, 'bot', 'users', `${userId}.json`);

    let userData: DiscordUserSavedData = {
      addresses: []
    };

    if (fs.existsSync(userFilePath)) {
      userData = ReadJSON(userFilePath);
    }

    if (userData.addresses.length == 0) {
      return '0 linked address found';
    }

    const addressToRemove = interaction.options.data.find((_) => _.name == 'address');
    if (!addressToRemove || !addressToRemove.value || !(addressToRemove.value as string)) {
      return `Cannot find address in parameters | currently ${userData.addresses.length} linked address to your user`;
    }

    const stringVal = addressToRemove.value as string;

    if (!ethers.isAddress(stringVal)) {
      return `Invalid address given, please use checksumed address | currently ${userData.addresses.length} linked address to your user`;
    }

    const index = userData.addresses.indexOf(stringVal);
    if (index >= 0) {
      userData.addresses.splice(index, 1);
      WriteJSON(userFilePath, userData);
      return `${stringVal} successfully unlinked from your user | currently ${userData.addresses.length} linked address to your user`;
    } else {
      return 'Address not found in your linked addresses';
    }
  }

  static async execute(interaction: CommandInteraction) {
    await interaction.deferReply({ ephemeral: true });
    const msg = this.unlinkWallet(interaction.user.id, interaction);
    const reply: InteractionReplyOptions = {
      ephemeral: true,
      content: msg
    };
    await interaction.editReply(reply);
  }
}
