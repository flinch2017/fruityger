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
          <h2>Child Safety Standards</h2>
          <p>
            Fruityger is committed to providing a safe environment for all users,
            including teenagers. The platform strictly prohibits any content,
            communication, or behavior that exploits, endangers, or sexually abuses
            children or minors.
          </p>

          <p>
            Users may not upload, share, request, promote, or distribute child sexual
            abuse material (CSAM), engage in the grooming of minors, or encourage any
            form of child exploitation. Any account found violating these standards may
            be immediately suspended or permanently terminated, and we may report
            unlawful activity to the appropriate authorities where required by law.
          </p>

          <p>
            Fruityger provides reporting and moderation tools that allow users to report
            inappropriate content, messages, or accounts. Reports are reviewed, and
            appropriate action is taken as quickly as reasonably possible.
          </p>

          <p>
            Fruityger is intended for users aged 13 years and older. Users under the
            minimum age required by applicable law or our policies are not permitted to
            create an account or use the platform.
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
            For general inquiries, contact us at:
            <br />
            thedossiercreatives@gmail.com
          </p>

          <p>
            To report content or behavior please contact:
            <br />
            thedossiercreatives@gmail.com
          </p>
        </section>
      </div>
    </div>
  );
}
