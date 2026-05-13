import React from "react";
import { Link } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import "../css/Welcome.css";

export default function Welcome() {
  const navigate = useNavigate();

  return (
    <div className="welcome">
      <div className="welcome-page">
        <div className="welcome-sky-glow welcome-sky-glow-left" aria-hidden="true" />
        <div className="welcome-sky-glow welcome-sky-glow-right" aria-hidden="true" />
        <div className="welcome-cloud welcome-cloud-one" aria-hidden="true" />
        <div className="welcome-cloud welcome-cloud-two" aria-hidden="true" />

        <div className="welcome-card">
          <div className="welcome-hero-copy">
            <p className="welcome-kicker">DOSSIER CREATIVES</p>
            <h1>Fruityger</h1>
            <p className="welcome-description">
              Drift into a glossy little internet.
            </p>

            <div className="welcome-buttons">
              <button className="welcome-primary-btn" onClick={() => navigate("/signup")}>
                Start your glow
              </button>
              <button className="welcome-secondary-btn" onClick={() => navigate("/login")}>
                I already have an account
              </button>
            </div>

            <div className="welcome-feature-row">
              <div className="welcome-feature-pill">Glassy profiles</div>
              <div className="welcome-feature-pill">Soft motion</div>
              <div className="welcome-feature-pill">Cute communities</div>
            </div>
          </div>

          <div className="welcome-scene" aria-hidden="true">
            <div className="welcome-orb orb-large"></div>
            <div className="welcome-orb orb-small"></div>
            <div className="welcome-character character-bunny">
              <span className="character-ear ear-left"></span>
              <span className="character-ear ear-right"></span>
              <span className="character-eye eye-left"></span>
              <span className="character-eye eye-right"></span>
              <span className="character-mouth"></span>
              <span className="character-cheek cheek-left"></span>
              <span className="character-cheek cheek-right"></span>
            </div>
            <div className="welcome-character character-blob">
              <span className="character-eye eye-left"></span>
              <span className="character-eye eye-right"></span>
              <span className="character-mouth smile"></span>
              <span className="character-cheek cheek-left"></span>
              <span className="character-cheek cheek-right"></span>
            </div>
            <div className="welcome-mini-bubbles">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        </div>

        <div className="welcome-footer">
          <div className="welcome-legal-links">
            <Link to="/terms">Terms and Conditions</Link>
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/cookies">Cookie Policy</Link>
            <Link to="/about">About</Link>
          </div>
          <p className="welcome-copyright">
            c 2026 DOSSIER CREATIVES
          </p>
        </div>
      </div>
    </div>
  );
}
