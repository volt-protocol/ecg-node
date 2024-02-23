import { Webhook } from 'discord-webhook-node';

const DISCORD_WEBHOOK_URL: string | undefined = process.env.DISCORD_WEBHOOK_URL;
export async function SendDiscordMessage(sender: string, title: string, msg: string) {
  if (!DISCORD_WEBHOOK_URL) {
    return;
  }

  const hook = new Webhook(DISCORD_WEBHOOK_URL);

  await hook.info(`[${sender}]`, truncateFieldValue(title), truncateFieldValue(msg));
}

function truncateFieldValue(value: string) {
  if (value.length >= 1000) {
    return value.substring(0, 999);
  }

  return value;
}
