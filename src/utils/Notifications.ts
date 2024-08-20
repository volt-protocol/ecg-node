import { MARKET_ID, NETWORK } from './Constants';
import { SendDiscordMessage, SendDiscordMessageList } from './DiscordHelper';
import { SendTelegramMessage } from './TelegramHelper';
import { retry } from './Utils';
import os from 'os';

function getFormattedSender(sender: string) {
  const marketId = process.env.MARKET_ID;
  const marketName = process.env.MARKET_NAME;
  let formattedSender = sender;
  if (marketName) {
    formattedSender = `${os.hostname()} | ${NETWORK} | MARKET ${marketName} | ${sender}`;
  } else if (marketId) {
    formattedSender = `${os.hostname()} | ${NETWORK} | MARKET ${MARKET_ID} | ${sender}`;
  } else {
    formattedSender = `${os.hostname()} | ${NETWORK} | ${sender}`;
  }

  return formattedSender;
}

export async function SendNotifications(sender: string, title: string, msg: string, isWatcher = false) {
  let tgBotId = undefined;
  let tgChatId = undefined;
  let discordHookUrl = undefined;

  if (isWatcher) {
    tgBotId = process.env.WATCHER_TG_BOT_ID;
    tgChatId = process.env.WATCHER_TG_CHAT_ID;
    discordHookUrl = process.env.WATCHER_DISCORD_WEBHOOK_URL;
  } else {
    tgBotId = process.env.TG_BOT_ID;
    tgChatId = process.env.TG_CHAT_ID;
    discordHookUrl = process.env.DISCORD_WEBHOOK_URL;
  }

  sender = getFormattedSender(sender);
  // both channels
  if (tgBotId && tgChatId && discordHookUrl) {
    await Promise.all([
      retry(SendTelegramMessage, [tgBotId, tgChatId, `[${sender}] ${title}\n${msg}`]),
      retry(SendDiscordMessage, [discordHookUrl, sender, title, msg])
    ]);
  }
  // only tg
  else if (tgBotId && tgChatId) {
    await retry(SendTelegramMessage, [tgBotId, tgChatId, `[${sender}] ${title}\n${msg}`]);
  }
  // only discord
  else if (discordHookUrl) {
    await retry(SendDiscordMessage, [discordHookUrl, sender, title, msg]);
  }
}

export async function SendNotificationsList(
  sender: string,
  title: string,
  fields: { fieldName: string; fieldValue: string }[],
  isWatcher = false
) {
  let tgBotId = undefined;
  let tgChatId = undefined;
  let discordHookUrl = undefined;
  sender = getFormattedSender(sender);

  if (isWatcher) {
    tgBotId = process.env.WATCHER_TG_BOT_ID;
    tgChatId = process.env.WATCHER_TG_CHAT_ID;
    discordHookUrl = process.env.WATCHER_DISCORD_WEBHOOK_URL;
  } else {
    tgBotId = process.env.TG_BOT_ID;
    tgChatId = process.env.TG_CHAT_ID;
    discordHookUrl = process.env.DISCORD_WEBHOOK_URL;
  }

  let tgMsg = '';
  for (const field of fields) {
    tgMsg += `${field.fieldName}: ${field.fieldValue}\n`;
  }
  let tgPromise = Promise.resolve();
  let discordPromise = Promise.resolve();
  if (tgBotId && tgChatId) {
    tgPromise = retry(SendTelegramMessage, [tgBotId, tgChatId, `[${sender}] ${title}\n${tgMsg}`]);
  }

  if (discordHookUrl) {
    discordPromise = retry(SendDiscordMessageList, [discordHookUrl, sender, title, fields]);
  }

  await Promise.all([tgPromise, discordPromise]);
}

export async function SendNotificationsSpam(
  sender: string,
  title: string,
  fields: { fieldName: string; fieldValue: string }[]
) {
  const discordHookUrl = process.env.DISCORD_SPAM_HOOK;

  if (discordHookUrl) {
    await retry(SendDiscordMessageList, [discordHookUrl, sender, title, fields]);
  }
}
