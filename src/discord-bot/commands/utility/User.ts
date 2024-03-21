import { CommandInteraction, GuildMember, ApplicationCommandData, InteractionReplyOptions } from 'discord.js';

export class UserCommand {
  static cmd: ApplicationCommandData = {
    name: 'user',
    description: 'Sends user data'
  };

  static async execute(interaction: CommandInteraction) {
    const reply: InteractionReplyOptions = {
      ephemeral: true,
      content: `This command was run by ${interaction.user.username}, who joined on ${
        (interaction.member! as GuildMember).joinedAt
      }.`
    };
    await interaction.reply(reply);
  }
}
