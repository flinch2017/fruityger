import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaUser } from "react-icons/fa";
import "../css/ForgotPassword.css";
import { getSafeMediaUrl } from "../utils/mediaUrl";
import {
  clearForgotPasswordResetToken,
  setForgotPasswordAccount,
} from "../utils/forgotPasswordSession";

export default function ForgotPasswordSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [submittingId, setSubmittingId] = useState("");
  const [feedback, setFeedback] = useState({ type: "", message: "" });

  useEffect(() => {
    document.body.classList.add("welcome");
    clearForgotPasswordResetToken();
    return () => document.body.classList.remove("welcome");
  }, []);

  const trimmedQuery = useMemo(() => query.trim(), [query]);

  useEffect(() => {
    if (trimmedQuery.length < 2) {
      setResults([]);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch("http://localhost:5000/api/auth/forgot-password/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: trimmedQuery }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Couldn't search accounts.");
        }

        if (!cancelled) {
          setResults(data.accounts || []);
        }
      } catch (error) {
        if (!cancelled) {
          console.error(error);
          setFeedback({ type: "error", message: error.message || "Couldn't search accounts." });
          setResults([]);
        }
      } finally {
        if (!cancelled) {
          setSearching(false);
        }
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [trimmedQuery]);

  const handleChooseAccount = async (account) => {
    setFeedback({ type: "", message: "" });
    setSubmittingId(account.id);

    try {
      const res = await fetch("http://localhost:5000/api/auth/forgot-password/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: account.id }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Couldn't send reset code.");
      }

      setForgotPasswordAccount(data.account || account);
      navigate("/forgot-password/verify", { replace: true });
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: error.message || "Couldn't send reset code." });
    } finally {
      setSubmittingId("");
    }
  };

  return (
    <div className="forgot-password-page">
      <div className="forgot-password-card">
        <p className="forgot-password-kicker">Password Reset</p>
        <h1>Find your account</h1>
        <p className="forgot-password-subtitle">
          Search by username or email, then choose your verified account to receive a 6-digit code.
        </p>

        {feedback.message && (
          <div className={`forgot-password-feedback ${feedback.type}`}>
            {feedback.message}
          </div>
        )}

        <input
          type="text"
          className="forgot-password-input"
          placeholder="Username or email"
          value={query}
          onChange={(event) => {
            setFeedback({ type: "", message: "" });
            setQuery(event.target.value);
          }}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck="false"
        />

        <div className="forgot-password-results">
          {searching && <div className="forgot-password-empty">Searching...</div>}

          {!searching && trimmedQuery.length >= 2 && results.length === 0 && (
            <div className="forgot-password-empty">
              No verified accounts matched that search.
            </div>
          )}

          {!searching &&
            results.map((account) => (
              <button
                key={account.id}
                type="button"
                className="forgot-password-account"
                onClick={() => handleChooseAccount(account)}
                disabled={submittingId === account.id}
              >
                <span className="forgot-password-account-avatar">
                  {account.profile_pic ? (
                    <img src={getSafeMediaUrl(account.profile_pic)} alt={account.username} />
                  ) : (
                    <FaUser />
                  )}
                </span>

                <span className="forgot-password-account-copy">
                  <strong>{account.username}</strong>
                  <span>{account.masked_email}</span>
                </span>

                <span className="forgot-password-account-cta">
                  {submittingId === account.id ? "Sending..." : "Select"}
                </span>
              </button>
            ))}
        </div>

        <button
          type="button"
          className="forgot-password-link"
          onClick={() => navigate("/login")}
        >
          Back to login
        </button>
      </div>
    </div>
  );
}
