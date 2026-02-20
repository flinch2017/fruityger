// components/PublicRoute.jsx
import { Navigate } from "react-router-dom";

export default function PublicRoute({ children }) {
  const token = localStorage.getItem("token");

  // If logged in, redirect to main feed
  if (token) {
    return <Navigate to="/feed" replace />;
  }

  return children;
}