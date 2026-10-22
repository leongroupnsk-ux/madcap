import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Частные, служебные и локальные диапазоны — запросы туда запрещены (защита от SSRF, ТЗ §10). */
function isPrivate(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivate(mapped[1]) : false;
  }
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
  );
}

export class RemoteFetchError extends Error {}

/** Хуки для тестов: разрешить локальный адрес тестового сервера. */
export const remoteFetchOptions = { allowPrivate: process.env.REMOTE_FETCH_ALLOW_PRIVATE === '1' };

/**
 * Скачивает файл по ссылке поставщика: только http(s), без редиректов во внутреннюю сеть,
 * с ограничением размера и времени.
 */
export async function fetchRemote(url: string, maxBytes: number, accept: RegExp, timeoutMs = 15_000): Promise<{ data: Buffer; contentType: string }> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      throw new RemoteFetchError('некорректная ссылка');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new RemoteFetchError('ссылка должна начинаться с http(s)');
    if (!remoteFetchOptions.allowPrivate) {
      const addrs = await lookup(parsed.hostname, { all: true }).catch(() => []);
      if (!addrs.length) throw new RemoteFetchError('сервер не найден');
      if (addrs.some((a) => isPrivate(a.address))) throw new RemoteFetchError('адрес во внутренней сети запрещён');
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(parsed, { redirect: 'manual', signal: ctrl.signal, headers: { 'User-Agent': 'aesculap-importer/1.0' } });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        current = new URL(res.headers.get('location')!, parsed).toString();
        continue;
      }
      if (!res.ok) throw new RemoteFetchError(`сервер ответил ${res.status}`);
      const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim();
      if (!accept.test(contentType)) throw new RemoteFetchError(`неподходящий тип файла (${contentType || 'не указан'})`);
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > maxBytes) throw new RemoteFetchError(`файл больше ${Math.round(maxBytes / 1048576)} МБ`);
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        size += chunk.length;
        if (size > maxBytes) throw new RemoteFetchError(`файл больше ${Math.round(maxBytes / 1048576)} МБ`);
        chunks.push(Buffer.from(chunk));
      }
      return { data: Buffer.concat(chunks), contentType };
    } catch (e) {
      if (e instanceof RemoteFetchError) throw e;
      throw new RemoteFetchError(ctrl.signal.aborted ? 'превышено время ожидания' : 'не удалось скачать');
    } finally {
      clearTimeout(timer);
    }
  }
  throw new RemoteFetchError('слишком много перенаправлений');
}
