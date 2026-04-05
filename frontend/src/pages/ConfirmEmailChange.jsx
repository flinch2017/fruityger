import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import "../css/SettingsFlow.css";
import { persistAuthSession } from "../utils/authSession";

export default function ConfirmEmailChange() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = localStorage.getItem("token");
  const pendingEmail = localStorage.getItem("pendingEmail") || "";
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("Checking your confirmation flow...");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const confirmEmail = async () => {
      const linkToken = searchParams.get("token");

      if (!linkToken) {
        setStatus("idle");
        setMessage("Enter the 6-digit code we sent to your new email address.");
        return;
      }

      try {
        const res = await fetch("http://localhost:5000/api/auth/confirm-email-change", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ token: linkToken }),
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

  const handleCodeSubmit = async (event) => {
    event.preventDefault();

    if (!token) {
      navigate("/login", { replace: true });
      return;
    }

    if (!/^\d{6}$/.test(code.trim())) {
      setStatus("error");
      setMessage("Please enter a valid 6-digit code.");
      return;
    }

    setSubmitting(true);
    setStatus("loading");
    setMessage("Confirming your new email...");

    try {
      const res = await fetch("http://localhost:5000/api/auth/confirm-email-change-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code: code.trim() }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setStatus("error");
        setMessage(data.error || "That confirmation code is invalid or expired.");
        return;
      }

      persistAuthSession({ user: data.user });
      setStatus("success");
      setMessage("Your email was updated successfully.");
    } catch (error) {
      console.error(error);
      setStatus("error");
      setMessage("We couldn't confirm your email change.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="settings-flow-page">
      <div className="settings-flow-card">
        <p className="settings-flow-kicker">Email Confirmation</p>
        <h1>
          {status === "success"
            ? "Email changed"
            : status === "error"
              ? "Confirmation issue"
              : status === "idle"
                ? "Enter your code"
                : "Working on it"}
        </h1>
        <p className="settings-flow-subtitle">
          {status === "idle" && pendingEmail ? `Code sent to ${pendingEmail}. ` : ""}
          {message}
        </p>

        {status === "idle" ? (
          <form className="settings-flow-form" onSubmit={handleCodeSubmit}>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              className="settings-flow-input settings-flow-code"
              placeholder="6-digit code"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            />

            <button type="submit" className="settings-flow-primary" disabled={submitting}>
              {submitting ? "Confirming..." : "Confirm email change"}
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="settings-flow-primary"
            onClick={() => navigate(status === "success" ? "/settings" : "/login", { replace: true })}
          >
            {status === "success" ? "Back to settings" : "Go to login"}
          </button>
        )}
      </div>
    </div>
  );
}
