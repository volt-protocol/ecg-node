import {
  CommandInteraction,
  InteractionReplyOptions,
  ApplicationCommandData,
  ApplicationCommandOptionType,
  blockQuote
} from 'discord.js';
import path from 'path';
import { DATA_DIR } from '../../../utils/Constants';
import { ReadJSON } from '../../../utils/Utils';
import { LoansFileStructure } from '../../../model/Loan';

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

    const loansFilename = path.join(DATA_DIR, 'loans.json');
    const loanFileData: LoansFileStructure = ReadJSON(loansFilename);

    const loan = loanFileData.loans.find((_) => _.id == (loanId.value as string));
    if (!loan) {
      return 'Cannot find loanId in loans';
    }

    return blockQuote(`\`\`\`json\n${JSON.stringify(loan, null, 2)}\`\`\``);
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
