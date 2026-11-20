/**
 * Meilleur niveau qu'un ordre de la maison atteint tout de suite, parmi `levels` rangés du mieux au moins
 * bien placé : le premier où attend autre chose que ses propres ordres, au prix du niveau, pour la quantité
 * des autres maisons (5.3 : une maison n'échange pas avec elle-même). `null` : rien à atteindre.
 */
export function bestOpposite(
  levels: readonly { price: number; quantity: number }[],
  own: readonly { price: number; remaining: number }[],
): { price: number; quantity: number } | null {
  for (const level of levels) {
    const mine = own
      .filter((order) => order.price === level.price)
      .reduce((sum, order) => sum + order.remaining, 0);
    if (level.quantity > mine) return { price: level.price, quantity: level.quantity - mine };
  }
  return null;
}
