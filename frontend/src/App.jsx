import { Routes, Route, useLocation } from "react-router-dom";
import Header from "./components/Header";
import Feed from "./components/Feed";
import Profile from "./pages/Profile";
import Settings from "./pages/Settings";
import HelpCenter from "./pages/HelpCenter";
import VerifyCurrentPassword from "./pages/VerifyCurrentPassword";
import ChangeEmail from "./pages/ChangeEmail";
import ChangePassword from "./pages/ChangePassword";
import DangerZone from "./pages/DangerZone";
import ForgotPasswordSearch from "./pages/ForgotPasswordSearch";
import ForgotPasswordChange from "./pages/ForgotPasswordChange";
import Notifications from "./pages/Notifications";
import Messages from "./pages/Messages";
import Chat from "./pages/Chat";
import GroupChat from "./pages/GroupChat";
import Welcome from "./pages/Welcome";
import WelcomeHeader from "./components/WelcomeHeader";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import ChooseInterests from "./pages/ChooseInterests";
import ScrollToTop from "./components/ScrollToTop";
import PrivateRoute from "./components/PrivateRoute";
import PublicRoute from "./components/PublicRoute";
import OnboardingRoute from "./components/OnboardingRoute";
import NotFound from "./pages/NotFound"; // <-- import it
import EditProfile from "./pages/EditProfile"; // <-- import it
import CreatePost from "./pages/CreatePost"; // <-- import it
import CreateTape from "./pages/CreateTape";
import TapesFeed from "./pages/TapesFeed";
import GameHub from "./pages/GameHub";
import GameLobby from "./pages/GameLobby";
import TicTacToeReady from "./pages/TicTacToeReady";
import TicTacToeMatch from "./pages/TicTacToeMatch";
import TicTacToeResult from "./pages/TicTacToeResult";
import EditPost from "./pages/EditPost";
import CommentSheet from "./components/CommentSheet";
import Search from "./pages/Search";
import HashtagPage from "./pages/HashtagPage";
import ReportPage from "./pages/ReportPage";
import FollowListPage from "./pages/FollowListPage";
import PostDetail from "./pages/PostDetail";
import ProfilePostView from "./pages/ProfilePostView";
import TermsPage from "./pages/TermsPage";
import PrivacyPage from "./pages/PrivacyPage";
import CookiePage from "./pages/CookiePage";
import CommunityGuidelinesPage from "./pages/CommunityGuidelinesPage";
import AboutPage from "./pages/AboutPage";
import ShareProfile from "./pages/ShareProfile";
import AdminRoute from "./components/AdminRoute";
import AdminLogin from "./pages/AdminLogin";
import AdminDashboard from "./pages/AdminDashboard";
import AdminUsers from "./pages/AdminUsers";
import AdminReports from "./pages/AdminReports";
import AdminActivity from "./pages/AdminActivity";
import AdminHelpCenter from "./pages/AdminHelpCenter";


import "./css/App.css";

// Layouts
function MainLayout({ children }) {
  const location = useLocation();
  const isTapesRoute = location.pathname === "/tapes";
  const isWideRoute = location.pathname.startsWith("/games");
  const appContainerClassName = isTapesRoute
    ? "app-container tapes-layout"
    : isWideRoute
      ? "app-container wide-layout"
      : "app-container";

  return (
    <>
      {!isTapesRoute && <Header />}
      <div className={appContainerClassName}>{children}</div>
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

function PublicInfoLayout({ children }) {
  const hasToken = Boolean(localStorage.getItem("token"));

  if (hasToken) {
    return (
      <MainLayout>
        {children}
      </MainLayout>
    );
  }

  return (
    <StandaloneLayout>
      {children}
    </StandaloneLayout>
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
  const location = useLocation();

  return (
    <>
      <ScrollToTop />
      <Routes location={location} key={`${location.pathname}${location.search}`}>
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
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <AdminDashboard />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/users"
          element={
            <AdminRoute>
              <AdminUsers />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/reports"
          element={
            <AdminRoute>
              <AdminReports />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/activity"
          element={
            <AdminRoute>
              <AdminActivity />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/help-center"
          element={
            <AdminRoute>
              <AdminHelpCenter />
            </AdminRoute>
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
          path="/forgot-password"
          element={
            <StandaloneLayout>
              <ForgotPasswordSearch />
            </StandaloneLayout>
          }
        />
        <Route
          path="/forgot-password/change-password"
          element={
            <StandaloneLayout>
              <ForgotPasswordChange />
            </StandaloneLayout>
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
            <PublicInfoLayout>
              <TermsPage />
            </PublicInfoLayout>
          }
        />
        <Route
          path="/privacy"
          element={
            <PublicInfoLayout>
              <PrivacyPage />
            </PublicInfoLayout>
          }
        />
        <Route
          path="/cookies"
          element={
            <PublicInfoLayout>
              <CookiePage />
            </PublicInfoLayout>
          }
        />
        <Route
          path="/community-guidelines"
          element={
            <PublicInfoLayout>
              <CommunityGuidelinesPage />
            </PublicInfoLayout>
          }
        />
        <Route
          path="/about"
          element={
            <PublicInfoLayout>
              <AboutPage />
            </PublicInfoLayout>
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
          path="/tapes"
          element={
            <PrivateRoute>
              <MainLayout>
                <TapesFeed />
              </MainLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/games"
          element={
            <PrivateRoute>
              <MainLayout>
                <GameHub />
              </MainLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/games/tic-tac-toe"
          element={
            <PrivateRoute>
              <MainLayout>
                <GameLobby />
              </MainLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/games/tic-tac-toe/match/:matchId/ready"
          element={
            <PrivateRoute>
              <TicTacToeReady />
            </PrivateRoute>
          }
        />
        <Route
          path="/games/tic-tac-toe/match/:matchId"
          element={
            <PrivateRoute>
              <TicTacToeMatch />
            </PrivateRoute>
          }
        />
        <Route
          path="/games/tic-tac-toe/match/:matchId/result"
          element={
            <PrivateRoute>
              <TicTacToeResult />
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
          path="/help-center"
          element={
            <PrivateRoute>
              <MainLayout>
                <HelpCenter />
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
          path="/settings/danger"
          element={
            <PrivateRoute>
              <MainLayout>
                <DangerZone />
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
          path="/group-chat/:groupChatId"
          element={
            <PrivateRoute>
              <MainLayout>
                <GroupChat />
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
          path="/create-tape"
          element={
            <PrivateRoute>
              <MainLayout>
                <CreateTape />
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
          path="/profile/:username/:tab/:postId"
          element={
            <ProfileLayout>
              <ProfilePostView />
            </ProfileLayout>
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
