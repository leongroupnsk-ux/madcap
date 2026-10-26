/** Ленивая загрузка внешнего скрипта (карты, капча): один раз на страницу, повторные вызовы ждут тот же промис. */
const loading = new Map<string, Promise<void>>();

export function loadScript(src: string): Promise<void> {
  let p = loading.get(src);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => {
        loading.delete(src);
        el.remove();
        reject(new Error(`Не удалось загрузить ${new URL(src).host}`));
      };
      document.head.appendChild(el);
    });
    loading.set(src, p);
  }
  return p;
}
