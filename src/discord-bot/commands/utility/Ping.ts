import { CommandInteraction, InteractionReplyOptions, ApplicationCommandData } from 'discord.js';

export class PingCommand {
  static cmd: ApplicationCommandData = {
    name: 'ping',
    description: 'Replies with Pong!'
  };

  static async execute(interaction: CommandInteraction) {
    const reply: InteractionReplyOptions = {
      ephemeral: true,
      content: `Pong, ${interaction.user.displayName}!`
    };
    await interaction.reply(reply);
  }
}
