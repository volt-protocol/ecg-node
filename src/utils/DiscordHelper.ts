import { MessageBuilder, Webhook } from 'discord-webhook-node';

export async function SendDiscordMessage(sender: string, title: string, msg: string) {
  const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
  if (!DISCORD_WEBHOOK_URL) {
    return;
  }

  const hook = new Webhook(DISCORD_WEBHOOK_URL);

  await hook.info(`[${sender}]`, truncateFieldValue(title), truncateFieldValue(msg));
}

export async function SendDiscordMessageList(
  sender: string,
  title: string,
  fields: { fieldName: string; fieldValue: string }[]
) {
  const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || process.env.WATCHER_DISCORD_WEBHOOK_URL;
  if (!DISCORD_WEBHOOK_URL) {
    return;
  }

  const hook = new Webhook(DISCORD_WEBHOOK_URL);

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
