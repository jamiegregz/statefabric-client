export function setOptionalSearchParam(
  url: URL,
  name: string,
  value: string | number | undefined,
) {
  if (value !== undefined) {
    url.searchParams.set(name, String(value));
  }
}
