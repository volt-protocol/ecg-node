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
