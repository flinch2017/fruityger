import { useEffect, useState } from "react";
import ReCAPTCHA from "react-google-recaptcha";
import { Link } from "react-router-dom";
import "../css/Signup.css";

export default function Signup() {
  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  const [captchaValue, setCaptchaValue] = useState(null);

  useEffect(() => {
    document.body.classList.add("welcome");
    return () => document.body.classList.remove("welcome");
  }, []);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
  e.preventDefault();

  if (form.password !== form.confirmPassword) {
    alert("Passwords do not match");
    return;
  }

  if (!captchaValue) {
    alert("Please verify that you are not a robot");
    return;
  }

  try {
    const response = await fetch("http://localhost:5000/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        recaptchaToken: captchaValue, // send this to backend
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      alert(data.error || "Signup failed");
      return;
    }

    // ✅ Signup successful
    console.log("User signed up:", data.user);
    localStorage.setItem("token", data.token);       // JWT token
    localStorage.setItem("userId", data.user.id);    // user UUID
    localStorage.setItem("username", data.user.username); // username
    window.location.href = "/feed"; 
  } catch (err) {
    console.error(err);
    alert("Signup request failed");
  }
};

  return (
    <div className="welcome">
        <div className="signup-aero-page">
            <div className="signup-aero-card">
                <h2 className="signup-aero-title">Create Account</h2>

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
                    type="password"
                    name="password"
                    placeholder="Password"
                    className="signup-aero-input"
                    value={form.password}
                    onChange={handleChange}
                    required
                />

                <input
                    type="password"
                    name="confirmPassword"
                    placeholder="Confirm Password"
                    className="signup-aero-input"
                    value={form.confirmPassword}
                    onChange={handleChange}
                    required
                />

                {/* ===== reCAPTCHA ===== */}
                <ReCAPTCHA
                    sitekey="6LdizXEsAAAAALqqTRRhvx6XOcd9gRndTGVl1wSS"
                    onChange={(value) => setCaptchaValue(value)}
                    theme="light"
                />

                <button type="submit" className="signup-aero-btn">
                    Sign Up
                </button>
                </form>

                <p style={{ marginTop: "18px", textAlign: "center" }}>
                Already have an account?{" "}
                <Link to="/login" style={{ color: "#0099cc", fontWeight: 600 }}>
                    Login
                </Link>
                </p>
            </div>
        </div>
    </div>
  );
}