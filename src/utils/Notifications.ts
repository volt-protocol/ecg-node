import { SendDiscordMessage } from './DiscordHelper';
import { SendTelegramMessage } from './TelegramHelper';
import { retry } from './Utils';

export async function SendNotifications(sender: string, title: string, msg: string) {
  const tgPromise = retry(SendTelegramMessage, [`[${sender}] ${title}\n${msg}`]);
  const discordPromise = retry(SendDiscordMessage, [sender, title, msg]);

  await Promise.all([tgPromise, discordPromise]);
}
