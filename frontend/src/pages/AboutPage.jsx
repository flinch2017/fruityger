import React from "react";
import "../css/LegalPage.css";

export default function AboutPage() {
  return (
    <div className="legal-page">
      <div className="legal-card">
        <p className="legal-kicker">About Fruityger</p>
        <h1>About</h1>
        <p className="legal-updated">Built with Frutiger Aero nostalgia in mind</p>

        <section className="legal-section">
          <h2>What Fruityger Is</h2>
          <p>
            Fruityger is a social experience inspired by glossy web-era optimism, soft glassy UI,
            and playful internet culture. It blends nostalgic visuals with modern social features.
          </p>
        </section>

        <section className="legal-section">
          <h2>Founder and Developer</h2>
          <p>
            Fruityger was founded and developed by Iris Contado under DOSSIER SOFTWARE DEVELOPMENT
            SERVICES.
          </p>
        </section>

        <section className="legal-section">
          <h2>Contact</h2>
          <p>Instagram: @iriscontado</p>
        </section>
      </div>
    </div>
  );
}
