import { SendDiscordMessage, SendDiscordMessageList } from './DiscordHelper';
import { SendTelegramMessage } from './TelegramHelper';
import { retry } from './Utils';

export async function SendNotifications(sender: string, title: string, msg: string) {
  const tgPromise = retry(SendTelegramMessage, [`[${sender}] ${title}\n${msg}`]);
  const discordPromise = retry(SendDiscordMessage, [sender, title, msg]);

  await Promise.all([tgPromise, discordPromise]);
}

export async function SendNotificationsList(
  sender: string,
  title: string,
  fields: { fieldName: string; fieldValue: string }[],
  isWatcher = false
) {
  // check that the env variable set are the global notifications env
  // variable and not the watcher ones. If isWatcher = true, then just proceed
  if (!isWatcher) {
    const atLeastOneNotificationChannelEnabled =
      (process.env.TG_BOT_ID != undefined && process.env.TG_CHAT_ID != undefined) ||
      process.env.DISCORD_WEBHOOK_URL != undefined;
    if (!atLeastOneNotificationChannelEnabled) {
      return;
    }
  }

  let tgMsg = '';
  for (const field of fields) {
    tgMsg += `${field.fieldName}: ${field.fieldValue}\n`;
  }
  const tgPromise = retry(SendTelegramMessage, [`[${sender}] ${title}\n${tgMsg}`]);
  const discordPromise = retry(SendDiscordMessageList, [sender, title, fields]);

  await Promise.all([tgPromise, discordPromise]);
}

export async function SendNotificationsListWatcher(
  sender: string,
  title: string,
  fields: { fieldName: string; fieldValue: string }[]
) {
  let tgMsg = '';
  for (const field of fields) {
    tgMsg += `${field.fieldName}: ${field.fieldValue}\n`;
  }
  const tgPromise = retry(SendTelegramMessage, [`[${sender}] ${title}\n${tgMsg}`]);
  const discordPromise = retry(SendDiscordMessageList, [sender, title, fields]);

  await Promise.all([tgPromise, discordPromise]);
}
