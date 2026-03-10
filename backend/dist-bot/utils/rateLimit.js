export class DatabaseRateLimiter {
    prisma;
    maxEvents;
    windowMs;
    constructor(prisma, maxEvents = 20, windowMs = 10 * 60 * 1000) {
        this.prisma = prisma;
        this.maxEvents = maxEvents;
        this.windowMs = windowMs;
    }
    async consume(bucketKey) {
        const now = Date.now();
        const cutoff = new Date(now - this.windowMs);
        const hardCleanupCutoff = new Date(now - this.windowMs * 24);
        const result = await this.prisma.$transaction(async (tx) => {
            const used = await tx.rateLimitEvent.count({
                where: {
                    bucketKey,
                    createdAt: { gte: cutoff },
                },
            });
            if (used >= this.maxEvents) {
                const oldest = await tx.rateLimitEvent.findFirst({
                    where: {
                        bucketKey,
                        createdAt: { gte: cutoff },
                    },
                    orderBy: {
                        createdAt: "asc",
                    },
                });
                return {
                    allowed: false,
                    remaining: 0,
                    resetAt: oldest
                        ? new Date(oldest.createdAt.getTime() + this.windowMs)
                        : new Date(now + this.windowMs),
                };
            }
            await tx.rateLimitEvent.create({
                data: {
                    bucketKey,
                },
            });
            return {
                allowed: true,
                remaining: Math.max(this.maxEvents - (used + 1), 0),
                resetAt: new Date(now + this.windowMs),
            };
        });
        this.prisma.rateLimitEvent
            .deleteMany({
            where: {
                createdAt: {
                    lt: hardCleanupCutoff,
                },
            },
        })
            .catch(() => { });
        return result;
    }
}
