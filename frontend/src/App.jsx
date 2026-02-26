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
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import ScrollToTop from "./components/ScrollToTop";
import PrivateRoute from "./components/PrivateRoute";
import PublicRoute from "./components/PublicRoute";
import NotFound from "./pages/NotFound"; // <-- import it
import EditProfile from "./pages/EditProfile"; // <-- import it
import CreatePost from "./pages/CreatePost"; // <-- import it
import CommentSheet from "./components/CommentSheet";

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
      <div className="welcome">{children}</div>
    </>
  );
}

function MiscPageLayout({ children }) {
  return (
    <>
      <div className="misc-page-container">{children}</div>
    </>
  );
}

function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        {/* Public pages: welcome, login, signup */}
        <Route
          path="/"
          element={
            <PublicRoute>
              <StandaloneLayout>
                <Welcome />
              </StandaloneLayout>
            </PublicRoute>
          }
        />
        <Route
          path="/login"
          element={
            <PublicRoute>
              <StandaloneLayout>
                <Login />
              </StandaloneLayout>
            </PublicRoute>
          }
        />
        <Route
          path="/signup"
          element={
            <PublicRoute>
              <StandaloneLayout>
                <Signup />
              </StandaloneLayout>
            </PublicRoute>
          }
        />

        {/* Protected pages */}
        <Route
          path="/feed"
          element={
            <PrivateRoute>
              <MainLayout>
                <Feed />
              </MainLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <PrivateRoute>
              <MainLayout>
                <Profile />
              </MainLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <PrivateRoute>
              <MainLayout>
                <Settings />
              </MainLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/notifications"
          element={
            <PrivateRoute>
              <MainLayout>
                <Notifications />
              </MainLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/messages"
          element={
            <PrivateRoute>
              <MainLayout>
                <Messages />
              </MainLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/chat/:chatId"
          element={
            <PrivateRoute>
              <MainLayout>
                <Chat />
              </MainLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="*"
          element={
            <MiscPageLayout>
              <NotFound />
            </MiscPageLayout>
          }
        />
        <Route
          path="/edit-profile"
          element={
            <MainLayout>
              <EditProfile />
            </MainLayout>
          }
        />
        <Route
          path="/create"
          element={
            <MainLayout>
              <CreatePost />
            </MainLayout>
          }
        />
        
      </Routes>
    </>
  );
}

export default App;