import { MessageBuilder, Webhook } from 'discord-webhook-node';
import { truncateString } from './Utils';

export async function SendDiscordMessage(hookUrl: string, sender: string, title: string, msg: string) {
  const hook = new Webhook(hookUrl);

  await hook.info(`[${sender}]`, truncateString(title), truncateString(msg));
}

export async function SendDiscordMessageList(
  hookUrl: string,
  sender: string,
  title: string,
  fields: { fieldName: string; fieldValue: string }[]
) {
  const hook = new Webhook(hookUrl);

  const builder = new MessageBuilder();
  builder.setTitle(`${sender}`);
  builder.setDescription(title);
  for (const field of fields) {
    builder.addField(field.fieldName, field.fieldValue, false);
  }

  builder.setTimestamp();

  await hook.send(builder);
}
