const compactUnits = [
  { value: 1_000_000_000, suffix: "B" },
  { value: 1_000_000, suffix: "M" },
  { value: 1_000, suffix: "K" },
];

export const formatCount = (value) => {
  const count = Number(value || 0);

  if (!Number.isFinite(count)) {
    return "0";
  }

  const sign = count < 0 ? "-" : "";
  const absolute = Math.abs(Math.trunc(count));

  if (absolute < 1000) {
    return `${sign}${absolute}`;
  }

  const unit = compactUnits.find((item) => absolute >= item.value);
  const compactValue = absolute / unit.value;
  const decimalPlaces = compactValue < 100 ? 1 : 0;
  const truncatedValue =
    decimalPlaces === 1
      ? Math.floor(compactValue * 10) / 10
      : Math.floor(compactValue);
  const formatted = truncatedValue
    .toFixed(decimalPlaces)
    .replace(/\.0$/, "");

  return `${sign}${formatted}${unit.suffix}`;
};
