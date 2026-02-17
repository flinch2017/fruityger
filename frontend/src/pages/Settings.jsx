import React from "react";
import "../css/Settings.css";

export default function Settings() {
  return (
    <div className="settings-page">

      <h1>Settings</h1>

      {/* Account Section */}
      <div className="settings-section">
        <h2>Account</h2>
        <label>
          Username:
          <input type="text" placeholder="Your username" />
        </label>
        <label>
          Email:
          <input type="email" placeholder="you@example.com" />
        </label>
        <button className="save-btn">Save Account</button>
      </div>

      {/* Appearance Section */}
      <div className="settings-section">
        <h2>Appearance</h2>
        <label>
          Theme:
          <select>
            <option value="nostalgic-beige">Nostalgic Beige</option>
            <option value="vivid-retro">Vivid Retro</option>
          </select>
        </label>
        <button className="save-btn">Save Appearance</button>
      </div>

      {/* Notifications Section */}
      <div className="settings-section">
  <h2>Notifications</h2>
  
  <div className="checkbox-wrapper">
    <input type="checkbox" id="emailNotif" />
    <label htmlFor="emailNotif">Email notifications</label>
  </div>
  
  <div className="checkbox-wrapper">
    <input type="checkbox" id="smsNotif" />
    <label htmlFor="smsNotif">SMS notifications</label>
  </div>

  <div className="checkbox-wrapper">
    <input type="checkbox" id="pushNotif" />
    <label htmlFor="pushNotif">Push notifications</label>
  </div>
</div>


    </div>
  );
}
