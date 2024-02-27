import axios from 'axios';
import { sleep } from './Utils';

let lastTGCall = Date.now();
type TGBody = {
  chat_id: string;
  text: string;
  parse_mode?: string;
};
async function CallTelegram(msg: string, isMarkdown = false) {
  const TG_BOT_ID: string | undefined = process.env.TG_BOT_ID;
  const TG_CHAT_ID: string | undefined = process.env.TG_CHAT_ID;
  if (!TG_CHAT_ID || !TG_BOT_ID) {
    return;
  }
  const body: TGBody = {
    chat_id: TG_CHAT_ID,
    text: msg
  };

  if (isMarkdown) {
    body.parse_mode = 'MarkdownV2';
  }

  const url = `https://api.telegram.org/bot${TG_BOT_ID}/sendMessage`;
  const config = {
    headers: {
      'Content-type': 'application/json',
      Accept: 'text/plain'
    }
  };
  const timeToWait = 3000 - (Date.now() - lastTGCall);
  if (timeToWait > 0) {
    console.log(`SendTelegramMessage: waiting ${timeToWait} ms before calling telegram`);
    await sleep(timeToWait);
  }
  let mustReCall = true;
  while (mustReCall) {
    mustReCall = false;

    try {
      await axios.post(url, body, config);
      console.log('Message sent to telegram with success');
      lastTGCall = Date.now();
    } catch (err) {
      if (axios.isAxiosError(err) && err.response) {
        // console.log(err.response?.data)
        if (!err?.response) {
          console.log('SendTelegramMessage: No Server Response', err);
          throw err;
        } else if (err.response?.status === 429) {
          console.log('SendTelegramMessage: rate limited, sleeping 5 sec', err);
          await sleep(5000);
          mustReCall = true;
        } else {
          console.log('SendTelegramMessage: Unknown error', err);
        }
      } else throw err;
    }
  }
}

export async function SendTelegramMessage(msg: string, isMarkdown = false) {
  await CallTelegram(msg, isMarkdown);
}
