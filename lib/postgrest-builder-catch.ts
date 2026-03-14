import { PostgrestBuilder } from "@supabase/postgrest-js";

type PostgrestBuilderWithCatch = {
  catch?: <TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ) => PromiseLike<unknown>;
};

const builderPrototype = PostgrestBuilder.prototype as PostgrestBuilderWithCatch;

if (typeof builderPrototype.catch !== "function") {
  builderPrototype.catch = function catchPostgrest(
    onrejected?: ((reason: unknown) => unknown) | null,
  ) {
    return Promise.resolve(this).catch(onrejected ?? undefined);
  };
}

export {};
