import React from "react";
import "../css/LegalPage.css";

export default function CommunityGuidelinesPage() {
  return (
    <div className="legal-page">
      <div className="legal-card">
        <p className="legal-kicker">Fruityger Safety</p>
        <h1>Community Guidelines</h1>
        <p className="legal-updated">Last updated: July 2, 2026</p>

        <section className="legal-section">
          <h2>Respectful Use</h2>
          <p>
            Fruityger is for sharing posts, tapes, messages, and conversations without harassment,
            threats, targeted abuse, or behavior meant to intimidate other people.
          </p>
        </section>

        <section className="legal-section">
          <h2>Content Safety</h2>
          <p>
            Do not post or send illegal content, sexual exploitation, graphic sexual abuse,
            credible threats, instructions for serious harm, hateful attacks, scams, impersonation,
            or content that violates another person&apos;s rights.
          </p>
        </section>

        <section className="legal-section">
          <h2>Child Safety</h2>
          <p>
            Fruityger strictly prohibits child sexual abuse material, grooming, sexualized content
            involving minors, attempts to exploit minors, or any behavior that endangers children.
            Violations may lead to immediate removal, account termination, and reports to the
            appropriate authorities where required by law.
          </p>
        </section>

        <section className="legal-section">
          <h2>Privacy and Consent</h2>
          <p>
            Do not share someone&apos;s private information, intimate media, private messages, or
            identifying details without permission. Respect blocks, private accounts, and requests
            to stop contact.
          </p>
        </section>

        <section className="legal-section">
          <h2>Moderation and Reports</h2>
          <p>
            Fruityger may use automated checks, user reports, and admin review to restrict,
            remove, or escalate unsafe content. Reports should be made in good faith and include
            enough context for review.
          </p>
        </section>

        <section className="legal-section">
          <h2>Account Integrity</h2>
          <p>
            Do not use Fruityger to spam, manipulate engagement, evade enforcement, create
            deceptive accounts, or interfere with the platform&apos;s security and reliability.
          </p>
        </section>

        <section className="legal-section">
          <h2>Contact</h2>
          <p>Email: thedossiercreatives@gmail.com</p>
        </section>
      </div>
    </div>
  );
}
