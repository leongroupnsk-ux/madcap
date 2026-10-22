/** Адреса, с которых ЮKassa шлёт уведомления (документация ЮKassa, раздел «Входящие уведомления»). */
const V4 = ['185.71.76.0/27', '185.71.77.0/27', '77.75.153.0/25', '77.75.156.11/32', '77.75.156.35/32', '77.75.154.128/25'];

const toInt = (ip: string) => ip.split('.').reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;

export function fromYooKassa(raw: string): boolean {
  const ip = raw.replace(/^::ffff:/, '');
  if (ip.toLowerCase().startsWith('2a02:5180:')) return true;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
  const n = toInt(ip);
  return V4.some((cidr) => {
    const [base, bits] = cidr.split('/');
    const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
    return (n & mask) === (toInt(base) & mask);
  });
}
