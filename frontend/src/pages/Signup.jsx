import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import ReCAPTCHA from "react-google-recaptcha";
import "../css/Signup.css";
import { persistAuthSession } from "../utils/authSession";

const getAgeFromBirthDate = (birthDate) => {
  if (!birthDate) return null;

  const today = new Date();
  const dob = new Date(`${birthDate}T00:00:00`);

  if (Number.isNaN(dob.getTime())) return null;

  let age = today.getFullYear() - dob.getFullYear();
  const monthDifference = today.getMonth() - dob.getMonth();

  if (
    monthDifference < 0 ||
    (monthDifference === 0 && today.getDate() < dob.getDate())
  ) {
    age -= 1;
  }

  return age;
};

const getPasswordValidationMessage = (password) => {
  if (!password || password.length < 8) {
    return "Password must be at least 8 characters long.";
  }

  if (!/[A-Z]/.test(password)) {
    return "Password must include at least one uppercase letter.";
  }

  if (!/[a-z]/.test(password)) {
    return "Password must include at least one lowercase letter.";
  }

  if (!/\d/.test(password)) {
    return "Password must include at least one number.";
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    return "Password must include at least one special character.";
  }

  if (/\s/.test(password)) {
    return "Password cannot contain spaces.";
  }

  return "";
};

export default function Signup() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
    birthDate: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [birthDateInputType, setBirthDateInputType] = useState("text");
  const captchaRef = useRef(null);
  const birthDateRef = useRef(null);
  const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;

  useEffect(() => {
    document.body.classList.add("welcome");
    return () => document.body.classList.remove("welcome");
  }, []);

  const setCustomMessage = (type, message) => {
    setFeedback({ type, message });
  };

  const clearMessage = () => {
    setFeedback({ type: "", message: "" });
  };

  const handleChange = (e) => {
    clearMessage();
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const activateBirthDatePicker = () => {
    if (birthDateInputType === "date") return;

    setBirthDateInputType("date");

    requestAnimationFrame(() => {
      if (typeof birthDateRef.current?.showPicker === "function") {
        birthDateRef.current.showPicker();
      } else {
        birthDateRef.current?.focus();
      }
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    clearMessage();

    if (form.password !== form.confirmPassword) {
      setCustomMessage("error", "Passwords do not match.");
      return;
    }

    const passwordValidationMessage = getPasswordValidationMessage(form.password);
    if (passwordValidationMessage) {
      setCustomMessage("error", passwordValidationMessage);
      return;
    }

    if (!form.birthDate) {
      setCustomMessage("error", "Please enter your birthday.");
      return;
    }

    const age = getAgeFromBirthDate(form.birthDate);
    if (age === null) {
      setCustomMessage("error", "Please enter a valid birthday.");
      return;
    }

    if (age < 13) {
      setCustomMessage("error", "You must be at least 13 years old to create an account.");
      return;
    }

    if (!siteKey || !captchaRef.current) {
      setCustomMessage("error", "reCAPTCHA is not configured properly.");
      return;
    }

    setSubmitting(true);

    try {
      const recaptchaToken = await captchaRef.current.executeAsync();
      captchaRef.current.reset();

      if (!recaptchaToken) {
        setCustomMessage("error", "Please verify that you are not a robot.");
        return;
      }

      const response = await fetch("http://localhost:5000/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: form.username,
          email: form.email,
          password: form.password,
          birthDate: form.birthDate,
          recaptchaToken,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setCustomMessage("error", data.error || "Signup failed.");
        return;
      }

      persistAuthSession(data);
      setCustomMessage("success", "Account created. Check your email for the 6-digit verification code.");
      setTimeout(() => {
        navigate("/verify-email", { replace: true });
      }, 500);
    } catch (err) {
      console.error(err);
      setCustomMessage("error", "Signup request failed.");
      captchaRef.current?.reset();
    } finally {
      setSubmitting(false);
    }
  };

  const maxBirthDate = new Date().toISOString().split("T")[0];

  return (
    <div className="welcome">
      <div className="signup-aero-page">
        <div className="signup-aero-card">
          <h2 className="signup-aero-title">Create Account</h2>

          {feedback.message && (
            <div className={`signup-feedback ${feedback.type}`}>
              {feedback.message}
            </div>
          )}

          <form className="signup-aero-form" onSubmit={handleSubmit}>
            <input
              type="text"
              name="username"
              placeholder="Username"
              className="signup-aero-input"
              value={form.username}
              onChange={handleChange}
              required
            />

            <input
              type="email"
              name="email"
              placeholder="Email"
              className="signup-aero-input"
              value={form.email}
              onChange={handleChange}
              required
            />

            <input
              ref={birthDateRef}
              type={birthDateInputType}
              name="birthDate"
              placeholder="Birthday"
              className="signup-aero-input signup-aero-date"
              value={form.birthDate}
              onChange={handleChange}
              onClick={activateBirthDatePicker}
              onTouchStart={activateBirthDatePicker}
              readOnly={birthDateInputType === "text"}
              inputMode="none"
              onBlur={() => {
                if (!form.birthDate) {
                  setBirthDateInputType("text");
                }
              }}
              max={maxBirthDate}
              required
            />

            <input
              type="password"
              name="password"
              placeholder="Password"
              className="signup-aero-input"
              value={form.password}
              onChange={handleChange}
              required
            />

            <p className="signup-password-hint">
              Use 8+ characters with uppercase, lowercase, a number, and a special character.
            </p>

            <input
              type="password"
              name="confirmPassword"
              placeholder="Confirm Password"
              className="signup-aero-input"
              value={form.confirmPassword}
              onChange={handleChange}
              required
            />

            <ReCAPTCHA
              ref={captchaRef}
              sitekey={siteKey}
              size="invisible"
              badge="inline"
              theme="light"
            />

            <button type="submit" className="signup-aero-btn" disabled={submitting}>
              {submitting ? "Creating account..." : "Sign Up"}
            </button>
          </form>

          <p className="signup-login-link">
            Already have an account?{" "}
            <Link to="/login">
              Login
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
