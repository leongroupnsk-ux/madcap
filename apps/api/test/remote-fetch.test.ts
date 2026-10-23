import { afterEach, describe, expect, it } from 'vitest';
import { fetchRemote, isPrivate, remoteFetchOptions, RemoteFetchError } from '../src/products/remote-fetch';

describe('SSRF: загрузка по ссылкам поставщика', () => {
  afterEach(() => {
    remoteFetchOptions.allowPrivate = true;
  });

  it('распознаёт внутренние и служебные адреса, в том числе IPv4 внутри IPv6', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '198.18.0.1', '192.0.0.8', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::127.0.0.1', '64:ff9b::a9fe:a9fe', '::ffff:7f00:1', '2002:7f00:1::']) {
      expect(isPrivate(ip), ip).toBe(true);
    }
    for (const ip of ['77.88.55.88', '5.255.255.70', '2a02:6b8::2:242']) expect(isPrivate(ip), ip).toBe(false);
  });

  it('запрос во внутреннюю сеть отклоняется', async () => {
    remoteFetchOptions.allowPrivate = false;
    await expect(fetchRemote('http://localhost:9/feed.xml', 1024, /xml/)).rejects.toBeInstanceOf(RemoteFetchError);
    await expect(fetchRemote('http://169.254.169.254/latest/meta-data', 1024, /.*/)).rejects.toThrow(/внутренней сети/);
    await expect(fetchRemote('file:///etc/passwd', 1024, /.*/)).rejects.toThrow(/http/);
  });
});
