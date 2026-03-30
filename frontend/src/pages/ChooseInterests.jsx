import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../css/ChooseInterests.css";
import { persistAuthSession } from "../utils/authSession";

const INTEREST_OPTIONS = [
  "Food",
  "Music",
  "Games",
  "Sports",
  "Movies",
  "Travel",
  "Fashion",
  "Photography",
  "Art",
  "Tech",
  "Books",
  "Anime",
];

export default function ChooseInterests() {
  const navigate = useNavigate();
  const [selectedInterests, setSelectedInterests] = useState([]);
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.body.classList.add("welcome");
    return () => document.body.classList.remove("welcome");
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadSession = async () => {
      const token = localStorage.getItem("token");

      if (!token) {
        navigate("/login", { replace: true });
        return;
      }

      try {
        const res = await fetch("http://localhost:5000/api/auth/session", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await res.json().catch(() => ({}));

        if (!isMounted) return;

        if (!res.ok) {
          navigate("/login", { replace: true });
          return;
        }

        if (data.user?.email_verified && data.user?.interests_completed) {
          navigate("/feed", { replace: true });
          return;
        }

        setSelectedInterests(Array.isArray(data.user?.interests) ? data.user.interests : []);
        setLoading(false);
      } catch (error) {
        console.error(error);
        if (isMounted) {
          setFeedback({ type: "error", message: "We couldn't load your onboarding details." });
          setLoading(false);
        }
      }
    };

    loadSession();

    return () => {
      isMounted = false;
    };
  }, [navigate]);

  const selectionCountLabel = useMemo(() => {
    if (selectedInterests.length === 1) {
      return "1 glow picked";
    }

    return `${selectedInterests.length} glows picked`;
  }, [selectedInterests.length]);

  const toggleInterest = (interest) => {
    setFeedback({ type: "", message: "" });
    setSelectedInterests((current) =>
      current.includes(interest)
        ? current.filter((item) => item !== interest)
        : [...current, interest]
    );
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFeedback({ type: "", message: "" });

    if (selectedInterests.length === 0) {
      setFeedback({ type: "error", message: "Pick at least one interest to shape your first feed." });
      return;
    }

    const token = localStorage.getItem("token");
    if (!token) {
      navigate("/login", { replace: true });
      return;
    }

    setSaving(true);

    try {
      const res = await fetch("http://localhost:5000/api/main/onboarding/interests", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ interests: selectedInterests }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setFeedback({ type: "error", message: data.error || "Couldn't save your interests." });
        return;
      }

      persistAuthSession({ user: data.user });
      setFeedback({ type: "success", message: "Your vibe is set. Loading your feed..." });
      setTimeout(() => navigate("/feed", { replace: true }), 500);
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: "Couldn't save your interests." });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return null;
  }

  return (
    <div className="interests-page">
      <div className="interests-card">
        <div className="interests-orb interests-orb-left" aria-hidden="true" />
        <div className="interests-orb interests-orb-right" aria-hidden="true" />

        <p className="interests-kicker">Fresh account tuning</p>
        <h2 className="interests-title">Choose your interests</h2>
        <p className="interests-subtitle">
          Pick the scenes you want Fruityger to glow around first.
        </p>

        <div className="interests-selection-count">{selectionCountLabel}</div>

        {feedback.message && (
          <div className={`interests-feedback ${feedback.type}`}>
            {feedback.message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="interests-form">
          <div className="interests-grid">
            {INTEREST_OPTIONS.map((interest) => {
              const isSelected = selectedInterests.includes(interest);

              return (
                <button
                  key={interest}
                  type="button"
                  className={`interest-pill${isSelected ? " selected" : ""}`}
                  onClick={() => toggleInterest(interest)}
                  aria-pressed={isSelected}
                >
                  <span className="interest-pill-gloss" aria-hidden="true" />
                  <span className="interest-pill-label">{interest}</span>
                </button>
              );
            })}
          </div>

          <button type="submit" className="interests-submit-btn" disabled={saving}>
            {saving ? "Saving your vibe..." : "Continue to Feed"}
          </button>
        </form>
      </div>
    </div>
  );
}
