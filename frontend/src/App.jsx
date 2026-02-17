import { Routes, Route } from "react-router-dom";
import Header from "./components/Header";
import Feed from "./components/Feed";
import Profile from "./pages/Profile";
import Settings from "./pages/Settings";
import "./css/App.css";

function App() {
  return (
    <>
      <Header />

      <div className="app-container">
        <Routes>
          <Route path="/" element={<Feed />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </div>
    </>
  );
}

export default App;
