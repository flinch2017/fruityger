import React, { useState } from "react";
import { GiHamburgerMenu } from "react-icons/gi";
import { useNavigate } from "react-router-dom";
import "../css/WelcomeHeader.css";

export default function WelcomeHeader() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navigate = useNavigate();

  const toggleDrawer = () => setDrawerOpen(prev => !prev);

  const handleNavigate = (path) => {
    setDrawerOpen(false);
    navigate(path);
  };

  return (
    <>
      <header className="welcome-top-header">
        <div
          className="welcome-logo"
          onClick={() => handleNavigate("/")} // <-- navigate home
          style={{ cursor: "pointer" }} // optional: shows pointer on hover
        >
          Fruityger
        </div>

        {/* Mobile Hamburger */}
        <button className="welcome-hamburger" onClick={toggleDrawer}>
          <GiHamburgerMenu size={24} />
        </button>

        {/* Desktop Nav */}
        <nav className="welcome-desktop-nav">
          <a onClick={() => handleNavigate("/terms")}>Terms & Conditions</a>
          <a onClick={() => handleNavigate("/privacy")}>Privacy Policy</a>
          <a onClick={() => handleNavigate("/cookies")}>Cookie Policy</a>
          <a onClick={() => handleNavigate("/about")}>About</a>
          <button
            className="welcome-login-btn"
            onClick={() => handleNavigate("/login")}
          >
            Log In
          </button>
        </nav>
      </header>

      {/* Mobile Drawer */}
      <div className={`welcome-mobile-drawer ${drawerOpen ? "open" : ""}`}>
        <nav className="welcome-drawer-links">
          <a onClick={() => handleNavigate("/terms")}>Terms & Conditions</a>
          <a onClick={() => handleNavigate("/privacy")}>Privacy Policy</a>
          <a onClick={() => handleNavigate("/cookies")}>Cookie Policy</a>
          <a onClick={() => handleNavigate("/about")}>About</a>
        </nav>

        <button
          className="welcome-drawer-login"
          onClick={() => handleNavigate("/login")}
        >
          Log In
        </button>
      </div>

      {/* Overlay */}
      {drawerOpen && <div className="welcome-drawer-overlay" onClick={toggleDrawer}></div>}
    </>
  );
}
