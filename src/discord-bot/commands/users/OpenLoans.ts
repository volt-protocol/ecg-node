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
import { LoanStatus, LoansFileStructure } from '../../../model/Loan';
import { GetMarketsDirectories } from '../../../utils/MultiMarketHelper';

export class OpenLoansCommand {
  static cmd: ApplicationCommandData = {
    name: 'open-loans',
    description: 'Fetches all open loans for all linked addresses'
  };

  static fetchUserLoans(userId: string): string {
    const userFilePath = path.join(GLOBAL_DATA_DIR, 'bot', 'users', `${userId}.json`);

    if (!fs.existsSync(userFilePath)) {
      return 'Cannot find any linked address with your username';
    }

    const userData: DiscordUserSavedData = ReadJSON(userFilePath);

    if (userData.addresses.length == 0) {
      return 'Cannot find any linked address with your username';
    }

    // read all loans file
    const allUsersLoanIds: string[] = [];
    for (const marketDir of GetMarketsDirectories()) {
      const loansFilename = path.join(marketDir, 'loans.json');
      const loanFileData: LoansFileStructure = ReadJSON(loansFilename);
      const allUsersLoanIdsForMarket = loanFileData.loans
        .filter((_) => _.status == LoanStatus.ACTIVE || _.status == LoanStatus.CALLED)
        .filter((_) => userData.addresses.includes(_.borrowerAddress))
        .map((_) => `${_.id} (status: ${_.status})`);

      allUsersLoanIds.push(...allUsersLoanIdsForMarket);
    }

    if (allUsersLoanIds.length == 0) {
      return `You have no open loans. Checked address(es):\n ${userData.addresses.join('\n')} `;
    }

    return `Your loans:\n${allUsersLoanIds.join('\n')}`;
  }

  static async execute(interaction: CommandInteraction) {
    await interaction.deferReply({ ephemeral: true });
    const msg = this.fetchUserLoans(interaction.user.id);
    const reply: InteractionReplyOptions = {
      ephemeral: true,
      content: msg
    };
    await interaction.editReply(reply);
  }
}
