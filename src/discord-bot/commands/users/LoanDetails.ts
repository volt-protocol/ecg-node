import {
  CommandInteraction,
  InteractionReplyOptions,
  ApplicationCommandData,
  ApplicationCommandOptionType,
  blockQuote
} from 'discord.js';
import path from 'path';
import fs from 'fs';
import { GLOBAL_DATA_DIR } from '../../../utils/Constants';
import { ReadJSON } from '../../../utils/Utils';
import { Loan, LoansFileStructure } from '../../../model/Loan';
import { GetMarketsDirectories } from '../../../utils/MultiMarketHelper';

export class LoanDetailsCommand {
  static cmd: ApplicationCommandData = {
    name: 'loan-details',
    description: 'Get loan detail by loan id',
    options: [
      {
        name: 'loanid',
        description: 'The loan id you want to get the detail',
        required: true,
        type: ApplicationCommandOptionType.String
      }
    ]
  };

  static getLoanDetails(interaction: CommandInteraction): string {
    const loanId = interaction.options.data.find((_) => _.name == 'loanid');
    if (!loanId || !loanId.value || !(loanId.value as string)) {
      return 'Cannot find loanId in parameters';
    }

    let loan: Loan | undefined = undefined;
    for (const marketDir of GetMarketsDirectories()) {
      const loansFilename = path.join(marketDir, 'loans.json');
      const loanFileData: LoansFileStructure = ReadJSON(loansFilename);
      loan = loanFileData.loans.find((_) => _.id == (loanId.value as string));
      if (loan) {
        // loan found, can skip market search
        break;
      }
    }

    if (loan) {
      return blockQuote(`\`\`\`json\n${JSON.stringify(loan, null, 2)}\`\`\``);
    } else {
      return 'Cannot find loanId in loans';
    }
  }

  static async execute(interaction: CommandInteraction) {
    await interaction.deferReply({ ephemeral: true });
    const msg = this.getLoanDetails(interaction);
    const reply: InteractionReplyOptions = {
      ephemeral: true,
      content: msg
    };
    await interaction.editReply(reply);
  }
}
