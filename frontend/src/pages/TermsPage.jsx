import React from "react";
import "../css/LegalPage.css";

export default function TermsPage() {
  return (
    <div className="legal-page">
      <div className="legal-card">
        <p className="legal-kicker">Fruityger Legal</p>
        <h1>Terms and Conditions</h1>
        <p className="legal-updated">Last updated: March 31, 2026</p>

        <section className="legal-section">
          <h2>Acceptance</h2>
          <p>
            By using Fruityger, you agree to these terms and to use the platform in a lawful,
            respectful, and non-abusive way.
          </p>
        </section>

        <section className="legal-section">
          <h2>Accounts</h2>
          <p>
            You are responsible for the activity on your account and for keeping your login
            credentials secure. You must provide accurate information when creating your account.
          </p>
        </section>

        <section className="legal-section">
          <h2>Content and Conduct</h2>
          <p>
            You keep ownership of the content you post, but you must not upload anything illegal,
            abusive, misleading, or infringing on someone else’s rights. We may moderate, remove,
            or restrict content or accounts that break these rules.
          </p>
        </section>

        <section className="legal-section">
          <h2>Platform Changes</h2>
          <p>
            Fruityger may change features, availability, or design over time. We may suspend or
            terminate access to protect the platform, users, or legal compliance.
          </p>
        </section>

        <section className="legal-section">
          <h2>Contact</h2>
          <p>
            Email: thedossiercreatives@gmail.com
          </p>
        </section>
      </div>
    </div>
  );
}
