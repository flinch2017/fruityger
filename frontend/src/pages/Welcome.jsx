import React from "react";
import { useNavigate } from "react-router-dom";
import "../css/Welcome.css";

export default function Welcome() {
  const navigate = useNavigate();

  return (
    <div className="welcome"> {/* <- use this div instead of body */}
      <div className="welcome-page">
        {/* Main Card / CTA */}
        <div className="welcome-card">
          <h2>Fruityger</h2>
          <p>Jump in and explore your vibrant social space</p>

          <div className="welcome-buttons">
            <button onClick={() => navigate("/signup")}>Get Started</button>
          </div>
        </div>
      </div>
    </div>
  );
}