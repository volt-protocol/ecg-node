import { MessageBuilder, Webhook } from 'discord-webhook-node';

export async function SendDiscordMessage(hookUrl: string, sender: string, title: string, msg: string) {
  const hook = new Webhook(hookUrl);

  await hook.info(`[${sender}]`, truncateFieldValue(title), truncateFieldValue(msg));
}

export async function SendDiscordMessageList(
  hookUrl: string,
  sender: string,
  title: string,
  fields: { fieldName: string; fieldValue: string }[]
) {
  const hook = new Webhook(hookUrl);

  const builder = new MessageBuilder();
  builder.setTitle(`[${sender}]`);
  builder.setDescription(title);
  for (const field of fields) {
    builder.addField(field.fieldName, field.fieldValue, false);
  }

  builder.setTimestamp();

  await hook.send(builder);
}

function truncateFieldValue(value: string) {
  if (value.length >= 1000) {
    return value.substring(0, 999);
  }

  return value;
}
