declare global {
  interface PromiseLike<T> {
    catch<TResult = never>(
      onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | undefined | null,
    ): PromiseLike<T | TResult>;
  }
}

export {};
