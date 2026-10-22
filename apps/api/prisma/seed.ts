/**
 * Справочники из прототипа Figma. Идемпотентно: повторный запуск обновляет, а не дублирует.
 * Списки подспециальностей — стартовые, правятся в админке (E1-10).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[ё]/g, 'е')
    .replace(/[а-я]/g, (c) => 'a b v g d e zh z i y k l m n o p r s t u f h ts ch sh sch  y  e yu ya'.split(' ')['абвгдежзийклмнопрстуфхцчшщъыьэюя'.indexOf(c)] ?? '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const CATEGORIES: { name: string; slot: string | null; children?: string[] }[] = [
  { name: 'Костюмы', slot: null },
  { name: 'Халаты', slot: 'gown' },
  { name: 'Топы', slot: 'top', children: ['Футболки', 'Толстовки', 'Жилеты'] },
  { name: 'Брюки', slot: 'pants', children: ['Юбки', 'Платья / Сарафаны'] },
  { name: 'Обувь', slot: 'shoes', children: ['Кроксы'] },
  { name: 'Головные уборы', slot: 'accessory' },
  { name: 'Аксессуары', slot: 'accessory' },
];

const COLORS: [string, string, string][] = [
  ['Графит', '#4A4F52', 'neutral-dark'],
  ['Тёмно-синий', '#1F2A4D', 'blue'],
  ['Шалфей', '#9CAF88', 'green'],
  ['Терракота', '#C8553D', 'warm'],
  ['Молочный', '#F2EEE3', 'neutral-light'],
  ['Белый', '#FFFFFF', 'neutral-light'],
  ['Бирюзовый', '#2A9D8F', 'teal'],
  ['Лаванда', '#A99BD4', 'purple'],
  ['Оливковый', '#6B7A3A', 'green'],
  ['Персиковый', '#F2B49B', 'warm'],
  ['Голубой', '#6FA8DC', 'blue'],
  ['Мятный', '#A8DCC1', 'teal'],
  ['Серый', '#8E9494', 'neutral-dark'],
];

const SPECIALTIES: Record<string, string[]> = {
  Хирургия: ['Хирург', 'Анестезиолог', 'Операционная медсестра'],
  Терапия: ['Терапевт', 'Кардиолог', 'Невролог', 'Медсестра'],
  Педиатрия: ['Педиатр', 'Неонатолог', 'Детская медсестра'],
  'Эстетическая медицина': ['Косметолог', 'Дерматолог'],
  Руководство: ['Главный врач', 'Заведующий отделением', 'Старшая медсестра'],
  Вспомогательные: ['Администратор клиники', 'Санитар'],
  Диагностика: ['Врач УЗИ', 'Рентгенолог', 'Лаборант'],
  Стоматология: ['Стоматолог-терапевт', 'Стоматолог-хирург', 'Ортодонт', 'Ассистент'],
  'Наука и образование': ['Преподаватель', 'Научный сотрудник'],
};

async function main() {
  let pos = 0;
  for (const c of CATEGORIES) {
    const parent = await prisma.category.upsert({
      where: { slug: slug(c.name) },
      update: { name: c.name, slot: c.slot, position: pos },
      create: { name: c.name, slug: slug(c.name), slot: c.slot, position: pos },
    });
    pos += 1;
    for (const [i, child] of (c.children ?? []).entries()) {
      await prisma.category.upsert({
        where: { slug: slug(child) },
        update: { name: child, parentId: parent.id, slot: c.slot, position: i },
        create: { name: child, slug: slug(child), parentId: parent.id, slot: c.slot, position: i },
      });
    }
  }

  for (const [name, hex, colorFamily] of COLORS) {
    await prisma.color.upsert({ where: { name }, update: { hex, colorFamily }, create: { name, hex, colorFamily } });
  }

  let g = 0;
  for (const [groupName, names] of Object.entries(SPECIALTIES)) {
    const group = await prisma.specialtyGroup.upsert({
      where: { name: groupName },
      update: { position: g },
      create: { name: groupName, position: g },
    });
    g += 1;
    for (const [i, name] of names.entries()) {
      await prisma.specialty.upsert({
        where: { slug: slug(name) },
        update: { name, groupId: group.id, position: i },
        create: { name, slug: slug(name), groupId: group.id, position: i },
      });
    }
  }

  const counts = await Promise.all([prisma.category.count(), prisma.color.count(), prisma.specialty.count()]);
  console.log(`Категорий: ${counts[0]}, цветов: ${counts[1]}, специальностей: ${counts[2]}`);
}

main().finally(() => prisma.$disconnect());
