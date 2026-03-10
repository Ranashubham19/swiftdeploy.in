import { randomUUID } from "node:crypto";
const sleep = async (ms) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
};
export class DbLockManager {
    prisma;
    ttlMs;
    retryDelayMs;
    maxWaitMs;
    constructor(prisma, options) {
        this.prisma = prisma;
        this.ttlMs = options?.ttlMs ?? 30_000;
        this.retryDelayMs = options?.retryDelayMs ?? 180;
        this.maxWaitMs = options?.maxWaitMs ?? 20_000;
    }
    async withChatLock(chatId, task) {
        const owner = randomUUID();
        await this.acquire(chatId, owner);
        try {
            return await task();
        }
        finally {
            await this.release(chatId, owner);
        }
    }
    async acquire(chatId, owner) {
        const started = Date.now();
        while (Date.now() - started < this.maxWaitMs) {
            const now = new Date();
            const expiresAt = new Date(now.getTime() + this.ttlMs);
            try {
                await this.prisma.chatLock.create({
                    data: {
                        chatId,
                        owner,
                        expiresAt,
                    },
                });
                return;
            }
            catch {
                const updated = await this.prisma.chatLock.updateMany({
                    where: {
                        chatId,
                        expiresAt: {
                            lte: now,
                        },
                    },
                    data: {
                        owner,
                        expiresAt,
                    },
                });
                if (updated.count > 0) {
                    return;
                }
            }
            await sleep(this.retryDelayMs);
        }
        throw new Error(`Could not acquire chat lock for chat=${chatId} within ${this.maxWaitMs}ms`);
    }
    async release(chatId, owner) {
        await this.prisma.chatLock.deleteMany({
            where: {
                chatId,
                owner,
            },
        });
    }
}
