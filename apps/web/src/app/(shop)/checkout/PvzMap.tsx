'use client';

import { useEffect, useRef } from 'react';
import { loadScript } from '@/lib/load-script';
import c from '@/components/shop/checkout.module.css';

export type MapPoint = { code: string; address: string; lat: number; lon: number };

type LngLat = [number, number];
/** Минимум из Яндекс Карт JS API 3.x, который нужен карте ПВЗ */
type YMaps3 = {
  ready: Promise<void>;
  YMap: new (el: HTMLElement, props: { location: { center: LngLat; zoom: number }; margin?: [number, number, number, number] }) => YMapInstance;
  YMapDefaultSchemeLayer: new (props: object) => unknown;
  YMapDefaultFeaturesLayer: new (props: object) => unknown;
  YMapMarker: new (props: { coordinates: LngLat; zIndex?: number }, el: HTMLElement) => unknown;
};
type YMapInstance = {
  addChild(child: unknown): void;
  removeChild(child: unknown): void;
  update(props: { location: { center: LngLat; zoom: number; duration?: number } | { bounds: [LngLat, LngLat]; duration?: number } }): void;
  destroy(): void;
};
declare global {
  interface Window {
    ymaps3?: YMaps3;
  }
}

async function ymapsReady(key: string): Promise<YMaps3> {
  await loadScript(`https://api-maps.yandex.ru/v3/?apikey=${encodeURIComponent(key)}&lang=ru_RU`);
  if (!window.ymaps3) throw new Error('Яндекс Карты не загрузились');
  await window.ymaps3.ready;
  return window.ymaps3;
}

const valid = (p: MapPoint) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && (p.lat !== 0 || p.lon !== 0);

/**
 * Карта ПВЗ на Яндекс Картах 3.x (E4-09). Скрипт грузится лениво — только когда открыто окно выбора ПВЗ
 * и задан ключ. Метки — по координатам СДЭК; клик открывает карточку пункта, выбор в списке центрирует карту.
 * Если карта не загрузилась (сеть, неверный ключ), onFail — окно возвращается к заглушке.
 */
export function PvzMap({
  apiKey,
  points,
  selected,
  onSelect,
  onFail,
}: {
  apiKey: string;
  points: MapPoint[];
  selected: string | null;
  onSelect: (code: string) => void;
  onFail: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<{ y: YMaps3; m: YMapInstance; markers: unknown[]; els: Map<string, HTMLElement> } | null>(null);
  const handlers = useRef({ onSelect, onFail });
  handlers.current = { onSelect, onFail };
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const ready = useRef<(() => void) | null>(null);

  // Создание и уничтожение карты
  useEffect(() => {
    let stop = false;
    ymapsReady(apiKey)
      .then((y) => {
        if (stop || !box.current) return;
        const first = pointsRef.current.find(valid);
        const m = new y.YMap(box.current, { location: { center: first ? [first.lon, first.lat] : [37.62, 55.75], zoom: 11 }, margin: [80, 40, 40, 40] });
        m.addChild(new y.YMapDefaultSchemeLayer({}));
        m.addChild(new y.YMapDefaultFeaturesLayer({}));
        map.current = { y, m, markers: [], els: new Map() };
        ready.current?.();
      })
      .catch(() => !stop && handlers.current.onFail());
    return () => {
      stop = true;
      map.current?.m.destroy();
      map.current = null;
    };
  }, [apiKey]);

  // Метки: перерисовываются при смене города или поиска
  useEffect(() => {
    const draw = () => {
      const cur = map.current;
      if (!cur) return;
      for (const mk of cur.markers) cur.m.removeChild(mk);
      cur.markers = [];
      cur.els.clear();
      const list = points.filter(valid);
      list.forEach((p, i) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = p.code === selectedRef.current ? c.mapMarkerOn : c.mapMarker;
        el.textContent = String(i + 1);
        el.setAttribute('aria-label', p.address);
        el.addEventListener('click', () => handlers.current.onSelect(p.code));
        const mk = new cur.y.YMapMarker({ coordinates: [p.lon, p.lat] }, el);
        cur.m.addChild(mk);
        cur.markers.push(mk);
        cur.els.set(p.code, el);
      });
      const sel = list.find((p) => p.code === selectedRef.current);
      if (sel) {
        cur.m.update({ location: { center: [sel.lon, sel.lat], zoom: 15 } });
      } else if (list.length > 1) {
        const lons = list.map((p) => p.lon);
        const lats = list.map((p) => p.lat);
        cur.m.update({ location: { bounds: [[Math.min(...lons), Math.max(...lats)], [Math.max(...lons), Math.min(...lats)]], duration: 300 } });
      } else if (list.length === 1) {
        cur.m.update({ location: { center: [list[0].lon, list[0].lat], zoom: 14, duration: 300 } });
      }
    };
    if (map.current) draw();
    else ready.current = draw;
  }, [points]);

  // Выбранный пункт: подсветка метки и центрирование
  useEffect(() => {
    const cur = map.current;
    if (!cur) return;
    for (const [code, el] of cur.els) el.className = code === selected ? c.mapMarkerOn : c.mapMarker;
    const p = points.find((x) => x.code === selected);
    if (p && valid(p)) cur.m.update({ location: { center: [p.lon, p.lat], zoom: 15, duration: 300 } });
  }, [selected, points]);

  return <div ref={box} className={c.mapCanvas} />;
}
