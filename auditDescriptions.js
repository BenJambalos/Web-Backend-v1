const MAX_AUDIT_VALUE_LENGTH = 300;

function isEmpty(value) {
  return value == null || String(value).trim() === "";
}

function printableValue(value) {
  if (isEmpty(value)) return null;
  const raw = value instanceof Date
    ? value.toISOString()
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
  const clean = raw.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  const limited = clean.length > MAX_AUDIT_VALUE_LENGTH
    ? `${clean.slice(0, MAX_AUDIT_VALUE_LENGTH - 3)}...`
    : clean;
  return JSON.stringify(limited);
}

export function auditValuesEqual(first, second) {
  if (isEmpty(first) || isEmpty(second)) return isEmpty(first) && isEmpty(second);
  if (typeof first === "boolean" || typeof second === "boolean") {
    return Number(first) === Number(second);
  }
  if (typeof first === "number" || typeof second === "number") {
    return Number(first) === Number(second);
  }
  return String(first) === String(second);
}

export function formatAuditChanges(entity, changes) {
  const descriptions = changes
    .filter(({ from, to }) => !auditValuesEqual(from, to))
    .map(({ field, from, to }) => {
      const oldValue = printableValue(from);
      const newValue = printableValue(to);
      if (oldValue == null) return `added ${field} ${newValue}`;
      if (newValue == null) return `cleared ${field} (was ${oldValue})`;
      return `changed ${field} from ${oldValue} to ${newValue}`;
    });

  return descriptions.length > 0 ? `${entity}: ${descriptions.join("; ")}.` : null;
}
