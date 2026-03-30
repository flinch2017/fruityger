import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import "../css/SettingsFlow.css";
import { persistAuthSession } from "../utils/authSession";

export default function ConfirmEmailChange() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("Confirming your new email...");

  useEffect(() => {
    const confirmEmail = async () => {
      const token = searchParams.get("token");

      if (!token) {
        setStatus("error");
        setMessage("This confirmation link is missing a token.");
        return;
      }

      try {
        const res = await fetch("http://localhost:5000/api/auth/confirm-email-change", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ token }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          setStatus("error");
          setMessage(data.error || "This confirmation link is invalid or expired.");
          return;
        }

        persistAuthSession({ user: data.user });
        setStatus("success");
        setMessage("Your email was updated successfully.");
      } catch (error) {
        console.error(error);
        setStatus("error");
        setMessage("We couldn't confirm your email change.");
      }
    };

    confirmEmail();
  }, [searchParams]);

  return (
    <div className="settings-flow-page">
      <div className="settings-flow-card">
        <p className="settings-flow-kicker">Email Confirmation</p>
        <h1>{status === "success" ? "Email changed" : status === "error" ? "Link issue" : "Working on it"}</h1>
        <p className="settings-flow-subtitle">{message}</p>

        <button
          type="button"
          className="settings-flow-primary"
          onClick={() => navigate(status === "success" ? "/settings" : "/login", { replace: true })}
        >
          {status === "success" ? "Back to settings" : "Go to login"}
        </button>
      </div>
    </div>
  );
}
