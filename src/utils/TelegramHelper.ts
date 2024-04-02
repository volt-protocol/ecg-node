import { sleep } from './Utils';
import { Log } from './Logger';
import ky, { HTTPError } from 'ky';

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
      await ky.post(url, {
        json: body,
        headers: {
          'Content-type': 'application/json',
          Accept: 'text/plain'
        },
        throwHttpErrors: true
      });
      Log('Message sent to telegram with success');
      lastTGCall = Date.now();
    } catch (err) {
      if (err instanceof HTTPError) {
        if (err.response.status == 429) {
          Log('SendTelegramMessage: rate limited, sleeping 5 sec', err);
          await sleep(5000);
          mustReCall = true;
          continue;
        }
      }

      throw err;
    }
  }
}

export async function SendTelegramMessage(botId: string, chatId: string, msg: string, isMarkdown = false) {
  await CallTelegram(botId, chatId, msg, isMarkdown);
}
