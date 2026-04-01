import "../css/AeroNotice.css";

export default function AeroNotice({ notice, onClose }) {
  if (!notice?.message) return null;

  const type = notice.type || "info";
  const titleMap = {
    success: "All set",
    error: "Something went wrong",
    info: "Heads up",
  };

  return (
    <div className={`aero-notice ${notice.inline ? "inline" : ""} ${type}`}>
      <div className="aero-notice-bubble aero-notice-bubble-a" aria-hidden="true"></div>
      <div className="aero-notice-bubble aero-notice-bubble-b" aria-hidden="true"></div>
      <div className="aero-notice-glyph" aria-hidden="true">
        {type === "success" ? "OK" : type === "error" ? "!" : "i"}
      </div>
      <div className="aero-notice-copy">
        <strong>{notice.title || titleMap[type] || titleMap.info}</strong>
        <p>{notice.message}</p>
      </div>
      <button type="button" className="aero-notice-close" onClick={onClose} aria-label="Close notice">
        x
      </button>
    </div>
  );
}
