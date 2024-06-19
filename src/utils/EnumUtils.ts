export function enumFromStringValue<T>(enm: { [s: string]: T }, value: string | undefined): T {
  if (!value) {
    throw new Error(`Cannot find enum value for empty value ${value}`);
  }
  const enumValue = (Object.values(enm) as unknown as string[]).includes(value) ? (value as unknown as T) : undefined;
  if (enumValue == undefined) {
    throw new Error(`Cannot find enum value for value ${value}`);
  } else {
    return enumValue;
  }
}
