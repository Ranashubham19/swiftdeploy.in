export class AppError extends Error {
    statusCode;
    expose;
    constructor(message, statusCode = 500, expose = false) {
        super(message);
        this.name = "AppError";
        this.statusCode = statusCode;
        this.expose = expose;
    }
}
export const isAbortError = (error) => {
    if (error instanceof Error) {
        return (error.name === "AbortError" ||
            error.message.includes("aborted") ||
            error.message.includes("The operation was aborted"));
    }
    return false;
};
export const toErrorMessage = (error) => {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error ?? "Unknown error");
};
