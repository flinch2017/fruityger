import React from "react";
import "../css/LegalPage.css";

export default function CookiePage() {
  return (
    <div className="legal-page">
      <div className="legal-card">
        <p className="legal-kicker">Fruityger Legal</p>
        <h1>Cookie Policy</h1>
        <p className="legal-updated">Last updated: March 31, 2026</p>

        <section className="legal-section">
          <h2>What Cookies Do Here</h2>
          <p>
            Fruityger may use cookies or similar browser storage to help keep you signed in,
            remember app settings, improve reliability, and support a smoother user experience.
          </p>
        </section>

        <section className="legal-section">
          <h2>Preference Storage</h2>
          <p>
            Some preferences, such as appearance settings or onboarding-related state, may be kept
            in browser storage so your experience feels consistent across visits.
          </p>
        </section>

        <section className="legal-section">
          <h2>Your Control</h2>
          <p>
            You can clear browser storage or adjust browser settings at any time, though some
            Fruityger features may not work as expected if required storage is disabled.
          </p>
        </section>
      </div>
    </div>
  );
}
