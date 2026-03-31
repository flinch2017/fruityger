import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import "../css/ShareProfile.css";

export default function ShareProfile() {
  const { username } = useParams();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  const profileUrl = useMemo(
    () => `${window.location.origin}/profile/${username}`,
    [username]
  );

  const qrCodeUrl = useMemo(
    () =>
      `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(profileUrl)}`,
    [profileUrl]
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(profileUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div className="share-profile-page">
      <div className="share-profile-card">
        <button
          type="button"
          className="share-profile-back"
          onClick={() => navigate(-1)}
        >
          Back
        </button>

        <p className="share-profile-kicker">Share Profile</p>
        <h1>@{username}</h1>
        <p className="share-profile-subtitle">
          This QR code always points to this Fruityger profile.
        </p>

        <div className="share-profile-qr-shell">
          <img src={qrCodeUrl} alt={`QR code for ${username}`} className="share-profile-qr" />
        </div>

        <div className="share-profile-linkbox">
          <span>{profileUrl}</span>
        </div>

        <button type="button" className="share-profile-copy" onClick={handleCopy}>
          {copied ? "Copied!" : "Copy Profile Link"}
        </button>
      </div>
    </div>
  );
}
