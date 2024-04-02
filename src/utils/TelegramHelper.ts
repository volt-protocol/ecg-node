import { sleep } from './Utils';
import { Log } from './Logger';
import { HttpPost } from './HttpHelper';
import axios from 'axios';

let lastTGCall = Date.now();
type TGBody = {
  chat_id: string;
  text: string;
  parse_mode?: string;
};
async function CallTelegram(botId: string, chatId: string, msg: string, isMarkdown = false) {
  const body: TGBody = {
    chat_id: chatId,
    text: msg
  };

  if (isMarkdown) {
    body.parse_mode = 'MarkdownV2';
  }

  const url = `https://api.telegram.org/bot${botId}/sendMessage`;
  const config = {
    headers: {
      'Content-type': 'application/json',
      Accept: 'text/plain'
    }
  };
  const timeToWait = 3000 - (Date.now() - lastTGCall);
  if (timeToWait > 0) {
    Log(`SendTelegramMessage: waiting ${timeToWait} ms before calling telegram`);
    await sleep(timeToWait);
  }
  let mustReCall = true;
  while (mustReCall) {
    mustReCall = false;

    try {
      await HttpPost(url, body, config);
      Log('Message sent to telegram with success');
      lastTGCall = Date.now();
    } catch (err) {
      if (axios.isAxiosError(err) && err.response) {
        // Log(err.response?.data)
        if (!err?.response) {
          Log('SendTelegramMessage: No Server Response', err);
          throw err;
        } else if (err.response?.status === 429) {
          Log('SendTelegramMessage: rate limited, sleeping 5 sec', err);
          await sleep(5000);
          mustReCall = true;
        } else {
          Log('SendTelegramMessage: Unknown error', err);
        }
      } else throw err;
    }
  }
}

export async function SendTelegramMessage(botId: string, chatId: string, msg: string, isMarkdown = false) {
  await CallTelegram(botId, chatId, msg, isMarkdown);
}
