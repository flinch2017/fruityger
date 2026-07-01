export const getDisplayName = (person, fallback = "User") => {
  if (!person) return fallback;

  const accountName = String(person.account_name || "").trim();
  if (accountName) return accountName;

  const username = String(person.username || "").trim();
  return username || fallback;
};

export const getDisplayInitial = (person, fallback = "?") => {
  const label = getDisplayName(person, fallback).trim();
  return label ? label[0].toUpperCase() : fallback;
};
