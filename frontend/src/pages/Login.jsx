import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import "../css/Login.css";
import ReCAPTCHA from "react-google-recaptcha";




export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [captchaValue, setCaptchaValue] = useState(null);

  useEffect(() => {
    document.body.classList.add("welcome");
    return () => document.body.classList.remove("welcome");
  }, []);

    const handleSubmit = async (e) => {
  e.preventDefault();

  if (!email || !password) {
    alert("Please enter email and password");
    return;
  }

  if (!captchaValue) {
    alert("Please verify that you are not a robot");
    return;
  }

  try {
    const response = await fetch("http://localhost:5000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, recaptchaToken: captchaValue }),
    });

    const data = await response.json();

    if (!response.ok) {
      alert(data.error || "Login failed");
      setCaptchaValue(null); // reset captcha
      return;
    }

    console.log("Logged in user:", data.user);
    localStorage.setItem("token", data.token);

    // ⭐ Save username for profile routing
    localStorage.setItem("username", data.user.username);

    window.location.href = "/feed";
  } catch (err) {
    console.error(err);
    alert("Login request failed");
    setCaptchaValue(null); // reset captcha
  }
};

    return (
    <div className="welcome">
      <div className="login-aero-page">
        <div className="login-aero-card">
          <h2 className="login-aero-title">Login</h2>

          <form className="login-aero-form" onSubmit={handleSubmit}>
            <input
              type="email"
              placeholder="Email"
              className="login-aero-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <input
              type="password"
              placeholder="Password"
              className="login-aero-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            <ReCAPTCHA
                sitekey="6LdizXEsAAAAALqqTRRhvx6XOcd9gRndTGVl1wSS"  // use your V2 site key
                onChange={(value) => setCaptchaValue(value)}
                theme="light"
            />

            <button type="submit" className="login-aero-btn">
              Log In
            </button>

            <div className="login-aero-create">
              <Link to="/signup">Create an account</Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
