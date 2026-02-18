import { Routes, Route } from "react-router-dom";
import Header from "./components/Header";
import Feed from "./components/Feed";
import Profile from "./pages/Profile";
import Settings from "./pages/Settings";
import Notifications from "./pages/Notifications";
import Messages from "./pages/Messages";
import Chat from "./pages/Chat";
import Welcome from "./pages/Welcome";
import WelcomeHeader from "./components/WelcomeHeader";
import "./css/App.css";

// Layouts
function MainLayout({ children }) {
  return (
    <>
      <Header />
      <div className="app-container">{children}</div>
    </>
  );
}

function StandaloneLayout({ children }) {
  return (
    <>
      <WelcomeHeader />
      {children}
    </>
  );
}


function App() {
  return (
    <Routes>
      {/* Welcome page without header */}
      <Route
        path="/"
        element={
          <StandaloneLayout>
            <Welcome />
          </StandaloneLayout>
        }
      />

      {/* All other pages with header */}
      <Route
        path="/feed"
        element={
          <MainLayout>
            <Feed />
          </MainLayout>
        }
      />
      <Route
        path="/profile"
        element={
          <MainLayout>
            <Profile />
          </MainLayout>
        }
      />
      <Route
        path="/settings"
        element={
          <MainLayout>
            <Settings />
          </MainLayout>
        }
      />
      <Route
        path="/notifications"
        element={
          <MainLayout>
            <Notifications />
          </MainLayout>
        }
      />
      <Route
        path="/messages"
        element={
          <MainLayout>
            <Messages />
          </MainLayout>
        }
      />
      <Route
        path="/chat/:chatId"
        element={
          <MainLayout>
            <Chat />
          </MainLayout>
        }
      />
    </Routes>
  );
}

export default App;
