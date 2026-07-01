import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import "../css/Signup.css";
import { persistAuthSession } from "../utils/authSession";
import TurnstileWidget, { isTurnstileDevBypassEnabled } from "../components/TurnstileWidget";

const SIGNUP_STEPS = ["Email", "Username", "Birthday", "Password", "Confirm"];

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

const normalizeUsername = (value = "") =>
  String(value)
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-+/g, "")
    .replace(/[^a-z0-9._]/g, "")
    .replace(/_+/g, "_")
    .replace(/\.+/g, ".")
    .replace(/^[^a-z]+/, "")
    .replace(/\.$/g, "");

const getUsernameValidationMessage = (username) => {
  if (!username) return "Username is required.";
  if (username.length < 3) return "Username must be at least 3 characters long.";
  if (username.length > 30) return "Username must be 30 characters or fewer.";
  if (!/^[a-z]/.test(username)) return "Username must start with a letter.";
  if (username.endsWith(".")) return "Username cannot end with a period.";
  if (!/^[a-z0-9._]+$/.test(username)) {
    return "Username can only use lowercase letters, numbers, periods, and underscores.";
  }
  return "";
};

const getEmailValidationMessage = (email = "") => {
  const value = String(email).trim();
  if (!value) return "Email is required.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Please enter a valid email address.";
  return "";
};

const getPasswordChecklist = (password) => [
  { label: "8+ characters", met: password.length >= 8 },
  { label: "Uppercase letter", met: /[A-Z]/.test(password) },
  { label: "Lowercase letter", met: /[a-z]/.test(password) },
  { label: "Number", met: /\d/.test(password) },
  { label: "Special character", met: /[^A-Za-z0-9]/.test(password) },
  { label: "No spaces", met: password.length > 0 && !/\s/.test(password) },
];

const getPasswordStrength = (password) => {
  if (!password) {
    return { label: "Waiting", tone: "idle", score: 0 };
  }

  const checklist = getPasswordChecklist(password);
  const metCount = checklist.filter((item) => item.met).length;
  const validationMessage = getPasswordValidationMessage(password);

  if (validationMessage) {
    return { label: "Incomplete", tone: "incomplete", score: Math.min(metCount, 2) };
  }

  if (metCount <= 4) {
    return { label: "Weak", tone: "weak", score: metCount };
  }

  if (metCount <= 5) {
    return { label: "Strong", tone: "strong", score: metCount };
  }

  return { label: "Strongest", tone: "strongest", score: metCount };
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
  const [stepIndex, setStepIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [birthMonth, setBirthMonth] = useState("");
  const [birthDay, setBirthDay] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const captchaRef = useRef(null);
  const siteKey =
    import.meta.env.VITE_TURNSTILE_SITE_KEY || import.meta.env.VITE_RECAPTCHA_SITE_KEY;
  const turnstileDevBypass = isTurnstileDevBypassEnabled();
  const passwordChecklist = getPasswordChecklist(form.password);
  const passwordStrength = getPasswordStrength(form.password);
  const confirmMatches =
    form.confirmPassword.length > 0 && form.password === form.confirmPassword;

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
    const { name, value } = e.target;
    setForm({
      ...form,
      [name]: name === "username" ? normalizeUsername(value) : value,
    });
  };

  const monthOptions = [
    { value: "01", label: "January" },
    { value: "02", label: "February" },
    { value: "03", label: "March" },
    { value: "04", label: "April" },
    { value: "05", label: "May" },
    { value: "06", label: "June" },
    { value: "07", label: "July" },
    { value: "08", label: "August" },
    { value: "09", label: "September" },
    { value: "10", label: "October" },
    { value: "11", label: "November" },
    { value: "12", label: "December" },
  ];

  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: currentYear - 1899 }, (_, index) => String(currentYear - index));
  }, []);

  const dayOptions = useMemo(() => {
    if (!birthMonth) return [];
    const safeYear = Number(birthYear || "2000");
    const daysInMonth = new Date(safeYear, Number(birthMonth), 0).getDate();
    return Array.from({ length: daysInMonth }, (_, index) => String(index + 1).padStart(2, "0"));
  }, [birthMonth, birthYear]);

  const syncBirthDate = (month, day, year) => {
    if (month && day && year) {
      setForm((current) => ({
        ...current,
        birthDate: `${year}-${month}-${day}`,
      }));
      return;
    }

    setForm((current) => ({
      ...current,
      birthDate: "",
    }));
  };

  const handleMonthSelect = (value) => {
    clearMessage();
    setBirthMonth(value);
    setBirthDay("");
    setBirthYear("");
    syncBirthDate(value, "", "");
  };

  const handleDaySelect = (value) => {
    clearMessage();
    setBirthDay(value);
    setBirthYear("");
    syncBirthDate(birthMonth, value, "");
  };

  const handleYearSelect = (value) => {
    clearMessage();
    setBirthYear(value);
    syncBirthDate(birthMonth, birthDay, value);
  };

  const validateStep = (index) => {
    if (index === 0) return getEmailValidationMessage(form.email);
    if (index === 1) return getUsernameValidationMessage(form.username);

    if (index === 2) {
      if (!form.birthDate) return "Please enter your birthday.";
      const age = getAgeFromBirthDate(form.birthDate);
      if (age === null) return "Please enter a valid birthday.";
      if (age < 13) return "You must be at least 13 years old to create an account.";
      return "";
    }

    if (index === 3) return getPasswordValidationMessage(form.password);

    if (index === 4) {
      if (!form.confirmPassword) return "Please confirm your password.";
      if (form.password !== form.confirmPassword) return "Passwords do not match.";
      return "";
    }

    return "";
  };

  const goNext = () => {
    clearMessage();
    const errorMessage = validateStep(stepIndex);
    if (errorMessage) {
      setCustomMessage("error", errorMessage);
      return false;
    }

    setStepIndex((current) => Math.min(current + 1, SIGNUP_STEPS.length - 1));
    return true;
  };

  const goBack = () => {
    clearMessage();
    setStepIndex((current) => Math.max(current - 1, 0));
  };

  const submitSignup = async () => {
    clearMessage();

    const finalStepError = validateStep(4);
    if (finalStepError) {
      setCustomMessage("error", finalStepError);
      return;
    }

    if ((!siteKey && !turnstileDevBypass) || !captchaRef.current) {
      setCustomMessage("error", "Turnstile is not configured properly.");
      return;
    }

    setSubmitting(true);

    try {
      const turnstileToken = await captchaRef.current.executeAsync();
      captchaRef.current.reset();

      if (!turnstileToken) {
        setCustomMessage("error", "Please complete the security check.");
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
          turnstileToken,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setCustomMessage("error", data.error || "Signup failed.");
        return;
      }

      persistAuthSession(data);
      setCustomMessage("success", "Account created. Let's tune your interests first.");
      setTimeout(() => {
        navigate("/onboarding/interests", { replace: true });
      }, 500);
    } catch (err) {
      console.error(err);
      setCustomMessage("error", "Signup request failed.");
      captchaRef.current?.reset();
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (stepIndex < SIGNUP_STEPS.length - 1) {
      goNext();
      return;
    }

    await submitSignup();
  };

  const stepTitle = useMemo(() => SIGNUP_STEPS[stepIndex], [stepIndex]);

  return (
    <div className="welcome">
      <div className="signup-aero-page">
        <div className="signup-aero-card">
          <h2 className="signup-aero-title">Create Account</h2>
          <p className="signup-step-indicator">
            Step {stepIndex + 1} of {SIGNUP_STEPS.length}: {stepTitle}
          </p>
          <div className="signup-step-progress" aria-hidden="true">
            {SIGNUP_STEPS.map((step, index) => (
              <span key={step} className={`signup-step-dot ${index <= stepIndex ? "active" : ""}`} />
            ))}
          </div>

          {feedback.message && (
            <div className={`signup-feedback ${feedback.type}`}>
              {feedback.message}
            </div>
          )}

          <form className="signup-aero-form" onSubmit={handleSubmit}>
            {stepIndex === 0 && (
              <>
                <input
                  type="email"
                  name="email"
                  placeholder="Email"
                  className="signup-aero-input"
                  value={form.email}
                  onChange={handleChange}
                  required
                />
                <p className="signup-password-hint">Use the email address you want tied to this account.</p>
              </>
            )}

            {stepIndex === 1 && (
              <>
                <input
                  type="text"
                  name="username"
                  placeholder="Username"
                  className="signup-aero-input"
                  value={form.username}
                  onChange={handleChange}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck="false"
                  required
                />
                <p className="signup-password-hint">
                  Lowercase only. Must start with a letter. Spaces become underscores. Cannot end with a period.
                </p>
              </>
            )}

            {stepIndex === 2 && (
              <div className="signup-birthday-grid">
                <select
                  id="signup-birth-month"
                  name="birthMonth"
                  className="signup-aero-input signup-aero-select"
                  value={birthMonth}
                  onChange={(event) => handleMonthSelect(event.target.value)}
                >
                  <option value="">Month</option>
                  {monthOptions.map((month) => (
                    <option key={month.value} value={month.value}>
                      {month.label}
                    </option>
                  ))}
                </select>

                <select
                  id="signup-birth-day"
                  name="birthDay"
                  className="signup-aero-input signup-aero-select"
                  value={birthDay}
                  onChange={(event) => handleDaySelect(event.target.value)}
                  disabled={!birthMonth}
                >
                  <option value="">Day</option>
                  {dayOptions.map((day) => (
                    <option key={day} value={day}>
                      {Number(day)}
                    </option>
                  ))}
                </select>

                <select
                  id="signup-birth-year"
                  name="birthYear"
                  className="signup-aero-input signup-aero-select"
                  value={birthYear}
                  onChange={(event) => handleYearSelect(event.target.value)}
                  disabled={!birthDay}
                >
                  <option value="">Year</option>
                  {yearOptions.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {stepIndex === 3 && (
              <>
                <div className="signup-password-field">
                  <input
                    type={showPassword ? "text" : "password"}
                    name="password"
                    placeholder="Password"
                    className="signup-aero-input signup-password-input"
                    value={form.password}
                    onChange={handleChange}
                    required
                  />
                  <button
                    type="button"
                    className="signup-password-toggle"
                    onClick={() => setShowPassword((prev) => !prev)}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>

                <div className={`signup-password-strength ${passwordStrength.tone}`}>
                  <div className="signup-password-strength-top">
                    <span>Password strength</span>
                    <strong>{passwordStrength.label}</strong>
                  </div>

                  <div className="signup-password-strength-bars">
                    {[1, 2, 3].map((bar) => (
                      <span
                        key={bar}
                        className={
                          passwordStrength.score >= bar * 2 ||
                          (bar === 1 && passwordStrength.score > 0)
                            ? "active"
                            : ""
                        }
                      />
                    ))}
                  </div>

                  <div className="signup-password-checklist">
                    {passwordChecklist.map((item) => (
                      <span key={item.label} className={item.met ? "met" : ""}>
                        {item.met ? "✓" : "•"} {item.label}
                      </span>
                    ))}
                  </div>
                </div>
              </>
            )}

            {stepIndex === 4 && (
              <>
                <div className="signup-password-field">
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    name="confirmPassword"
                    placeholder="Confirm Password"
                    className="signup-aero-input signup-password-input"
                    value={form.confirmPassword}
                    onChange={handleChange}
                    required
                  />
                  <button
                    type="button"
                    className="signup-password-toggle"
                    onClick={() => setShowConfirmPassword((prev) => !prev)}
                  >
                    {showConfirmPassword ? "Hide" : "Show"}
                  </button>
                </div>

                <p
                  className={`signup-password-hint signup-confirm-status ${
                    form.confirmPassword
                      ? confirmMatches
                        ? "match"
                        : "mismatch"
                      : ""
                  }`}
                >
                  {form.confirmPassword
                    ? confirmMatches
                      ? "Passwords match."
                      : "Passwords do not match yet."
                    : "Re-enter your password to confirm."}
                </p>
              </>
            )}

            <TurnstileWidget
              ref={captchaRef}
              siteKey={siteKey}
            />

            <div className="signup-step-actions">
              {stepIndex > 0 && (
                <button type="button" className="signup-aero-btn signup-aero-btn-secondary" onClick={goBack}>
                  Back
                </button>
              )}

              {stepIndex < SIGNUP_STEPS.length - 1 ? (
                <button type="button" className="signup-aero-btn" onClick={goNext}>
                  Next
                </button>
              ) : (
                <button type="submit" className="signup-aero-btn" disabled={submitting}>
                  {submitting ? "Creating account..." : "Sign Up"}
                </button>
              )}
            </div>
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
