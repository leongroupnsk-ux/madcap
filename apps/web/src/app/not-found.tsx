import ShopLayout from './(shop)/layout';
import NotFound from './(shop)/not-found';

/** Неизвестный адрес — та же страница 404, что в магазине, с шапкой и подвалом */
export default function RootNotFound() {
  return (
    <ShopLayout>
      <NotFound />
    </ShopLayout>
  );
}
