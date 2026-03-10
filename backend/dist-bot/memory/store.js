const toVerbosityText = (verbosity) => {
    if (verbosity === "CONCISE")
        return "concise";
    if (verbosity === "DETAILED")
        return "detailed";
    return "normal";
};
const fromVerbosityText = (verbosity) => {
    const normalized = verbosity.trim().toLowerCase();
    if (normalized === "concise")
        return "CONCISE";
    if (normalized === "detailed")
        return "DETAILED";
    return "NORMAL";
};
export class MemoryStore {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getOrCreateChat(telegramChatId) {
        const chat = await this.prisma.chat.upsert({
            where: { telegramChatId },
            update: {},
            create: {
                telegramChatId,
                currentModel: "auto",
                temperature: 0.4,
                verbosity: "NORMAL",
            },
        });
        return {
            id: chat.id,
            telegramChatId: chat.telegramChatId,
            currentModel: chat.currentModel,
            temperature: chat.temperature,
            verbosity: toVerbosityText(chat.verbosity),
            stylePrompt: chat.stylePrompt,
            summaryText: chat.summaryText,
            summaryMessageCount: chat.summaryMessageCount,
        };
    }
    async refreshChat(chatId) {
        const chat = await this.prisma.chat.findUnique({
            where: { id: chatId },
        });
        if (!chat)
            return null;
        return {
            id: chat.id,
            telegramChatId: chat.telegramChatId,
            currentModel: chat.currentModel,
            temperature: chat.temperature,
            verbosity: toVerbosityText(chat.verbosity),
            stylePrompt: chat.stylePrompt,
            summaryText: chat.summaryText,
            summaryMessageCount: chat.summaryMessageCount,
        };
    }
    async appendMessage(chatId, input) {
        await this.prisma.message.create({
            data: {
                chatId,
                role: input.role,
                content: input.content,
                name: input.name,
                toolCallId: input.toolCallId,
            },
        });
    }
    async getRecentMessages(chatId, limit) {
        const latest = await this.prisma.message.findMany({
            where: { chatId },
            orderBy: { createdAt: "desc" },
            take: Math.max(limit, 1),
        });
        const messages = latest.reverse();
        return messages.map((message) => ({
            role: message.role === "SYSTEM"
                ? "system"
                : message.role === "USER"
                    ? "user"
                    : message.role === "ASSISTANT"
                        ? "assistant"
                        : "tool",
            content: message.content,
            name: message.name ?? undefined,
            tool_call_id: message.toolCallId ?? undefined,
        }));
    }
    async getAllMessages(chatId) {
        const records = await this.prisma.message.findMany({
            where: { chatId },
            orderBy: { createdAt: "asc" },
        });
        return records.map((record) => ({
            id: record.id,
            role: record.role,
            content: record.content,
            name: record.name,
            toolCallId: record.toolCallId,
            createdAt: record.createdAt,
        }));
    }
    async clearChat(chatId) {
        await this.prisma.$transaction([
            this.prisma.message.deleteMany({ where: { chatId } }),
            this.prisma.memory.deleteMany({ where: { chatId } }),
            this.prisma.chat.update({
                where: { id: chatId },
                data: {
                    summaryText: null,
                    summaryMessageCount: 0,
                },
            }),
        ]);
    }
    async getMemories(chatId) {
        const memories = await this.prisma.memory.findMany({
            where: { chatId },
            orderBy: { updatedAt: "desc" },
            take: 24,
        });
        return memories.map((memory) => ({ key: memory.key, value: memory.value }));
    }
    async upsertMemory(chatId, key, value) {
        await this.prisma.memory.upsert({
            where: {
                chatId_key: {
                    chatId,
                    key,
                },
            },
            update: {
                value,
            },
            create: {
                chatId,
                key,
                value,
            },
        });
    }
    async updateSummary(chatId, summaryText, summaryMessageCount) {
        await this.prisma.chat.update({
            where: { id: chatId },
            data: {
                summaryText,
                summaryMessageCount,
            },
        });
    }
    async updateSettings(chatId, settings) {
        const updated = await this.prisma.chat.update({
            where: { id: chatId },
            data: {
                currentModel: settings.currentModel,
                temperature: settings.temperature,
                verbosity: settings.verbosity
                    ? fromVerbosityText(settings.verbosity)
                    : undefined,
                stylePrompt: settings.stylePrompt === undefined ? undefined : settings.stylePrompt,
            },
        });
        return {
            id: updated.id,
            telegramChatId: updated.telegramChatId,
            currentModel: updated.currentModel,
            temperature: updated.temperature,
            verbosity: toVerbosityText(updated.verbosity),
            stylePrompt: updated.stylePrompt,
            summaryText: updated.summaryText,
            summaryMessageCount: updated.summaryMessageCount,
        };
    }
    async exportConversation(chatId) {
        const [chat, memories, messages] = await Promise.all([
            this.prisma.chat.findUnique({ where: { id: chatId } }),
            this.prisma.memory.findMany({
                where: { chatId },
                orderBy: { updatedAt: "asc" },
            }),
            this.prisma.message.findMany({
                where: { chatId },
                orderBy: { createdAt: "asc" },
            }),
        ]);
        return {
            chat: chat
                ? {
                    id: chat.id,
                    telegramChatId: chat.telegramChatId,
                    currentModel: chat.currentModel,
                    temperature: chat.temperature,
                    verbosity: toVerbosityText(chat.verbosity),
                    stylePrompt: chat.stylePrompt,
                    summaryText: chat.summaryText,
                    summaryMessageCount: chat.summaryMessageCount,
                }
                : null,
            memories: memories.map((memory) => ({
                key: memory.key,
                value: memory.value,
                updatedAt: memory.updatedAt,
            })),
            messages: messages.map((message) => ({
                role: message.role.toLowerCase(),
                name: message.name,
                content: message.content,
                createdAt: message.createdAt,
            })),
        };
    }
}
