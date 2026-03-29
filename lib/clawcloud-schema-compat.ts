function normalizeSchemaMessage(message: string) {
  return message.trim().toLowerCase();
}

export function isClawCloudMissingSchemaMessage(message: string) {
  const normalized = normalizeSchemaMessage(message);

  return (
    normalized.includes("could not find the table")
    || normalized.includes("could not find the column")
    || normalized.includes("not found in the schema cache")
    || normalized.includes("does not have the column")
    || (normalized.includes("relation") && normalized.includes("does not exist"))
    || (normalized.includes("table") && normalized.includes("does not exist"))
    || (normalized.includes("column") && normalized.includes("does not exist"))
    || normalized.includes("schema cache")
  );
}

export function isClawCloudMissingSchemaColumn(message: string, columnName: string) {
  const normalized = normalizeSchemaMessage(message);
  const normalizedColumn = columnName.trim().toLowerCase();

  if (!normalizedColumn) {
    return false;
  }

  return (
    isClawCloudMissingSchemaMessage(normalized)
    && normalized.includes("column")
    && normalized.includes(normalizedColumn)
  );
}
