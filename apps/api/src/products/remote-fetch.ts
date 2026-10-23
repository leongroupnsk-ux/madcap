import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';
import { Agent, fetch } from 'undici';

/** Частные, служебные, документационные и локальные диапазоны — запросы туда запрещены (защита от SSRF, ТЗ §10). */
export function isPrivate(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff')) return true;
    // IPv4 внутри IPv6: ::ffff:a.b.c.d, ::a.b.c.d, NAT64 64:ff9b::a.b.c.d
    const embedded = v.match(/^(?:::ffff:|::|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
    if (embedded) return isPrivate(embedded[1]);
    // Те же адреса в шестнадцатеричной записи (::ffff:7f00:1) и 6to4 (2002::/16) — запрещаем целиком
    if (/^(::ffff:|64:ff9b::|::)[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(v) || v.startsWith('2002:')) return true;
    return false;
  }
  const [a, b, c] = ip.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) || a >= 224
  );
}

/**
 * Проверка адреса в момент соединения: undici соединяется ровно с тем IP, который мы проверили,
 * поэтому подмена DNS между проверкой и запросом (DNS rebinding) не срабатывает.
 */
const safeLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const list = addresses as LookupAddress[];
    if (!remoteFetchOptions.allowPrivate && (!list.length || list.some((x) => isPrivate(x.address)))) {
      return callback(Object.assign(new Error('private address'), { code: 'EPRIVATE' }), '', 0);
    }
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};
const dispatcher = new Agent({ connect: { lookup: safeLookup }, connections: 8 });

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
      const res = await fetch(parsed, { redirect: 'manual', signal: ctrl.signal, dispatcher, headers: { 'User-Agent': 'aesculap-importer/1.0' } });
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
      if ((e as { cause?: { code?: string } })?.cause?.code === 'EPRIVATE') throw new RemoteFetchError('адрес во внутренней сети запрещён');
      throw new RemoteFetchError(ctrl.signal.aborted ? 'превышено время ожидания' : 'не удалось скачать');
    } finally {
      clearTimeout(timer);
    }
  }
  throw new RemoteFetchError('слишком много перенаправлений');
}
