import { CommandInteraction, ApplicationCommandData, InteractionReplyOptions } from 'discord.js';

export class ServerCommand {
  static cmd: ApplicationCommandData = {
    name: 'server',
    description: 'Sends server data'
  };

  static async execute(interaction: CommandInteraction) {
    const reply: InteractionReplyOptions = {
      ephemeral: true,
      content: `This server is ${interaction.guild!.name} and has ${interaction.guild!.memberCount} members.`
    };
    await interaction.reply(reply);
  }
}
