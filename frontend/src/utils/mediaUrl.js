const normalizePathSegment = (segment) => {
  try {
    return encodeURIComponent(decodeURIComponent(segment));
  } catch {
    return encodeURIComponent(segment);
  }
};

export const getSafeMediaUrl = (value) => {
  if (!value || typeof value !== "string") {
    return value || "";
  }

  if (value.startsWith("blob:") || value.startsWith("data:")) {
    return value;
  }

  try {
    const parsed = new URL(value);
    parsed.pathname = parsed.pathname
      .split("/")
      .map((segment) => normalizePathSegment(segment))
      .join("/")
      .replace(/%2F/g, "/");

    return parsed.toString();
  } catch {
    return value;
  }
};
