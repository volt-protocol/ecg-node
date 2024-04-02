import axios, { AxiosResponse } from 'axios';
import { retry } from './Utils';

export async function HttpGet<T>(url: string, config?: any): Promise<T> {
  const axiosResp: AxiosResponse<T> = (await retry(axios.get, [url, config])) as AxiosResponse<T>;

  return axiosResp.data;
}

export async function HttpPost<T>(url: string, body?: any, config?: any): Promise<T> {
  const axiosResp: AxiosResponse<T> = (await retry(axios.post, [url, body, config])) as AxiosResponse<T>;

  return axiosResp.data;
}
