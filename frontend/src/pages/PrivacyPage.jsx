import React from "react";
import "../css/LegalPage.css";

export default function PrivacyPage() {
  return (
    <div className="legal-page">
      <div className="legal-card">
        <p className="legal-kicker">Fruityger Legal</p>
        <h1>Privacy Policy</h1>
        <p className="legal-updated">Last updated: March 31, 2026</p>

        <section className="legal-section">
          <h2>What We Collect</h2>
          <p>
            We may collect account details such as username, email address, profile information,
            preferences, and the content you create or interact with inside Fruityger.
          </p>
        </section>

        <section className="legal-section">
          <h2>How We Use Data</h2>
          <p>
            We use your information to operate the service, secure accounts, personalize the app,
            support moderation, and deliver optional updates such as newsletters or notifications
            you choose to enable.
          </p>
        </section>

        <section className="legal-section">
          <h2>Storage and Access</h2>
          <p>
            Your data is stored in the systems used to run Fruityger. Access is limited to what is
            necessary for development, support, moderation, and platform operations.
          </p>
        </section>

        <section className="legal-section">
          <h2>Your Choices</h2>
          <p>
            You can update account information, adjust settings, and manage optional notification
            preferences inside the app. If you want additional privacy-related support, contact the
            developer directly.
          </p>
        </section>

        <section className="legal-section">
          <h2>Contact</h2>
          <p>
            Fruityger is developed by Iris Contado of DOSSIER SOFTWARE DEVELOPMENT SERVICES.
            Instagram: @iriscontado
          </p>
        </section>
      </div>
    </div>
  );
}
