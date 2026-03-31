import { Routes, Route } from "react-router-dom";
import Header from "./components/Header";
import Feed from "./components/Feed";
import Profile from "./pages/Profile";
import Settings from "./pages/Settings";
import VerifyCurrentPassword from "./pages/VerifyCurrentPassword";
import ChangeEmail from "./pages/ChangeEmail";
import ChangePassword from "./pages/ChangePassword";
import ConfirmEmailChange from "./pages/ConfirmEmailChange";
import Notifications from "./pages/Notifications";
import Messages from "./pages/Messages";
import Chat from "./pages/Chat";
import Welcome from "./pages/Welcome";
import WelcomeHeader from "./components/WelcomeHeader";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import VerifyEmail from "./pages/VerifyEmail";
import ChooseInterests from "./pages/ChooseInterests";
import ScrollToTop from "./components/ScrollToTop";
import PrivateRoute from "./components/PrivateRoute";
import PublicRoute from "./components/PublicRoute";
import VerificationRoute from "./components/VerificationRoute";
import OnboardingRoute from "./components/OnboardingRoute";
import NotFound from "./pages/NotFound"; // <-- import it
import EditProfile from "./pages/EditProfile"; // <-- import it
import CreatePost from "./pages/CreatePost"; // <-- import it
import EditPost from "./pages/EditPost";
import CommentSheet from "./components/CommentSheet";
import Search from "./pages/Search";
import HashtagPage from "./pages/HashtagPage";
import ReportPage from "./pages/ReportPage";
import FollowListPage from "./pages/FollowListPage";
import PostDetail from "./pages/PostDetail";
import TermsPage from "./pages/TermsPage";
import PrivacyPage from "./pages/PrivacyPage";
import CookiePage from "./pages/CookiePage";
import AboutPage from "./pages/AboutPage";
import ShareProfile from "./pages/ShareProfile";


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

function ProfileLayout({ children }) {
  const hasToken = Boolean(localStorage.getItem("token"));

  if (hasToken) {
    return (
      <>
        <Header />
        <div className="app-container">{children}</div>
      </>
    );
  }

  return (
    <>
      <WelcomeHeader />
      <div className="welcome">{children}</div>
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
        <Route
          path="/verify-email"
          element={
            <VerificationRoute>
              <StandaloneLayout>
                <VerifyEmail />
              </StandaloneLayout>
            </VerificationRoute>
          }
        />
        <Route
          path="/onboarding/interests"
          element={
            <OnboardingRoute>
              <StandaloneLayout>
                <ChooseInterests />
              </StandaloneLayout>
            </OnboardingRoute>
          }
        />
        <Route
          path="/terms"
          element={
            <StandaloneLayout>
              <TermsPage />
            </StandaloneLayout>
          }
        />
        <Route
          path="/privacy"
          element={
            <StandaloneLayout>
              <PrivacyPage />
            </StandaloneLayout>
          }
        />
        <Route
          path="/cookies"
          element={
            <StandaloneLayout>
              <CookiePage />
            </StandaloneLayout>
          }
        />
        <Route
          path="/about"
          element={
            <StandaloneLayout>
              <AboutPage />
            </StandaloneLayout>
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
          path="/settings/verify-current-password"
          element={
            <PrivateRoute>
              <MainLayout>
                <VerifyCurrentPassword />
              </MainLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/settings/change-email"
          element={
            <PrivateRoute>
              <MainLayout>
                <ChangeEmail />
              </MainLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/settings/change-password"
          element={
            <PrivateRoute>
              <MainLayout>
                <ChangePassword />
              </MainLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/confirm-email-change"
          element={
            <StandaloneLayout>
              <ConfirmEmailChange />
            </StandaloneLayout>
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
          path="/post/:postId"
          element={
            <PrivateRoute>
              <MainLayout>
                <PostDetail />
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
            <PrivateRoute>
              <MainLayout>
                <EditProfile />
              </MainLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/create"
          element={
            <PrivateRoute>
              <MainLayout>
                <CreatePost />
              </MainLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/edit-post/:postId"
          element={
            <PrivateRoute>
              <MainLayout>
                <EditPost />
              </MainLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/search"
          element={
            <PrivateRoute>
              <MainLayout>
                <Search />
              </MainLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/hashtag/:tag"
          element={
            <PrivateRoute>
              <MainLayout>
                <HashtagPage />
              </MainLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/profile/:username"
          element={
            <ProfileLayout>
              <Profile />
            </ProfileLayout>
          }
        />
        <Route
          path="/profile/:username/share"
          element={
            <ProfileLayout>
              <ShareProfile />
            </ProfileLayout>
          }
        />
        <Route
          path="/profile/:username/:type"
          element={
            <PrivateRoute>
              <MainLayout>
                <FollowListPage />
              </MainLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/report"
          element={
            <PrivateRoute>
              <MainLayout>
                <ReportPage />
              </MainLayout>
            </PrivateRoute>
          }
        />
      </Routes>
    </>
  );
}

export default App;
