import type { Db } from '../db.ts';

const round2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);

/** games.rating_avg / reviews_count from the reviews table (run inside the review's transaction). */
export async function recomputeGameRating(tx: Db, gameId: string) {
  const agg = await tx.review.aggregate({ where: { gameId }, _avg: { rating: true }, _count: { _all: true } });
  await tx.game.update({
    where: { id: gameId },
    data: { ratingAvg: round2(agg._avg.rating), reviewsCount: agg._count._all },
  });
}

/** users.rating_avg / rating_count: every review received on any of the user's games. */
export async function recomputeOwnerRating(tx: Db, ownerId: string) {
  const agg = await tx.review.aggregate({
    where: { game: { ownerId } },
    _avg: { rating: true },
    _count: { _all: true },
  });
  await tx.user.update({
    where: { id: ownerId },
    data: { ratingAvg: round2(agg._avg.rating), ratingCount: agg._count._all },
  });
}

export async function recomputeGamesCount(tx: Db, ownerId: string) {
  const gamesCount = await tx.game.count({ where: { ownerId, status: 'published' } });
  await tx.user.update({ where: { id: ownerId }, data: { gamesCount } });
}

/** Both rating rollups in one go. */
export async function recomputeRatings(tx: Db, gameId: string, ownerId: string) {
  await recomputeGameRating(tx, gameId);
  await recomputeOwnerRating(tx, ownerId);
}
