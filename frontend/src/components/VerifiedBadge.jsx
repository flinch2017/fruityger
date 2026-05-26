import { FaCheck } from "react-icons/fa";

export default function VerifiedBadge({ verified }) {
  if (!verified) return null;

  return (
    <span className="verified-badge" title="Verified" aria-label="Verified">
      <FaCheck />
    </span>
  );
}
